# 179.7 Staging verification — integration VAPID wiring

## Source contract

1. Confirm `.github/workflows/staging-integration.yml` sets `NEXT_PUBLIC_VAPID_PUBLIC_KEY` from the repository variable with the committed public-key fallback.
2. Confirm the workflow does not set `VAPID_CHECK_OPTIONAL`; the build must execute the real VAPID drift comparison.
3. Confirm no application, scoring, database, or migration file changed for this correction.
4. Run `python3 ci/check_vapid_contract.py` and confirm the manual-workflow checks pass.

## GitHub execution

1. Push v179.7 to `staging` and confirm normal CI and Vercel Staging are green.
2. In GitHub Actions, run **Staging integration** from the `staging` branch with mutation confirmation `YES`.
3. Confirm the VAPID prebuild check passes.
4. Confirm the workflow reaches and completes the real Staging integration harness with `STAGING INTEGRATION PASS`.
5. Confirm the workflow is green before Production promotion.

No database migration is included. Migration 0143 remains the latest required migration.
