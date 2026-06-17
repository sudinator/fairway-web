-- 0015: Multi-use, time-limited group invite links.
-- Self-contained: leaves the existing one-time create_group_invite /
-- redeem_group_invite untouched and adds a parallel "multi" path.
-- NOTE: authored without the original function source — smoke-test in Supabase
-- (create a 24h link, redeem it from two different accounts, confirm both join).

alter table public.group_invites add column if not exists multi     boolean not null default false;
alter table public.group_invites add column if not exists max_uses  int;            -- null = unlimited
alter table public.group_invites add column if not exists use_count int not null default 0;

create or replace function public.create_group_invite_multi(
  invite_group uuid,
  invite_role  text default 'member',
  hours        int  default 24,
  uses         int  default null
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_code text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public.is_group_admin(invite_group, v_uid) then
    raise exception 'only a group admin can create an invite link';
  end if;
  loop
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (select 1 from public.group_invites where invite_code = v_code and status = 'active');
  end loop;
  insert into public.group_invites
    (group_id, invite_code, role, status, created_by, expires_at, multi, max_uses, use_count)
  values
    (invite_group, v_code, coalesce(invite_role, 'member'), 'active', v_uid,
     now() + make_interval(hours => greatest(1, coalesce(hours, 24))), true, uses, 0);
  return v_code;
end;
$$;

create or replace function public.redeem_group_invite_multi(code text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_email citext;
  inv     public.group_invites%rowtype;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into inv from public.group_invites
    where invite_code = code
      and status = 'active'
      and multi = true
      and (expires_at is null or expires_at > now())
      and (max_uses is null or use_count < max_uses)
    order by created_at desc
    limit 1;
  if inv.id is null then
    raise exception 'this invite link is invalid, expired, or fully used';
  end if;
  select email into v_email from auth.users where id = v_uid;
  insert into public.group_members (group_id, user_id, email, role, status)
  values (inv.group_id, v_uid, v_email, coalesce(inv.role, 'member'), 'active')
  on conflict (group_id, email) do update set status = 'active', user_id = excluded.user_id;
  update public.group_invites set use_count = use_count + 1 where id = inv.id;
  return inv.group_id;
end;
$$;

grant execute on function public.create_group_invite_multi(uuid, text, int, int) to authenticated;
grant execute on function public.redeem_group_invite_multi(text) to authenticated;
