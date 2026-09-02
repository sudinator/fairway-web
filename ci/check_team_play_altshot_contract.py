#!/usr/bin/env python3
from pathlib import Path
import sys

checks = []
def check(ok, msg):
    checks.append((ok, msg))
    print(("PASS" if ok else "FAIL") + " " + msg)

shape = Path('lib/game-shape.ts').read_text()
create = Path('lib/game-create.ts').read_text()
workspace = Path('components/game/setup/game-setup-workspace.tsx').read_text()
scorecard = Path('components/game/scorecard-views.tsx').read_text()
tourn = Path('components/tournaments.tsx').read_text()
scoring = Path('components/game/scoring-views.tsx').read_text()
migration = Path('migrations/0140_alt_shot_side_scores.sql').read_text()
tombstone = Path('migrations/0141_alt_shot_clear_tombstones.sql').read_text()

check('gt === "match" || gt === "trifecta"' in shape, 'Match and Trifecta retain explicit matchup contract')
check('((gt === "fourball" || gt === "alt_shot") && !teams2)' in shape, 'Four-Ball/Alternate Shot use matchups only for legacy no-team games')
check('o.gameType === "fourball" || o.gameType === "alt_shot" || o.gameType === "trifecta"' in create, 'new Four-Ball/Alternate Shot/Trifecta games create two teams')
check('showGroupsTab = !usesFoursomes || teamGroupFormat' in workspace, 'team Four-Ball/Alternate Shot expose Groups setup')
check('onSetAltShotFirstDriver' in workspace and 'a_first' in scorecard and 'b_first' in scorecard, 'Alternate Shot first-driver selection is persisted and consumed')
check('altShotFanOut' not in tourn, 'live Alternate Shot write path no longer fans a score into player rows')
check('save_alt_shot_side_score' in tourn, 'live Alternate Shot scoring writes through canonical side-score RPC')
check('canonicalAltShotGross' in scorecard and 'canonicalAltShotGross' in scoring, 'scorecard and results read canonical side-owned scores')
check('game_alt_shot_scores' in migration and "record_migration('0140_alt_shot_side_scores')" in migration, '0140 creates and records canonical side-score store')
check('delete from public.game_alt_shot_scores' in migration and 'alt_shot_scoring_started_at = null' in migration, 'score reset clears side scores and scoring-start marker')
check('o.gameType === "alt_shot" || o.sideContestsEnabled === false ? { scheme: "none"' in create, 'Alternate Shot and Ryder Cup session side games default off')
check('deriveTeamFoursomesFromGroups' in tourn, 'team Four-Ball/Alternate Shot derive contests from Teams + Groups')
check('alter column strokes drop not null' in tombstone and "record_migration('0141_alt_shot_clear_tombstones')" in tombstone, '0141 persists explicit clear tombstones for legacy-score masking')
check('strokes: number | null' in Path('lib/alt-shot-side-scores.ts').read_text(), 'canonical side-score model represents clear as a persisted null override')

failed = [m for ok,m in checks if not ok]
print(f"team-play/Alternate Shot contract: {len(checks)-len(failed)}/{len(checks)} PASS")
sys.exit(1 if failed else 0)
