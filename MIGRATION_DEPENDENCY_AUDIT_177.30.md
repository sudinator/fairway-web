# Migration Dependency Audit 177.30.260814

## Trigger
GitHub CI #39 correctly replayed migrations 0001 through 0042 on a disposable clean Supabase database, then failed in `0043_round_game_unique.sql` because `rounds.game_id` did not exist.

## Root cause
`rounds.game_id` was part of the historical live schema, but `supabase/migrations/0001_baseline.sql` never recreated it and no numbered migration adds it. Earlier migrations referenced the column only inside stored function bodies, where PostgreSQL did not force the missing-column error at function creation time. Migration 0043 was the first direct executable query/index operation to require the column.

## Comprehensive baseline-column reconciliation
Compared baseline-created tables with the Production-derived 177.14 schema bootstrap and the complete ordered migration stream. Historical live columns absent from both the baseline and any later ADD COLUMN migration were restored:

- `profiles.deactivated boolean not null default false`
- `profiles.dashboard_ai jsonb`
- `favorite_courses.external_id text`
- `favorite_courses.facility text`
- `favorite_courses.corrected boolean not null default false`
- `rounds.ai_analysis text`
- `rounds.game_id uuid`
- `games.score_epoch integer not null default 0`
- `game_players.no_show boolean not null default false`

These are compatibility reconstruction fields, not new behavior changes.

## Static audit strengthening
`ci/check_legacy_migration_prereqs.py` now covers the full globally ordered 135-migration stream for:

- relation create/use ordering;
- repository function use-before-create;
- policy prerequisites;
- explicit ALTER-column state operations;
- simple CREATE INDEX column dependencies;
- fully-qualified table.column dependencies;
- custom types;
- required historical baseline compatibility objects.

Current executed counts:
- 1,086 relation dependencies;
- 462 function dependencies across 134 repo functions;
- 148 policy dependency operations;
- 98 explicit column-state operations;
- 174 executable column dependencies.

## Negative test
Removing `rounds.game_id` from the baseline causes the static audit to fail at `0043_round_game_unique.sql` with `CREATE INDEX references column not yet present: rounds.game_id`.

## Executable proof
Static closure is preventive only. GitHub's disposable fresh-Supabase replay remains the authoritative proof and must apply the complete migration stream through the latest migration and then pass historical-column, RLS, helper-function, ledger, type/test/build and other release gates.
