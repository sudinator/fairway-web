# Release Verification — 178.22.260829

Target: staging
Migration: none (0140 + 0141 remain prerequisites already applied to staging)

## Behavior changes
- Four-Ball/Alternate Shot creation exposes editable team-name fields even though team mode is mandatory.
- Manage Game → Teams exposes team-name editing without changing team keys or assignments.
- Group Results / Legs is rendered inside Game Setup → Format and is reachable when revisiting setup.
- `leg_config.scheme = none` suppresses Group Results entirely.
- Team Individual Match status expands/collapses a hole-by-hole history derived from the existing canonical `matchProgress()` function.

## Executed validation
- team/setup/results regression contract: PASS 7/7
- game setup workspace boundary contract: PASS
- React hook-order source guard: PASS
- team-play / Alternate Shot contract: PASS 14/14
- game structure contract: PASS
- Create Game format-selection contract: PASS 17/17
- version ledger: PASS
- release verification: 20/20 PASS
- design scale / palette / overlay / contrast: PASS
- workflow fault simulation: 50,087 PASS
- migration / RLS / environment / integration source contracts through setup/create-game guards: PASS
- full `npm run guards`: progressed through the source guard chain; final assertion guard could not execute because local `npm test` cannot run with the incomplete dependency tree

## Not executed locally
- dependency-backed ESLint / TypeScript / Next build / full npm test suite: local dependency tree is incomplete; GitHub CI and Vercel staging remain authoritative.
- real staging integration and manual UI acceptance: required after staging deployment.

## Manual acceptance required
1. Four-Ball creation: team names visible/editable; Teams + Groups; no Matchups.
2. Four-Ball Manage → Teams: rename both teams and confirm assignments persist.
3. Match/Four-Ball/Trifecta Format: Group Results / Legs visible; Off removes Group Results; On restores it.
4. Team Individual Match: status click expands progression; collapse/reopen works; scores/results unchanged.
5. Trifecta still has Teams + Groups + Matchups.
6. Alternate Shot regression smoke: teams/groups/first-driver/side score remain correct.
