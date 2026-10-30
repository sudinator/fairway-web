-- 0232_name_change_reaches_games.sql
--
-- 212.76 audit 4 (owner, Oct 30): an avatar change reaches the profile, every game row and the club memberships
-- (set_my_avatar); a NAME change updated only the profile, so every game the member is in kept the old name on the
-- leaderboard, the recap and the emails. set_my_display_name mirrors set_my_avatar: the profile and every game row
-- (a member's name is their name, in finished games too — exactly as the avatar already behaved).
--
-- AUTHORIZATION: the signed-in member, their own rows only. The profile guards still apply (name only).
-- TESTS: ci/assert-name-change.sql
--
-- Idempotent; safe to re-run.

begin;

create or replace function public.set_my_display_name(p_name text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_name text := nullif(trim(p_name), '');
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if v_name is null or length(v_name) < 2 then raise exception 'Please enter your name.' using errcode = '22023'; end if;
  update profiles     set display_name = v_name where id      = auth.uid();
  update game_players set display_name = v_name where user_id = auth.uid();
end $$;

revoke all on function public.set_my_display_name(text) from public;
grant execute on function public.set_my_display_name(text) to authenticated;

select public.record_migration('0232_name_change_reaches_games');

commit;
