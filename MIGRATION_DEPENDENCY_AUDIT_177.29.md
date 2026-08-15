# Migration Dependency Audit — 177.29

## Purpose
Stop discovering historical migration prerequisites one GitHub run at a time. This audit analyzes the complete globally ordered migration stream before the executable fresh-database replay.

## Coverage
- 135 ordered migration files across both migration roots.
- 43 repository-created relations.
- 134 repository-created functions.
- 1,086 relation dependency references.
- 462 function dependency references, including ordinary calls inside function/SQL bodies.
- 148 policy dependency operations.
- 98 explicit ADD/ALTER/DROP column-state operations.
- Repository-defined custom types (none in the current stream).
- Extension ordering handled by the companion extension-prerequisite guard.

## Historical prerequisites identified
1. `notifications.create notifications` existed before source control and is altered by 0017. Its pre-0017 INSERT policy is reconstructed in 0001.
2. `is_group_admin(uuid,uuid)` existed before 0015 uses it. Its pre-0034 definition is reconstructed in 0001.
3. `is_admin()` existed before 0017 references it. Its pre-0034 definition is reconstructed in 0001.
4. `is_group_member(uuid,uuid)` existed before the SQL-language function created by 0025 requires it. Its pre-0034 definition is reconstructed in 0001.
5. `citext` is required by 0001 before migration 0038 historically declares it; the fresh-DB bootstrap installs `citext` before numbered migrations.

Migration 0034 deliberately replaces the first three auth helper definitions to add banned-user enforcement, preserving the historical behavior transition rather than applying current behavior too early.

## Negative test
The baseline `is_group_member` definition was temporarily removed. The dependency guard failed specifically at `0025_group_roster.sql` and also reported the missing baseline prerequisite. Restoring the helper returned the full audit to PASS.

## Important limitation
Static SQL dependency analysis is a prevention layer, not proof that PostgreSQL will execute every historical statement. Dynamic SQL, extension internals, PostgreSQL version behavior, and data-dependent statements can only be proven by executing the full migration chain against a disposable clean database. GitHub's fresh-database reconstruction remains the authoritative release gate.
