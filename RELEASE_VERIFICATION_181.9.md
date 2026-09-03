# Release verification — 181.9.260903

## Defect

The visible Teams step used the internal `structure` key and redirected completed setup to Review instead of opening Teams.

## Executed DOM interaction test — PASS 19/19

- Rendered a fully configured Ryder Cup Trifecta with two teams and eight named players.
- Clicked the visible Teams & groups control from Control Center.
- Verified the Ryder Cup Teams screen opened.
- Verified Violet, Burgundy and all eight player names rendered.
- Verified Review content did not render.
- Navigated Teams → Groups → Control Center → Teams and verified the roster remained reachable.
- Repeated with incomplete groups and verified Teams still opened directly.

## Full release gate

- TypeScript and hook lint: PASS.
- Unit/render/differential suite: PASS — 189,947 assertions.
- Group assignment interaction: PASS — 297 assertions.
- Teams navigation DOM interaction: PASS — 19/19.
- Competitive assignment contract: PASS — 32/32.
- Lifecycle, security, migration, design-scale, contrast and mobile-fit guards: PASS.
- Production build: PASS using documented local VAPID opt-out and placeholder public Supabase variables.
- No migration. Migration 0148 remains current.

## Staging acceptance

In game 912410, open Manage Game, return to Control Center, click Teams, verify both inherited team rosters appear, open Groups, return to Control Center and click Teams again.
