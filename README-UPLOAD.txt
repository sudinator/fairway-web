Birdie Num Num — 212.90.261106 full-source candidate

Complete cumulative codebase, based on 212.89. Combines Players and Clubs, retains member cards/admin tools, and adds live last-30-day club engagement and top courses.
Dependencies, compiled output and private environment files are excluded. Keep your existing local environment configuration.

No new database migration. All 313 SQL files are byte-identical to 212.89. The new authenticated club-engagement API uses the existing server-only SUPABASE_SERVICE_ROLE_KEY; verify that it is configured in staging.
Full local CI passed. See RELEASE_VERIFICATION_212.90.md for evidence, metric definitions and pending external gates.

This archive is not production-release approval. GitHub verify, Vercel staging Ready, staging integration and actual phone checks must pass before a staging-to-main PR/merge. After any later authorized production release, confirm production Ready and run a non-destructive smoke test.
