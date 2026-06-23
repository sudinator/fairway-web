-- 0030_default_group.sql
-- Stranding recovery: designate ONE group as the app default. When a user has no
-- group at all, the app puts them in the default group and moves their homeless
-- rounds there, instead of minting a personal "Main". All SECURITY DEFINER.

-- One-and-only-one default, enforced by a partial unique index.
alter table public.groups add column if not exists is_default boolean not null default false;
create unique index if not exists groups_one_default on public.groups (is_default) where is_default;

-- Master admin: choose the default group (clears any prior default first).
create or replace function public.admin_set_default_group(p_group uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then return; end if;
  update groups set is_default = false where is_default = true and id <> p_group;
  update groups set is_default = true  where id = p_group;
end;
$$;
grant execute on function public.admin_set_default_group(uuid) to authenticated;

-- Caller joins the default group (if one is set) and brings their untagged rounds
-- along. Returns the default group id, or null if no default is configured.
create or replace function public.join_default_group(p_email text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare gid uuid;
begin
  select id into gid
    from groups
    where is_default = true and coalesce(status, 'active') = 'active'
    limit 1;
  if gid is null then return null; end if;

  if not exists (
    select 1 from group_members
    where group_id = gid and user_id = auth.uid() and status = 'active'
  ) then
    insert into group_members (group_id, user_id, email, role, status)
    values (gid, auth.uid(), coalesce(lower(p_email), ''), 'member', 'active');
  end if;

  -- Bring any homeless rounds into the default group.
  update rounds set group_id = gid where user_id = auth.uid() and group_id is null;

  return gid;
end;
$$;
grant execute on function public.join_default_group(text) to authenticated;

-- Overview gains is_default (return-type change => drop first).
drop function if exists public.admin_group_overview();
create or replace function public.admin_group_overview()
returns table (
  group_id uuid, name text, status text,
  admin_names text, member_count int, rounds_count int, games_count int,
  last_activity timestamptz, my_support boolean, is_default boolean
)
language sql security definer set search_path = public
as $$
  select
    g.id, g.name, coalesce(g.status, 'active') as status,
    (select string_agg(coalesce(p.display_name, gm2.email, 'admin'), ', ')
       from group_members gm2 left join profiles p on p.id = gm2.user_id
       where gm2.group_id = g.id and gm2.role = 'admin' and gm2.status = 'active'
         and gm2.is_support = false) as admin_names,
    (select count(*) from group_members gm where gm.group_id = g.id and gm.status = 'active' and gm.is_support = false)::int as member_count,
    (select count(*) from rounds r where r.group_id = g.id)::int as rounds_count,
    (select count(*) from games ga where ga.group_id = g.id)::int as games_count,
    greatest(
      coalesce((select max(r.played_at) from rounds r where r.group_id = g.id), 'epoch'::timestamptz),
      coalesce((select max(ga.created_at) from games ga where ga.group_id = g.id), 'epoch'::timestamptz),
      coalesce(g.created_at, 'epoch'::timestamptz)
    ) as last_activity,
    exists (select 1 from group_members gm3
            where gm3.group_id = g.id and gm3.user_id = auth.uid() and gm3.is_support = true) as my_support,
    coalesce(g.is_default, false) as is_default
  from groups g
  where public.is_admin()
  order by last_activity desc;
$$;
grant execute on function public.admin_group_overview() to authenticated;
