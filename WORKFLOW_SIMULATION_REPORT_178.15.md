# Workflow Simulation Report — 178.15.260829

## Simulated release states

1. Repository and staging both contain all committed ledger-era migrations.
   - Expected: staging parity PASS.
2. Repository contains a new migration but staging has not applied it.
   - Expected: staging parity FAIL and staging validation stops.
3. Staging has the new migration but Production does not.
   - Expected: staging -> main Production parity job FAIL; do not merge.
4. Production migration is applied and ledger records it.
   - Expected: Production parity PASS; PR may continue through the remaining release gates.
5. A released migration SQL file is edited in a PR to main.
   - Expected: migration immutability guard FAIL; create a new numbered migration instead.
6. A migration file is added but `MIGRATIONS.md` is not regenerated.
   - Expected: migration manifest guard FAIL.
7. Production secrets are absent from the GitHub production environment.
   - Expected: Production parity FAIL rather than silently skipping the database check.
8. Main is merged after parity PASS.
   - Expected: Production parity runs again on push to main as a post-merge safety check.

No destructive Production operation is performed by these checks; the live checks are read-only SELECTs against `schema_migrations` through the Supabase REST API.
