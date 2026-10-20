-- 0200_support_visit_notice.sql
--
-- 210.9 — a support visit is not a join (owner, Oct 20 2026). The owner entered PA-NJ golfers as a support admin
-- for five seconds (admin_enter_group, 0028 — a temporary is_support membership) and the club's admin was told
-- "Amit Sud joined PA-NJ golfers." The join notification (notify_group_member, 0165) treated the support row as
-- an ordinary member joining.
--
-- Now:
--   * a SUPPORT entry tells the club's ADMINS what actually happened — "Amit Sud (BNN admin) looked in on
--     PA-NJ golfers to help with support. Support visits are logged." — type support_visit; never "joined";
--   * an ordinary join is unchanged, except that support memberships never count toward "(already in N other
--     clubs)", and support visitors aren't sent other members' join notifications;
--   * the support entry / exit activity log is unchanged.
--
-- AUTHORIZATION: unchanged — trigger function (SECURITY DEFINER, no grants).
--
-- Idempotent; safe to re-run.

begin;

create or replace function public.notify_group_member()
returns trigger language plpgsql security definer set search_path = public as $$
declare nm text; cn text; v_other integer; v_signed timestamptz; v_who text;
begin
  if new.user_id is null or new.status is distinct from 'active' then return new; end if;
  if tg_op = 'UPDATE' and old.status is not distinct from 'active' then return new; end if;
  nm := public.person_label(new.user_id);
  select name into cn from groups where id = new.group_id;

  -- 210.9: a support visit is not a join — tell the club's admins, honestly.
  if coalesce(new.is_support, false) then
    insert into notifications (user_id, message, group_id, type, link)
    select gm.user_id, nm || ' (BNN admin) looked in on ' || coalesce(cn, 'your club') || ' to help with support. Support visits are logged.',
           new.group_id, 'support_visit', '/?tab=groups'
      from group_members gm
     where gm.group_id = new.group_id and gm.status = 'active' and gm.role = 'admin' and gm.user_id is not null
       and not coalesce(gm.is_support, false) and gm.user_id is distinct from new.user_id;
    return new;
  end if;

  select count(*) into v_other from group_members
   where user_id = new.user_id and status = 'active' and group_id <> new.group_id and not coalesce(is_support, false);
  select created_at into v_signed from auth.users where id = new.user_id;
  v_who := case
    when v_other = 0 and v_signed > now() - interval '2 days' then ' (new to BNN, signed up ' ||
      case when v_signed::date = current_date then 'today' else 'yesterday' end || ')'
    when v_other = 0 then ' (their first club)'
    else ' (already in ' || v_other || ' other club' || case when v_other = 1 then '' else 's' end || ')'
  end;
  insert into notifications (user_id, message, group_id, type, link)
  select gm.user_id, nm || ' joined ' || coalesce(cn, 'your club') || v_who || '.',
         new.group_id, 'group_member', '/?tab=groups'
    from group_members gm
   where gm.group_id = new.group_id and gm.status = 'active' and gm.user_id is not null
     and not coalesce(gm.is_support, false)          -- 210.9: support visitors aren't told about joins
     and gm.user_id is distinct from new.user_id;
  return new;
end $$;

select public.record_migration('0200_support_visit_notice');

commit;
