-- 0216_retire_hand_made_functions.sql
--
-- 212.19 — production matches the migrations. The production security check (212.8) found three differences:
--   * create_group_invite(uuid, text, integer) and redeem_group_invite(text) — the ORIGINAL one-time invite functions,
--     made by hand on production before the project used migrations (0015: "leaves the existing one-time
--     create_group_invite / redeem_group_invite untouched") and never captured in a migration. Redeeming already goes
--     through begin_account (0189), which handles every code; creating a one-time link now uses
--     create_group_invite_multi (0015) with 1 use and 30 days — the same behaviour (components/groups.tsx, 212.19).
--   * clear_my_notifications() — created by 0094, no longer callable on production, and no longer used by the app.
-- All three are retired: removed where they exist (production), nothing to remove on a database built from migrations.
--
-- NOTE: production keeps running 212.6 until the merge; between applying this and merging, that version's
-- "one-time link" button errors (multi-use links still work). Apply it, then merge promptly.
--
-- AUTHORIZATION: drops three SECURITY DEFINER functions; no grants added.
-- TESTS: ci/assert-retired-functions.sql
--
-- Idempotent; safe to re-run.

begin;

drop function if exists public.create_group_invite(uuid, text, integer);
drop function if exists public.redeem_group_invite(text);
drop function if exists public.clear_my_notifications();

select public.record_migration('0216_retire_hand_made_functions');

commit;
