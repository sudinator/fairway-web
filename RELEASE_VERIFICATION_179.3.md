# 179.3 Staging verification — Cup schedule and live scoring

## Database gate

- Apply `0143_competition_schedule_contract.sql` to Staging and confirm `schema_migrations` contains the exact identifier.
- Verify the five new competition columns, `planned_match_count`, schedule-event table RLS, and both schedule RPC signatures.
- As a member who is not the organizer/admin, verify direct session/tie-rule mutation and both management RPCs are rejected.

## Schedule contract

1. Open the existing Main Test Cup. Confirm it is a schedule draft and its three linked legacy sessions are backfilled to 3, 3, and 6 matches (12 points at 1 point each).
2. Reopen the schedule if needed, confirm Four-Ball / Alternate Shot / Singles session names, dates, match counts, points per match, and tied-Cup rule.
3. Lock it. Confirm the header states `12 scheduled points`, and adding/changing/deleting schedule rows is unavailable.
4. Reopen with a required reason. Confirm the revision increases and an audit event is written; cancel/blank reason must change nothing.
5. Create a new draft Cup with differently weighted sessions and verify the displayed denominator equals the planned arithmetic before any games are created.

## Scoring and completion

- Four-Ball: after only a few holes, verify the match is Live, session completion does not increment, projection moves, and secured points do not.
- Alternate Shot: repeat the same live-state check using canonical side scores.
- Enter post-clinch holes and verify the Cup keeps the first mathematical result (for example `5 & 3`) and winning pair identity.
- Complete a tied match and verify `Halved`, equal point allocation, and no `Thru 18 · AS` final wording.
- Confirm long player/pair names wrap legibly instead of disappearing behind ellipses.
- With enough secured points before remaining matches end, verify the correct team is shown as having clinched the Cup.
- Before clinch, verify both teams’ points-needed values use secured points and the locked denominator.

## Navigation and setup

- From a Cup-linked scorecard, tap the Cup standings shortcut and confirm the correct Cup opens.
- Create a Cup Singles game: with teams seeded, setup opens at Matchups; after matchups are complete it progresses to Groups, then Review.
- Create a Cup Four-Ball and Alternate Shot game: with teams seeded, setup opens at Groups.
- On a Four-Ball scorecard, verify the orange legend says `match strokes (Four-Ball)`, never Trifecta.
- Confirm the weekly profile nudge remains on Home and does not push the Games/Cups workspace below the fold.

## Regression and release gate

- Ordinary non-Cup Match, Four-Ball, and Alternate Shot games retain existing scoring, handicap, persistence, reset, reopen, and finalization behavior.
- Run `npm run ci`, then `npm run test:staging` against Staging.
- Verify installed-PWA upgrade behavior and the persistent yellow STAGING frame/badge.
- Production remains blocked until all checks above pass and Production migration parity includes 0143.
