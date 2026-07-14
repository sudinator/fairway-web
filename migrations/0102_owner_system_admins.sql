-- 0102_owner_system_admins.sql
-- Owner model for system admins. Today profiles.is_admin is a flat system-admin flag with everyone
-- equal. This adds an OWNER above them: only the owner can ADD or REMOVE system admins (promote AND
-- demote are owner-only). System admins keep full system powers but cannot change the admin roster.
-- The owner cannot be demoted, and there is exactly one owner (seeded to the sole current admin).

-- 1) Owner marker.
alter table public.profiles add column if not exists is_owner boolean not null default false;

-- 2) Seed the owner = the sole existing system admin (Amit), ONLY if there is exactly one admin.
--    If you already have multiple admins this no-ops; set the owner manually with the line below.
update public.profiles p
   set is_owner = true
 where coalesce(p.is_admin, false) = true
   and (select count(*) from public.profiles where coalesce(is_admin, false) = true) = 1;
-- Manual owner seed (edit the email, then run) if the auto-seed above did not apply:
--   update public.profiles set is_owner = true where email = 'you@example.com';

-- 3) is_owner() helper — mirrors is_admin() (owner AND not banned).
create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select coalesce((select is_owner and not coalesce(banned, false)
                   from profiles where id = auth.uid()), false);
$$;

-- 4) Owner-only add/remove of system admins, with guards + server-side audit.
create or replace function public.admin_set_system_admin(p_user uuid, p_make boolean)
returns void language plpgsql security definer set search_path = public as $function$
declare v_name text; v_owner boolean; v_actor text;
begin
  if not public.is_owner() then
    raise exception 'only the owner can add or remove system admins';
  end if;
  if p_user = auth.uid() then
    raise exception 'you cannot change your own admin status';
  end if;
  select display_name, coalesce(is_owner, false) into v_name, v_owner from profiles where id = p_user;
  if not found then raise exception 'user not found'; end if;
  if v_owner then raise exception 'the owner cannot be demoted'; end if;

  update profiles set is_admin = p_make where id = p_user;

  select coalesce(display_name, email) into v_actor from profiles where id = auth.uid();
  insert into activity_log (actor_id, actor_name, action, summary, target_user_id)
    values (auth.uid(), coalesce(v_actor, 'Owner'),
            case when p_make then 'system_admin_granted' else 'system_admin_revoked' end,
            (case when p_make then 'Granted system admin to ' else 'Revoked system admin from ' end)
              || coalesce(v_name, 'a user'),
            p_user);
end;
$function$;
grant execute on function public.admin_set_system_admin(uuid, boolean) to authenticated;

-- 5) Surface is_owner in the admin user list (owner first, then admins, then by name).
drop function if exists public.admin_list_users();
create or replace function public.admin_list_users()
returns table (
  id uuid, display_name text, email text, is_admin boolean, is_owner boolean, banned boolean,
  handicap_index numeric, group_count int, rounds_count int
)
language sql security definer set search_path = public as $$
  select p.id, p.display_name, p.email, p.is_admin, coalesce(p.is_owner, false), coalesce(p.banned, false),
         p.handicap_index,
         (select count(*) from group_members gm where gm.user_id = p.id and gm.status = 'active')::int,
         (select count(*) from rounds r
            where r.user_id = p.id
              and r.deleted_at is null
              and coalesce(r.status, 'final') <> 'in_progress')::int
  from profiles p
  where public.is_admin()
  order by coalesce(p.is_owner, false) desc, coalesce(p.is_admin, false) desc, p.display_name nulls last;
$$;
grant execute on function public.admin_list_users() to authenticated;
