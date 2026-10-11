# Release Verification — 177.42.260816

## Scope
Corrective release for stable alphabetical player ordering in Manage Game setup after player-row mutations.

## Root cause
`GameRoom.load()` intentionally reloads `game_players` after tee/handicap/team mutations. The query has no database `ORDER BY`, so PostgreSQL return order is not a UI contract. An UPDATE can produce a different physical tuple order, and OrganizerPanel previously rendered the incoming `players` array directly. Result: after changing a tee, the edited player could jump to the bottom of the setup list even though no roster semantics changed.

## Fix
- OrganizerPanel derives a presentation-only `orderedPlayers` array from `players`.
- Sort is alphabetical by `display_name`, case-insensitive, with `id` as deterministic tie-breaker.
- The canonical order is used for the setup player editor, sponsor list, and team-assignment roster.
- `GameRoom.players` is NOT reordered. Scoring, realtime, mutation ownership, database writes, groups, matchups, scorecards, and downstream business logic keep the existing state order and contracts.

## Permanent guard
`ci/check_game_setup_workspace_contract.py` now requires:
- explicit canonical roster sorting;
- case-insensitive display-name comparison;
- stable id tie-breaker;
- the player editor to render `orderedPlayers` rather than the raw database-return array.

Negative mutation test: replacing the player-editor render with raw `players.map(...)` makes the guard fail as intended.

## Validation executed locally
- Game setup workspace contract: PASS (28 boundary links + no DB ownership).
- Historical migration dependency closure and database/source-contract guards: PASS through the executed guard segments.
- UI guards executed: font size, global rules, chart overflow, date inputs, bottom sheets, safe-area frames, contrast, popup close — PASS.
- Tee setup contract: PASS, including tee recalculation/persistence and no borrowed tee rating/slope.
- Extraction reachability/state hygiene: PASS.
- Workflow fault simulation: PASS (50,087 checks; 50,000 randomized RSVP operations).
- Historical rating/slope correction contract: PASS.
- Alphabetical-order guard negative test: PASS (deliberate regression was detected).
- No migration.

## Environment limitation / remaining mandatory gates
`npx tsc --noEmit` cannot complete in this container because the installed dependency tree is incomplete: TypeScript cannot resolve multiple type roots (`react`, `node`, `d3-*`, `cookie`, etc.). A fresh `npm ci` attempt also failed in this environment. Therefore dependency-backed TypeScript, full unit suite, production build, and complete `npm run ci` remain GitHub-authoritative gates.

## Release status
**NOT DEPLOYABLE YET.** Push to staging only after applying the overlay. Require green GitHub CI/type/test/build, Vercel staging Ready, targeted browser validation (change tee on first/middle/last players and confirm alphabetical position remains stable), then PR verify / Production Ready / non-destructive smoke before closing.
