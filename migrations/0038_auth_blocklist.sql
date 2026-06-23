-- 0038: Auth-login blocklist.
-- Problem: banning or wiping a user removes/flags the PROFILE but not the auth
-- login. A removed user could sign back in, get a fresh client-side profile, and
-- (with a default group set) auto-join it. This persists the block by EMAIL so a
-- new profile for that address is born banned, and the default-group auto-join is
-- refused. Merge does NOT blocklist (it's de-duping the same person).
--
-- Truly deleting the auth user is still a separate step in the Supabase Auth
-- dashboard; this keeps a returning account inert (banned + not auto-joined).

create extension if not exists citext;

create table if not exists public.banned_emails (
  email      citext primary key,
  reason     text,
  created_at timestamptz not null default now()
);
alter table public.banned_emails enable row level security;
-- Only admins may read it; all writes happen through SECURITY DEFINER functions
-- below (which bypass RLS), so there are intentionally no write policies.
drop policy if exists banned_emails_admin_select on public.banned_emails;
create policy banned_emails_admin_select on public.banned_emails
  for select using (public.is_admin());

-- A new profile whose email is blocklisted is created already-banned.
create or replace function public.guard_new_profile_banned()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_email citext;
begin
  v_email := lower(coalesce(new.email, (select email from auth.users where id = new.id), ''));
  if v_email <> '' and exists (select 1 from public.banned_emails where email = v_email) then
    new.banned := true;
  end if;
  return new;
end; $$;

drop trigger if exists trg_guard_new_profile_banned on public.profiles;
create trigger trg_guard_new_profile_banned
  before insert on public.profiles
  for each row execute function public.guard_new_profile_banned();

-- Ban/unban now also syncs the email blocklist.
create or replace function public.admin_set_banned(p_user uuid, p_banned boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_email citext;
begin
  if not public.is_admin() then return; end if;
  update profiles set banned = p_banned where id = p_user;
  select lower(email) into v_email from profiles where id = p_user;
  if v_email is not null and v_email <> '' then
    if p_banned then
      insert into public.banned_emails (email, reason) values (v_email, 'banned')
        on conflict (email) do nothing;
    else
      delete from public.banned_emails where email = v_email;
    end if;
  end if;
end; $$;
grant execute on function public.admin_set_banned(uuid, boolean) to authenticated;

-- Wiping a user blocklists the email first, so the account can't silently return.
create or replace function public.admin_wipe_user(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_email citext;
begin
  if not public.is_admin() then return; end if;
  select lower(email) into v_email from profiles where id = p_user;
  if v_email is not null and v_email <> '' then
    insert into public.banned_emails (email, reason) values (v_email, 'wiped')
      on conflict (email) do nothing;
  end if;
  delete from holes where round_id in (select id from rounds where user_id = p_user);
  delete from rounds where user_id = p_user;
  delete from game_players where user_id = p_user;
  delete from favorite_courses where user_id = p_user;
  delete from group_members where user_id = p_user;
  delete from notifications where user_id = p_user;
  delete from profiles where id = p_user;
end; $$;
grant execute on function public.admin_wipe_user(uuid) to authenticated;

-- A blocklisted email is never auto-joined to the default group.
create or replace function public.join_default_group(p_email text)
returns uuid language plpgsql security definer set search_path = public as $$
declare gid uuid; v_email citext;
begin
  v_email := lower(coalesce(p_email, ''));
  if v_email <> '' and exists (select 1 from public.banned_emails where email = v_email) then
    return null;
  end if;
  select id into gid from groups
    where is_default = true and coalesce(status, 'active') = 'active' limit 1;
  if gid is null then return null; end if;
  if not exists (
    select 1 from group_members
    where group_id = gid and user_id = auth.uid() and status = 'active'
  ) then
    insert into group_members (group_id, user_id, email, role, status)
    values (gid, auth.uid(), v_email, 'member', 'active');
  end if;
  update rounds set group_id = gid where user_id = auth.uid() and group_id is null;
  return gid;
end; $$;
grant execute on function public.join_default_group(text) to authenticated;

-- Admin can lift a block (e.g. to re-admit a wiped user later).
create or replace function public.admin_unblock_email(p_email text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  delete from public.banned_emails where email = lower(coalesce(p_email, ''));
end; $$;
grant execute on function public.admin_unblock_email(text) to authenticated;
