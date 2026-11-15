# Analytics refinements — 212.108.261114

This candidate includes the complete delivered 212.107 source plus the three follow-up corrections and the owner-approved Summary filter design. It is not production approval.

## Member-visible changes

- Summary uses the approved three descending horizontal lines beside Last 5 / Last 20 / Season / All. The button is green without a course/tee filter and yellow only after applying one. Course and tee are the only popup criteria. Tee choices appear only after selecting a course and come from recorded tees at that course. Draft edits do not change the summary; Apply commits both criteria, Cancel/× discards them, and Clear followed by Apply restores all courses. The scrollable sheet does not dismiss on backdrop taps.
- The round-length selector is removed. Raw averages remain comparable: use complete nine-hole cards when the entire selected sample is nine-hole play; otherwise use complete eighteen-hole cards. Labels disclose the basis. Handicap index still uses full history.
- Partner records rank by the share of available match points, with a win worth one and a halved match one-half. Three matches minimum remains. Equal rates favour more matches. The table and highlighted partnership share this order; under-minimum records follow qualified ones and show no rate verdict. Existing match scoring/outcomes and recorded points are unchanged.
- Fairway/GIR peer verdicts need both five tracked rounds and fifty recorded opportunities per stat. Five one-hole observations cannot qualify. Putting retains five complete eighteen-hole putting cards; scrambling retains fifteen tracked rounds and thirty missed-green opportunities. These are minimum evidence floors, not statistical confidence intervals. Existing approximate external benchmark values are unchanged.
- Round-summary emails omit unconfirmed zero penalties; recorded positive penalties are labelled as a lower bound until confirmed. Existing sending cadence, opt-outs and fingerprint are preserved; no historical email resend is introduced.
- Penalty-free badges require confirmed complete zero-penalty cards; historical/default zeros no longer earn them. Existing Home/member-stats reconciliation refreshes persisted awards without a new job.
- Penalty averages, trend points, dashboard coaching aggregate and the Season Wrapped best-round comparison use only explicitly confirmed complete cards. An absent confirmation is unknown, including historical/default zeros. An actual confirmed zero is included. Other recorded scorecard totals are preserved; no score or handicap arithmetic changes.

## Explicit penalty confirmation

Round detail adds a small Penalty tracking panel. After reviewing every hole, the owner may confirm that penalties were recorded, including explicit zero holes. The acknowledgement updates both the round-detail view and its parent round list. Failure keeps the previous state with Retry. Confirmation can be removed.

Migration 0236 adds rounds.penalties_tracked (default false) and an own-round security-invoker RPC. Existing active-account, ownership and primary-scoring-device restrictions remain in force. The RPC compares the displayed hole/score/penalty snapshot with current database values, preventing confirmation of a concurrently changed card. Only complete scored nine-/eighteen-hole cards qualify. Actual score/penalty/round-membership edits invalidate the confirmation. Putt/fairway or rating-only edits do not invalidate it. Historical rounds are not silently backfilled as tracked; members may review and explicitly confirm them.

## Preserved behavior and contracts

Dashboard props, callbacks, stored score arrays, posting, WHS arithmetic, bets, team handicaps, game permissions and the existing daily stale-game scheduler are preserved. The popup uses the existing BottomSheet. Partner ordering and penalty inclusion intentionally change as above. Round adds one optional compatibility field; old code ignores the new default-false database column. AI request output schema remains unchanged; aggregate input adds a bounded numeric penaltyRounds field and uses null when no confirmed penalty sample exists. No new job, dependency or analytics dashboard is added.

## Production baseline 212.101

The owner reports production at 212.101. The cumulative source therefore also carries the Organizer tee-resolution fix (212.102), one yellow unfinished-round panel (212.103), daily stale-game rules (212.104), CI permission corrections (212.105–106), and the analytics corrections/reporting (212.107). This list comes from the source release ledger, not an independent read of deployed production.

Production version alone does not prove database migration state. Verify the schema_migrations ledger for 0234_daily_stale_games, 0235_analytics_quality and 0236_confirmed_penalty_tracking. Apply only the missing migrations, in numeric order, first in staging. Do not rerun already-applied historical files. Migration 0234 and 0235 are unchanged from their delivered releases.

## Release gates

Full local validation is recorded in RELEASE_VERIFICATION_212.108.md. Native GitHub/Supabase CI, Vercel staging Ready and required feature testing remain external gates. Preserve the existing production data-profile review for statistics changes. After those gates, use the staging-to-main PR and required verify check, confirm Vercel Production Ready, then perform a non-destructive smoke test. GitHub CLI has no signed-in account in this workspace; no push, PR, merge or deployment has been performed here.
