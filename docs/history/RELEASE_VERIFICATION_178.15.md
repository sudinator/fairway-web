# Release Verification — 178.15.260829

## Scope
Release-infrastructure hardening only. No application behavior or database schema change.

## Intended behavior
- The committed `migrations/` chain from 0113 onward is the repository-required database ledger.
- Staging CI must fail when the live staging `schema_migrations` ledger is missing a required committed migration.
- A staging -> main PR must fail when the live Production ledger is missing a required committed migration.
- A push to main repeats the Production parity check.
- `MIGRATIONS.md` must be regenerated whenever migration files change.
- Migration files already released on main are immutable; corrections require a new numbered migration.

## Validation
- `python3 ci/check_migration_ledger_contract.py`: PASS
- `python3 ci/check_migration_manifest.py`: PASS
- `python3 ci/check_migration_parity_contract.py`: PASS
- `python3 ci/check_migration_immutability.py`: local SKIP by design outside a PR-to-main context
- live parity checker synthetic complete-ledger case: PASS
- live parity checker synthetic missing-migration case: correctly FAILS
- `python3 ci/verify_release.py .`: PASS

## Environment-dependent gate
The live staging/Production checks require GitHub environment secrets and therefore are completed by GitHub Actions, not this local package build.
