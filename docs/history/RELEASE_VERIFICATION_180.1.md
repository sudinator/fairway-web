# Release verification — v180.1.260902

## Scope

This is a test-infrastructure-only overlay on v180.0. It corrects the disposable fresh-database Ryder Cup fixture by creating its referenced authentication principals before the competition records.

## Database

- No migration is included.
- Migration `0145_competition_lifecycle` remains the latest required migration.
- Do not rerun migration 0145 where it is already recorded.

## Required gates

1. Apply this overlay to the current v180.0 `staging` branch and push it.
2. Confirm GitHub `CI / verify` rebuilds the fresh Supabase database successfully.
3. Confirm the lifecycle behavior test reaches and passes its authorization assertions.
4. Confirm every other GitHub check and the Vercel Staging deployment are green.
5. Continue the v180.0 real-browser lifecycle and System Admin Games oversight scenarios.

## Expected fresh-database evidence

- Migrations through `0145_competition_lifecycle.sql` apply successfully.
- The core RLS structural contract reports 60 policy identities.
- No `competitions_created_by_fkey` fixture error occurs.
- `ci/assert-core-rls-behavior.sql` completes and rolls back its disposable records.
