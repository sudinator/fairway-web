-- 0025_group_roster.sql
-- Any group member (not just admins) should be able to see every member's name,
-- avatar and handicap when picking players for a game. RLS hides other members'
-- `profiles` rows from non-admins, which collapsed the create-game roster to just
-- yourself. This SECURITY DEFINER function returns ONLY id/name/avatar/handicap
-- (never email or GHIN) for any group the caller belongs to; membership is
-- enforced inside the function via is_group_member.
--
-- DROP first: an earlier 3-column version of this function may already exist, and
-- Postgres won't let CREATE OR REPLACE change a function's return type.
drop function if exists public.group_roster(uuid);

create or replace function public.group_roster(p_group uuid)
returns table (id uuid, display_name text, avatar_url text, handicap_index numeric)
language sql
security definer
set search_path = public
as $$
  select p.id,
         coalesce(p.display_name, 'Player') as display_name,
         p.avatar_url,
         p.handicap_index::numeric
  from group_members gm
  join profiles p on p.id = gm.user_id
  where gm.group_id = p_group
    and gm.status = 'active'
    and public.is_group_member(p_group, auth.uid())
  order by coalesce(p.display_name, 'Player');
$$;

grant execute on function public.group_roster(uuid) to authenticated;
