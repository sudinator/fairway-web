Birdie Num Num — 212.91.261106 full-source candidate

Complete cumulative codebase based on 212.90. Remove the Activity tab; keep course/participation details expandable and collapsible inline; put the existing published club report directly in Members.
No new monthly-report schedule. Existing source schedules July 1 and October 1; live job/publication status has not been verified here.

No new migration. All 313 SQL files are byte-identical to 212.90. Existing server environment configuration is retained.
Dependencies, compiled output and private environment files are excluded. Keep your existing local environment configuration.
See RELEASE_VERIFICATION_212.91.md for executed checks and pending external gates.

Not production-release approval. GitHub verify, Vercel staging Ready, staging integration and actual phone checks must pass before staging-to-main PR/merge. After any later authorized production release, confirm production Ready and run a non-destructive smoke test.
