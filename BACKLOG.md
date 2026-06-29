# Birdie Num Num — Backlog & Improvements

Running list of things to build or tighten. Newest ideas near the top of each section.

## Games redesign — SHIPPED (v1.44.0 → v1.46.1)
Done: **Stroke play** (gross/net, lowest-total leaderboard) · **net-double cap lifted at entry** for stroke play AND four-ball/trifecta so real triples+ can be recorded (handicap still caps each hole at net double via `adjustedHoleScore`) · standalone **four-ball best-ball/shootout (aggregate)** scoring · **guided two-family chooser UI** (Stroke vs Match → Individual/Team) · new team/match games **open on Setup** with a "finish setup first" prompt on the Scorecard until handicaps/teams/matchups are done.

Still open from the original spec:
- **Split skins (DONE v1.47.0)** — no-carryover variant where tied players share the hole. Only *carryover* exists today; "split" was never built. Useful for big fields where carryovers stall.
- **Optional hard-gate:** block the Scorecard entirely until setup is complete (today it's a prompt, not a lock).

## Feature ideas

### In-app "How do I…" help search (no LLM, no tokens)
A search box in the Help section where players type natural "how do I…" questions and
get answers in a chat-style exchange (their question, then a step-by-step reply).
- **No LLM / no tokens:** a curated FAQ knowledge base bundled in the app + client-side
  search. Keyword + synonym matching, with a lightweight fuzzy-search lib (e.g. Fuse.js)
  to tolerate typos/phrasing. Deterministic retrieval, runs fully in the browser, works
  offline, instant, private.
- Each FAQ entry: the question, keywords/synonyms, and ordered steps that name the in-app
  location (e.g. "Games → Create → share the 6-digit code"). Could deep-link a button that
  jumps the player to the right screen.
- **Coverage caveat:** only answers what's authored; it's smart FAQ search styled as chat,
  not real conversational understanding. Quality scales with the entry set + synonyms.
- **Tie-in:** when there's no good match, offer "Didn't find it? Send a question" → routes
  into the feedback capture below (which also surfaces missing FAQs to add).
- Optional later: LLM fallback *only* on a miss (hybrid) — burns tokens only when local
  search fails. Out of scope for the no-token version.

### Feedback: report a bug / request a feature (wishlist)
Let players report something missing or broken, or suggest a feature, from inside the app.
- Simple form: type (bug | wish) + message. Auto-attach context (app version, active
  group, current screen) so bugs are actionable. Optional screenshot.
- Writes to a Supabase `feedback` table with user id + timestamp + app version.
- Admin review surface (like Oversight/Users): list submissions, set status
  (new / triaged / done), optionally reply or notify the requester.
- No LLM needed.

### Post-round stats completeness reminder
After a round is **completed**, if the player has been recording stats, the scorecard
should flag any holes where stats are missing and help them fill the gaps.
- **Scope:** fairway hit (FIR) and putts only. Ignore sand and penalties.
- **Trigger:** only when the round is complete AND the player has entered *some* stats
  (don't nag players who never track stats).
- **Par-3 handling:** "fairway hit" is N/A on par 3s — exclude par-3 holes from the
  fairway-missing check (still check putts on par 3s).
- **UX:** a clear banner/summary listing the holes with missing FIR/putts, plus a direct
  path to fix them (e.g. "Add my stats" → opens the player's own round in the editor).
- **Marker note:** explain that their score may have been kept by a *marker*, so the gross
  is in but their personal fairways/putts may not be — and that they add those themselves
  on their own round afterward. Make the "where/how" obvious.

## Known weaknesses / hardening (deferred, not urgent)
From the security & structure review. None are emergencies; tackle when convenient.
- **Auth-login disconnect (DONE v1.50.0 / migration 0038):** wipe/merge/ban remove or flag the *profile* but not the
  Supabase auth login, so a removed user can sign back in and get a fresh profile (and,
  with a default group set, auto-join it). Fully retiring an account needs deleting it in
  the Supabase Auth dashboard.
- **Whole-array score writes (NOT a concurrency risk):** `setPlayerHole` rewrites a
  player's entire scores/putts arrays each save. This is safe because the marker model
  guarantees a single writer per row: with no marker each player edits only their own row;
  once a marker is active every other player's entry UI is hidden and `cardCanEdit` grants
  the card to the marker alone. The only residual is the *same* marker on two devices —
  by-design "marker is source of truth, last write wins," not a conflict. Per-hole rows are
  therefore NOT needed.
- **Silent failures:** several paths `catch {}` (recordMyGameRound, logActivity, background
  save). Resilient, but can mask real data-loss errors — surface them somewhere visible.
- **Default-group auto-join hits new signups too:** fine for a closed society; a liability
  if sign-ups ever open beyond invites.
- **Shared course-data blast radius:** one wrong rating/slope/SI on a shared course skews
  handicaps for everyone using it; no guard against a bad edit propagating.
- **Orphaned support sessions:** rely only on the banner to remind the admin to exit;
  consider auto-expiry.
- **No server-side score validation:** clients can write arbitrary values into game_players
  score arrays.
- **No automated tests** for the PL/pgSQL admin RPCs.

## Housekeeping
- **Marketing one-pager:** `marketing/Birdie-Num-Num-overview.pdf`. Regenerate with
  `python3 marketing/make_onepager.py` and keep it current as features ship.

## Newly requested (June 2026)

1. **Scoring audit trail** [ALREADY SHIPPED v1.52.0 — migration 0042 AFTER UPDATE trigger + admin_score_audit RPC] - log every score change for dispute resolution + debugging.
   Capture who / when / from-value / to-value per changed hole. Best done as a DB
   trigger on game_players (BEFORE/AFTER UPDATE) that diffs old vs new `scores`
   (and optionally putts/penalties) and inserts one audit row per changed index:
   {game_id, game_player_id, hole_index, field, old_value, new_value, changed_by =
   auth.uid(), changed_at}. A trigger captures ALL write paths (direct update, marker,
   set_game_scores RPC), unlike app-level logging. Pairs naturally with the 0040
   validation trigger. Add an admin view to read a player's/game's history. New migration.

2. **Pre-conclusion completeness popup** [ALREADY SHIPPED v1.51.0 — modal on endGame + finishMyGroup] - before a round/game is locked (organizer
   endGame AND marker "Finish my group"), raise a modal listing what's missing:
   - Always: holes with no score entered (per player, or for the finishing group).
   - If stats are being tracked (any putts/fairway recorded): also list missing putts
     and missing fairways (par-3s excluded from fairways), mirroring the post-round
     StatsReminder but pre-lock and game-wide.
   - If NO stats tracked: don't flag stats, only confirm all scores are in.
   Warn-and-confirm, not a hard block (consistent with "flag not gate"). App code only.

3. **Copy scorecard to chat** [mockup presented Jun 2026 — enhanced rounds-style scorecard, awaiting go] - a "Copy" action that builds a plain-text snapshot of
   the leaderboard/scorecard (not the live LINK) for pasting into WhatsApp/iMessage/etc.
   Compact, readable text: title + standings + per-player line (and optionally a small
   hole grid). Reuse the GHIN-style text formatting approach. App code only (clipboard).

4. **Round summary action-row layout** [SHIPPED v1.63.0] - in the round-summary
   (round-detail) view, the **Delete** button wraps onto its own second line. Put it
   inline on a single row with the other actions — **Post to GHIN**, **Share**, and
   **Edit round** — so all four sit on one line. CSS/layout only (flex row that wraps
   gracefully on very narrow screens; keep Delete visually distinct/last). App code only.

## Shipped
- v1.65.0 — Offline mode, Phase 2 (durable sync, no longer dependent on the browser online event). Each game-player row now carries a synced “watermark” (the arrays last confirmed on the server); a row is PENDING when its local backup differs. A drainOutbox() pushes every pending row authoritatively (full last-write-wins per row — safe under the single-writer model, which v1.64.1 freezes offline) and updates the watermark on success. It runs on reconnect (drain-first, THEN reload to pull others’ scores), on app foreground/focus, on a 20s poll, and via a new manual Sync now button — so a flaky online event can’t strand scores. The bottom status pill now persists a live count: “N holes not synced yet” with a Sync now button when online, or “N holes saved on this phone · will sync when you reconnect” when offline; pushScores and load() both keep the watermark current so normal online play shows 0 pending. Master reset clears watermarks too. With Phase 1 (cold-open) + the v1.64.2 fast-boot + this, the tee-off-to-clubhouse no-signal round is fully covered. On-device airplane-mode test still recommended.
- v1.64.2 — Offline cold-launch latency fix: the v1.64.0 fallbacks only ran AFTER a failed network call, so a killed/locked reopen offline sat on “Loading groups…” for several seconds before showing the scorecard. All boot loaders now check navigator.onLine FIRST and go straight to the cache/snapshot without ever awaiting a request that can’t complete — Home loadProfile/loadGroups/loadRounds, the game-room load() (snapshot boot factored into a helper), the resume group check, and the course-tees lookup. Online path unchanged. Confirmed working: individual scoring offline + banner clears on reconnect.
- v1.64.1 — Offline group-scoring safety: while offline, all ownership/finalize operations are now FROZEN — marker take-over, hand-off, “everyone scores their own”, the tee-group claim/release, finish-group, and end-game. Each is guarded at the handler (a hard backstop that blocks the action even if a control is tapped) AND the controls are replaced with an inline “Offline — you can’t change who’s scoring until you reconnect” notice. Rationale: those ops do an optimistic local state flip before a server RPC, so offline they’d desync who the scorer is across devices and break the single-writer-per-row invariant (two phones writing the same rows → last-write-wins clobbering on reconnect). Score ENTRY by the current holder is unaffected and continues to save locally. Pairs with v1.64.0 Phase 1.
- v1.64.0 — Offline mode, Phase 1 (cold-open + keep scoring with no signal). The assumption: you have signal at the first tee, none until the clubhouse. While online, the app now snapshots the full active-game payload (game row, all player rows, course tee yardages) to localStorage, and caches the boot context (profile, groups, active group) + last session identity. On a cold launch with no signal it boots from those: the entry gate falls back to the cached identity instead of the login screen (offline only), Home hydrates the active group from cache, the game-room resume no longer clears its pointer offline (resumes via the snapshot's group), and the game room loads from the snapshot merged with this device's per-hole backups. A global gold banner shows "Offline — scores are saved on this phone and will sync when you reconnect." Solo rounds already cold-resumed via the draft. Master reset now also clears the snapshot. All changes are additive/offline-gated; the online boot path is unchanged. NOT yet done (Phase 2): durable outbox + polling drain + "Sync now" + pending count (today still relies on the online-event reload to push offline holes). On-device airplane-mode test required — esp. expired-token cold launch on iOS.
- v1.63.1 — Rounds tab round-detail header: moved the red Delete button to the far right of the Back row (Back left, title between, Delete pinned right), with Post to GHIN / Share / Edit round on their own row beneath; Delete previously wrapped to its own line. Delete keeps its confirm ("Delete this round? This can't be undone.").
- v1.62.0 — Design-review #1: extracted shapeOf, dotStrokes, chBasis, pkey out of the 5k-line tournaments.tsx into a pure, importable lib/game-shape.ts (structural input types; imports golf.ts). tournaments.tsx now imports them. Added lib/game-shape.test.ts (full format matrix + adversarial stray-data + malformed + dotBasis<->scoring alignment, 83 assertions) and an `npm test` script that compiles + runs it and exits non-zero on failure. Pure code move — tsc proves equivalence; no behavior change. Also documented (in chat) the four-ball vs trifecta/skins team-setup UI inconsistency as organic growth to unify next via a write-side structureFor(mode).
- v1.61.5 — shapeOf refactor stage 4 of 4 (COMPLETE). The skins-style selector, match-players toggle, and skins tie-mode (split/halved) selector now read shapeOf.skinsStyle/usesTeams instead of re-deriving from teams/foursomes presence; the four-ball and trifecta view team-label checks route through shapeOf.usesTeams too. Final scan confirms every behavioral mode decision flows through shapeOf; remaining raw-array reads are safe data access, player-removal maintenance, or canSwitchTo target-readiness checks — not mode inference. Single source of truth achieved across all six formats + three skins styles.
- v1.61.4 — Fix the strokes-panel "Show all N groups" count in match play. It counted matchups (pairings) but the filter works by TEE GROUP, so a 2-tee-group / 4-matchup game read "4 groups". When tee groups are in use the label now counts tee groups; otherwise it counts units as before. Pre-existing labeling bug, fixed alongside the adjacent totalUnits code.
- v1.61.3 — Fix four-ball setup regression from stage 3. shapeOf.usesTeams was unconditionally true for four-ball/trifecta, forcing a global Teams step even for plain four-ball (which has no global teams — sides are pair A/B inside each foursome). usesTeams is now gated on two named teams actually existing (teams.length===2), matching the pre-refactor behavior: plain four-ball shows Players + Matchups(foursomes) only; team-mode four-ball, team match, team skins, and trifecta still get the Teams step. The signed-off contract truth table listed four-ball usesTeams as unconditional yes — that was the error.
- v1.61.2 — shapeOf refactor stage 3 of 4. Setup-missing banner, setup stepper, step hints, hasStructure, totalUnits/myUnits, and the summary unit-selection helper all now read shapeOf instead of raw teams/foursomes/pairings presence. The two drifting duplicate usesTeams/usesMatchups/usesFoursomes blocks are collapsed into one shapeOf read each. Pure refactor; also hardens these against stray structure (e.g. summary panel hidden + per-player units for individual skins regardless of leftover pairings).
- v1.61.1 — shapeOf refactor stage 2 of 4. SkinsView's isTeamSkins / isTeamBestBallSkins now derive from shapeOf.skinsStyle (drives all three view branches and the team labels inside the view); the group/entry card team-label colour is gated on shapeOf.usesTeams so stray teams can't colour an individual game. Pure refactor, no behavior change.
- v1.61.0 — Canonical game-shape refactor, stage 1 of 4. Added shapeOf(game) as the single source of truth for mode (type, skinsStyle, usesTeams/Matchups/Foursomes, dotBasis, view); dotBasis is defined to equal the scoring basis. Routed dotStrokes through shapeOf.dotBasis, which FIXES 1:1 team skins dots (now relative-to-opponent, matching computeHeadToHeadSkins, instead of absolute). Stages 2-4 (SkinsView branches, setup stepper/banner, summary helpers + selectors) to follow, replacing the remaining ad-hoc inferences.
- v1.60.3 — Individual skins no longer shows the 1:1 matchup view. That view was gated on game.pairings.length > 0 alone, so leftover/stashed pairings made individual skins render matchup cards; it now also requires team skins (isTeamSkins), so individual always uses the per-player view regardless of lingering pairing data.
- v1.60.2 — Preserve-and-hide for mid-round structure switches (migration 0046 adds games.structure_stash). Skins Individual/1:1/2v2 and match Individual/Team now stash the team structure instead of clearing it, so switching back restores matchups intact. Chose a stash/restore model over reworking the team-vs-individual determinant everywhere (lower risk; no scoring/share-page changes). Plain game_type switches already preserved structure.
- v1.60.1 — Fixes after mid-round switch to individual skins: (1)+(2) individual skins no longer asks for or honors matchups — usesMatchups now requires team skins (teams assigned), so individual skins shows only Players + Groups; (3) switching to individual with >4 players now flips split/halved to carry over (with a notice), and the Halved tie option is disabled for individual skins in a >4 field, matching the create-time guard.
- v1.60.0 — Mid-round structure switching in the Game setup tab: skins can move between Individual / 1:1 Teams / 2v2 Best-ball, and match between Individual / Team (4v4), live and score-preserving (Individual skins confirms before clearing the team setup). Closes the gap where a started team-skins game couldn't be converted to singles. Next: converge the New-game and setup pickers onto one shared component.
- v1.59.2 — Renumbered the group-finish migration to 0045 (0043/0044 already existed in Supabase) and aligned post_group_rounds with the 0044 post_game_rounds fix: match-date stamping + race-safe ON CONFLICT (game_id,user_id) upsert (important since concurrent group finishes are likely). Also restored recordMyGameRound to stamp the match date (game.played_at), which an earlier working copy had reverted to created_at.
- v1.59.1 — Round detail now opens with a “Round summary” block: differential + gross/vs-par, and an Out / In / Total table for Gross, Net (full course handicap by stroke index), and Stableford points. Differential shows “—” without rating/slope; a 9-hole round shows “—” for the unplayed nine.
- v1.59.0 — (1) Group finish now posts rounds for EVERY player in the tee group via new SECURITY DEFINER RPC post_group_rounds (0043), fixing partners' rounds not landing in their history after group scoring; recordMyGameRound still runs as a guaranteed fallback for the keeper. (2) Skins games can switch carry over / halved mid-round from the in-game Settings panel (new updateSkinsMode + onSetSkinsMode); team best-ball skins can also switch best ball / aggregate there.
- v1.58.7 — skins totals show halves as “3½” instead of “3.5”. Hoisted/updated fmtSkins so it covers every skins total (team best-ball team boxes + per-foursome, 1:1 team totals + per-match, individual player totals, and “skins still in play”).
- v1.58.6 — stroke dots for team best-ball skins: dotStrokes now allocates relative to the foursome's lowest playing handicap (low plays scratch) for team best-ball skins, matching its fourballNets scoring. Previously skins fell through to the absolute basis, so the scratch player still showed dots. Audit confirmed all other formats already agree: singles/team match = relative to opponent; four-ball/trifecta = relative to foursome low; stableford/stroke/plain skins/1:1 team skins = full playing handicap.
- v1.58.5 — team skins options: fixed a literal-escape bug in the create panel (showed “Two teams \\u00b7 best-ball skins”). Renamed the Match · Team button to just “Skins”, and the panel now offers Team score (Best ball / Aggregate) and When a hole ties (Carry over / Halved). Extended computeTeamBestBallSkins to honour aggregate scoring (sum of the side's nets) and halved ties (split ½ a skin each, no carry); the view reads team_score_mode + skins_mode and labels accordingly.
- v1.58.4 — best-ball skins moved to Match · Team (beside Four-ball and Trifecta), since it's a 2-v-2 better-ball format; individual and 1:1 team skins stay under Stroke · Skins. Purely a create-form relocation — the game is still stored as skins+foursomes, scoring unchanged. Also fixed the team best-ball skins scorecard to name the winning side by its players (e.g. “Amit & Dave wins”) instead of “Pair 1 wins”.
- v1.58.3 — consistent stroke dots in team match play: the orange strokes-received dots on the live cards now use the same handicap basis as the scoring. Added a dotStrokes() helper — match = relative to opponent, four-ball/trifecta = relative to the lowest playing handicap in the foursome (low plays scratch), stableford/stroke/1:1 skins = full playing handicap. Routed the group scorecard (recvFor) and the in-game entry/match card through it. Previously four-ball/trifecta cards showed full course-handicap strokes while the results were computed relative; now they agree. Posting/sharing an individual round still uses the full playing handicap (intentional, a different number from live match relativity).
- v1.58.2 — score box only when empty: a played hole now shows just the score mark (no surrounding box); empty holes keep the green “+” box as the cue. Restored whole-row tap on the entry grid and whole-card tap on the match card to open the hole editor.
- v1.58.1 — score is now a tappable box: on the entry grid and the match card the Score column renders as a bordered box (green “+” box when empty, the score mark inside when played) so it clearly invites a tap to open the hole editor. Removed the whole-row / whole-card tap target in favour of the box.
- v1.58.0 — unified hole editor across all scorecards: extracted the group scorecard's hole-editor popup into a shared HoleScoreModal and wired it into the in-game score-entry card, the per-player match card, and the solo round editor. Tapping any hole opens one popup to enter score, fairway, putts and sand/penalty; defaults to par on open; Save & next advances to the next hole on a personal card (next player on the group card). Inline NumPicker/FW/putt/sand controls on the entry cards retired in favour of a tappable read-only-style display.
- v1.57.1 — scorecard spacing redesign: replaced the lopsided fixed-pixel columns on the read-only card and the in-game score-entry grid (24px Par vs a giant 1fr Score) with evenly-balanced fractional columns under aligned headers, so the two-row cards read professionally. All fields preserved (Par/Hcp/Score/FW/Putt/Sand-Pen/Pts, plus Opp/Match on the entry grid for fourball/match). Match card and group card already had even columns + full fields, left intact.
- v1.57.0 — share a solo round from the round summary: added a Share button on RoundDetail (hole-by-hole rounds) that opens the same scorecard share card used for games (PNG to share sheet + copy-as-text). Refactored share-card into a shared inner renderer with ShareScorecardModal (games) and new ShareRoundModal (solo rounds).
- v1.56.2 — scorecard yardage audit + fix: solo rounds were not persisting per-hole yardage (the holes-table inserts in round-editor omitted the yardage column), so a saved/reopened round showed none even though the live round did. All three inserts now write yardage; load already reads it. Verified every surface shows yardage by the correct tee: read-only card (Option B), entry grid (Option B), match-play card, group card (refTee), share card, and the in-game read-only build.
- v1.56.1 — fix: individual (solo) round entry card showed no yardages. The round-editor entry map wasn't passing yards, and the course-template fallback build didn't read the selected tee's yardages. Now the solo entry card resolves yardage from the round's tee (round.tee_name -> favorite_courses tees[].yardages), matching the read-only card.
- v1.56.0 — yardage on in-game cards: score entry grid redesigned to two rows per hole (Option B) with Hole no. + this player's tee yardage + S.I. on the top line; entry card resolves yardage from the player's chosen tee (courseTees). Group card now resolves its per-hole yardage from the game's tee data (shows even for older games created before backfill); falls back to stored yardage if a group mixes tees. Round-save from a game also records the player's tee yardage. Completes "yardage on ALL scorecards by tee."
- v1.55.0 — yardage on scorecards + tee picker: read-only scorecard (Rounds tab, round detail, share image) redesigned to TWO ROWS per hole (Option B) — top line shows Hole no. + per-tee yardage + S.I., scoring row beneath (frees columns, less crowding on phones). Yardage resolves from each player's chosen tee (favorite_courses tees[].yardages); solo rounds use the round's tee, share card resolves the player's tee. Tee pickers in New Round and Create Game now show total yardage alongside CR/SL. (Still to do: entry grid + group card in-game surfaces.)
- v1.54.1 — Yardage Backfill tool: added a per-course editor for cases the bulk pass can't handle — (a) re-look-up on golfcourseapi by search + map tees (fixes stale/wrong external_id mapping errors, e.g. Fiddler's Elbow River), (b) manual per-tee/per-hole entry for custom courses. Course picker shows yardage status per course. All paths write ONLY tees[].yardages (external_id and everything else untouched). Bulk error/skip notes now point to the editor.
- v1.54.0 — admin Yardage Backfill tool (Courses screen, admin-only): pulls per-tee/per-hole yardages from golfcourseapi via the existing /api/courses?id= endpoint and fills favorite_courses.data.tees[].yardages. Two-step Preview —> Apply; writes ONLY missing yardages, never overwrites par/SI/ratings/names/corrections; matches tees by name, flags+skips unmatched tees and hole-count mismatches; skips custom courses. No migration, no new env var (reuses GOLF_API_KEY). Prereq for showing per-hole yardage on the scorecard by tee (display TBD).
- v1.53.1 — review fix-pack: stroke leaderboard columns Thru/Gross/Par(+/-)/Net (dropped redundant Tot, fixed eyebrow that read NET STABLEFORD); Score history moved to Setup tab; Share-my-scorecard button moved to bottom of screen; six-hole segments made stroke-aware (net score, lowest-net-total wins) + labels; round date now uses LOCAL calendar date (was UTC — showed tomorrow after ~8pm ET); ScoreMark double-ring rebuilt with real borders so it survives PNG export (html-to-image drops box-shadow).
- v1.53.0 — copy/share scorecard: a player can share THEIR OWN card from a game as the vertical Rounds-style ScoreViewCard, exported to PNG via html-to-image for the share sheet (download + Copy-as-text fallbacks). New dependency: html-to-image.
- v1.52.0 — scoring audit trail: migration 0042 logs every per-hole change (score/putts/penalties) with old—>new, who, and when, via an AFTER UPDATE trigger on game_players (captures all write paths). Organizer/admin can open a collapsible "Score history" panel in the game (admin_score_audit RPC).
- v1.51.0 — pre-conclusion completeness popup: ending a game / finishing a group now opens a modal listing per-player gaps (unentered scores; and missing putts/fairways for players who track stats, par-3s excluded). Warn-and-confirm, not a hard block; replaces the plain browser confirms on endGame + finishMyGroup.
- v1.50.2 — error-handling pass: admin/game mutations (setFormat, setTeamScoreMode, endGame, enter/exitSupportGroup) now surface errors and don't optimistically proceed; RoundEditor backgroundSave detects returned .error and shows a calm "saved on device, retrying" indicator instead of swallowing failures.

- Match-play layout DECISION (Jun 2026): keep per-hole CARD layout, not the grid (tap-target/readability on phone). Grid mockups were exploratory.
