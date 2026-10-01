# 193.2 CI-only correction

Overlay onto 193.1 on ci/193.1-reset-protection, commit and push to update the existing draft PR targeting staging. No new migration; do not run SQL manually or merge before all checks pass. The two fixture INSERT sites now establish the required version-0 context. Full Supabase CI remains pending.
