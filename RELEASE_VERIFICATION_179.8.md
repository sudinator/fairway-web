# 179.8 release verification — authorization and mobile fit

## Release shape

- One candidate: `179.8.260902`.
- One database migration: `0144_authorization_hardening.sql`.
- One Staging deployment, then one `staging → main` pull request.
- No Staging users or test records are copied to Production. Only committed application code and the hand-applied schema/security migration advance.

## Before applying migration 0144

Run in each target Supabase SQL editor and require `owner_count <= 1`:

```sql
select count(*) as owner_count
from public.profiles
where coalesce(is_owner, false) = true;
```

## Staging gate

1. Apply migration 0144 to Staging and verify its ledger row.
2. Deploy v179.8 to the `staging` branch.
3. Require GitHub `CI / verify`, robustness/schema guards, Vercel, and the manual Staging integration workflow to pass.
4. Confirm an emailed member invitation activates as `member`; an intentionally invited admin remains `admin`.
5. Confirm a normal member can view a club game but cannot edit/delete another organizer's game.
6. At 375 px, 393 px, and 430 px widths, inspect Ryder Cup sessions, Finish Game, admin Clubs, toasts, and both Match-progression panels. The page/card must not extend past the right edge; local wide tables must use their contained scroll indicator.

## Production database gate — before opening/merging the PR

1. Apply migration 0144 to Production manually. Do not create or copy any Staging user or fixture.
2. Verify the ledger and hardened object contract with the read-only query supplied in the release handoff.
3. Open the single `staging → main` pull request. The Production parity job is intentionally skipped on the PR because PR-controlled code does not receive Production credentials.

## Merge and Production smoke

1. Merge only when all required PR checks and Vercel preview are green.
2. The trusted push to `main` runs Production migration parity and normal CI.
3. Confirm Production Vercel is green and shows `179.8.260902`.
4. Smoke-test sign-in, club list, existing Games, one Ryder Cup overview, invitation acceptance, and the four repaired mobile surfaces. Do not create temporary Production test users or bulk fixtures.
