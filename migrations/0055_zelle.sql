-- 0055_zelle.sql — add Zelle as a Money payment method.
-- Zelle has no payment deep link, so we store each person's Zelle contact (phone or email)
-- and surface it to copy; the payer completes it in their bank app. Idempotent. Run after 0054.
alter table public.profiles add column if not exists zelle_handle text;

drop function if exists public.group_pay_roster(uuid);
create or replace function public.group_pay_roster(p_group uuid)
returns table (id uuid, display_name text, avatar_url text, venmo_handle text, paypal_handle text, zelle_handle text, phone text)
language sql
security definer
set search_path = public
as $$
  select p.id, coalesce(p.display_name, 'Player') as display_name, p.avatar_url,
         p.venmo_handle, p.paypal_handle, p.zelle_handle, p.phone
  from group_members gm
  join profiles p on p.id = gm.user_id
  where gm.group_id = p_group and gm.status = 'active'
    and public.is_group_member(p_group, auth.uid())
  order by coalesce(p.display_name, 'Player');
$$;
grant execute on function public.group_pay_roster(uuid) to authenticated;
