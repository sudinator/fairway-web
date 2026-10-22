-- 0208_player_cards_server_only.sql
--
-- 211.6 — a member's player card is worked out by the server (owner, Oct 21 2026: "have the database do the
-- math"). The card holds the handicap index calculated from the member's rounds, its trend, recent form and round
-- count; club-mates see it, and the admin sandbagger check compares it with the index the member entered. The
-- phone used to compute and write it, so a member could overwrite the calculated index by a direct request and
-- hide from the sandbagger check (their rounds untouched). Now /api/member-stats computes it on the server from the
-- rounds the database holds (with badges — whose member writes 0207 removed), and members only READ their card.
-- Scorecards are untouched: members still enter and correct their own scores exactly as before.
--
-- AUTHORIZATION: policy replacement on player_cards (read own) and member write privileges revoked; the server
-- (service role) writes. No grants.
-- TESTS: ci/assert-policy-review.sql
--
-- Idempotent; safe to re-run.

begin;

drop policy if exists player_cards_own on public.player_cards;
drop policy if exists player_cards_read_own on public.player_cards;
create policy player_cards_read_own on public.player_cards for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.player_cards from authenticated;
drop trigger if exists guard_active_account on public.player_cards;   -- no longer member-writable

select public.record_migration('0208_player_cards_server_only');

commit;
