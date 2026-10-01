-- 0158_profile_privilege_boundaries.sql
-- AUTHORIZATION: browser inserts cannot create admins/owners; only the existing owner may
-- change another non-owner's admin flag. Browser owner changes are forbidden. Admin changes
-- are audited in the trigger, including direct writes. Existing ban administration is preserved.
-- Trusted service_role and direct postgres/supabase_admin maintenance retain provisioning rights.
-- No existing profile is changed. Apply to staging and pass the release gates before production.
begin;

create or replace function public.guard_profile_privileged_cols()
returns trigger language plpgsql security definer set search_path = public
as $function$
declare
  v_role text := coalesce(current_setting('role', true), 'none');
  v_actor text;
begin
  -- current_user is the function owner here. Check the actual SQL role, never JWT metadata.
  if v_role = 'service_role'
     or (session_user in ('postgres', 'supabase_admin')
         and v_role in ('none', 'postgres', 'supabase_admin')) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.is_admin, false) or coalesce(new.is_owner, false) then
      raise exception 'new profiles cannot have admin/owner privileges' using errcode = '42501';
    end if;
    -- The separate blocklist trigger may legitimately set banned=true on insert.
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'changing profile identity is not permitted' using errcode = '42501';
  end if;
  if new.is_owner is distinct from old.is_owner then
    raise exception 'changing is_owner is not permitted' using errcode = '42501';
  end if;
  if new.banned is distinct from old.banned and not public.is_admin() then
    raise exception 'changing banned is not permitted' using errcode = '42501';
  end if;
  if new.is_admin is distinct from old.is_admin then
    if not public.is_owner() or old.id = auth.uid() or coalesce(old.is_owner, false) then
      raise exception 'only the owner may change another non-owner admin status' using errcode = '42501';
    end if;
    select display_name into v_actor from public.profiles where id = auth.uid();
    insert into public.activity_log(actor_id, actor_name, action, summary, target_user_id)
    values (auth.uid(), coalesce(v_actor, 'Owner'),
      case when new.is_admin then 'system_admin_granted' else 'system_admin_revoked' end,
      (case when new.is_admin then 'Granted system admin to ' else 'Revoked system admin from ' end)
        || coalesce(new.display_name, 'a user'), new.id);
  end if;
  return new;
end;
$function$;
revoke all on function public.guard_profile_privileged_cols() from public, anon, authenticated;

drop trigger if exists trg_guard_profile_privileged on public.profiles;
create trigger trg_guard_profile_privileged before insert or update on public.profiles
for each row execute function public.guard_profile_privileged_cols();

-- Keep the existing UI RPC; the trigger now owns the audit to avoid duplicate entries.
create or replace function public.admin_set_system_admin(p_user uuid, p_make boolean)
returns void language plpgsql security definer set search_path = public
as $function$
declare v_owner boolean;
begin
  if not public.is_owner() then
    raise exception 'only the owner can add or remove system admins' using errcode = '42501';
  end if;
  if p_user is null or p_make is null then
    raise exception 'user and admin status are required' using errcode = '22023';
  end if;
  if p_user = auth.uid() then raise exception 'you cannot change your own admin status'; end if;
  select coalesce(is_owner, false) into v_owner from public.profiles where id = p_user for update;
  if not found then raise exception 'user not found'; end if;
  if v_owner then raise exception 'the owner cannot be demoted'; end if;
  update public.profiles set is_admin = p_make where id = p_user;
end;
$function$;
revoke all on function public.admin_set_system_admin(uuid, boolean) from public, anon;
grant execute on function public.admin_set_system_admin(uuid, boolean) to authenticated;

commit;
select public.record_migration('0158_profile_privilege_boundaries');
