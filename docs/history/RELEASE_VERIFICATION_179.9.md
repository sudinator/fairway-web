# 179.9 release verification — consolidated security and mobile fit

## Release shape

- One authoritative candidate: `179.9.260902`.
- Supersedes all v179.8 ZIPs and corrective overlays.
- Includes the complete security, workflow-boundary, Ryder Cup mobile-fit, and corrected fresh-database test changes.
- No new migration. Do not rerun migration 0144 where `0144_authorization_hardening` is already recorded.
- One Staging deployment, then one `staging → main` pull request.

## Staging gate

1. Copy the complete v179.9 changed-files overlay into the Staging repository and push.
2. Require GitHub `CI / verify` to rebuild the disposable Supabase database and pass the 59-policy structural contract plus the negative authorization tests.
3. Require migration parity, Robustness, and Vercel Staging to pass.
4. Run the manual Staging integration workflow with mutation explicitly authorized; it creates and removes fixtures only in Staging.
5. At 375 px, 393 px, and 430 px widths, verify Ryder Cup session cards, Match progression, Finish Game, admin Clubs, and toasts do not overflow the viewport.

## Production gate

1. Confirm Production records migration 0144 before opening the pull request. Apply it only if absent.
2. Open one `staging → main` pull request and require all PR checks plus Vercel preview to pass.
3. Merge once. The trusted `main` push runs Production migration parity and the live read-only Production schema guard.
4. Smoke-test sign-in, club list, existing Games, one Ryder Cup overview, and the repaired mobile surfaces. Never copy Staging users or fixtures into Production.
