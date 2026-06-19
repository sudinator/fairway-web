-- 0019_avatars.sql
-- Profile pictures. profiles stays locked to self-read, so a co-player's avatar
-- can't be read from there; instead we mirror the existing display_name pattern
-- and DENORMALIZE avatar_url into game_players and group_members (both already
-- readable by co-members). set_my_avatar() writes the caller's photo to all three
-- in one shot, so changing a photo updates it everywhere with no staleness and
-- without ever touching another user's row or weakening the profiles lock.

alter table public.profiles      add column if not exists avatar_url text;
alter table public.game_players  add column if not exists avatar_url text;
alter table public.group_members add column if not exists avatar_url text;

-- Public-read storage bucket for the (already downsized) avatar images. Small size
-- cap + image-only mime types as a server-side backstop to the client resize.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 524288,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Storage policies: anyone may read (public avatars); only the owner may write,
-- replace, or delete their own file. Files are keyed under a folder named after
-- the user's id ({uid}/avatar.jpg), so nobody can clobber someone else's image.
drop policy if exists "avatars public read"   on storage.objects;
drop policy if exists "avatars owner insert"  on storage.objects;
drop policy if exists "avatars owner update"  on storage.objects;
drop policy if exists "avatars owner delete"  on storage.objects;

create policy "avatars public read" on storage.objects
  for select using (bucket_id = 'avatars');

create policy "avatars owner insert" on storage.objects
  for insert with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars owner update" on storage.objects
  for update using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars owner delete" on storage.objects
  for delete using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Set (or clear, with null) the caller's avatar everywhere it is denormalized.
-- Only ever touches the caller's own rows.
create or replace function public.set_my_avatar(p_url text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  update profiles      set avatar_url = p_url where id      = auth.uid();
  update game_players  set avatar_url = p_url where user_id = auth.uid();
  update group_members set avatar_url = p_url where user_id = auth.uid();
end;
$function$;

grant execute on function public.set_my_avatar(text) to authenticated;
