# Release verification — v180.2.260902

## Scope

This is a test-infrastructure-only overlay on v180.1. It separates ordinary-user authorization tests from system-admin oversight and deletion tests by creating a dedicated disposable system-admin identity.

## Database

- No migration is included.
- Migration `0145_competition_lifecycle` remains the latest required migration.
- Do not rerun migration 0145 where it is already recorded.

## Required gates

1. Apply this overlay to the current v180.1 `staging` branch and push it.
2. Confirm GitHub `CI / verify` rebuilds the fresh Supabase database successfully.
3. Confirm `ci/assert-core-rls-behavior.sql` reaches `CORE_RLS_BEHAVIOR_PASS`.
4. Confirm every other GitHub check and the Vercel Staging deployment are green.
5. Resume the v180.0 real-browser lifecycle and System Admin Games oversight scenarios.

## Expected fresh-database evidence

- User A cannot self-promote, claim another club, delete completed play, or use System Admin oversight.
- System Admin C can inspect an unrelated Game and perform protected deletion.
- Own-ball history survives deletion; Alternate Shot shared-ball history is removed.
- Administrative deletion audit records identify System Admin C.
- No direct fixture update to `profiles.is_admin` occurs.
