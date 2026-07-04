-- 0052_group_pay_roster.sql
-- Money needs every group member visible to every member (to allocate expenses and settle up),
-- but profiles RLS hides other members' rows from non-admins (same issue 0025 fixed for game
-- rosters). This SECURITY DEFINER function returns id/name/avatar plus the payment handles Money
-- uses (venmo/paypal/phone) for any group the caller belongs to; membership enforced inside via
-- is_group_member. Never returns email or GHIN. Idempotent. Run after 0051.

drop function if exists public.group_pay_roster(uuid);

create or replace function public.group_pay_roster(p_group uuid)
returns table (id uuid, display_name text, avatar_url text, venmo_handle text, paypal_handle text, phone text)
language sql
security definer
set search_path = public
as $$
  select p.id,
         coalesce(p.display_name, 'Player') as display_name,
         p.avatar_url,
         p.venmo_handle,
         p.paypal_handle,
         p.phone
  from group_members gm
  join profiles p on p.id = gm.user_id
  where gm.group_id = p_group
    and gm.status = 'active'
    and public.is_group_member(p_group, auth.uid())
  order by coalesce(p.display_name, 'Player');
$$;

grant execute on function public.group_pay_roster(uuid) to authenticated;
