#!/usr/bin/env python3
from pathlib import Path
import sys
root = Path(__file__).resolve().parents[1]
t = (root / "components/tournaments.tsx").read_text()
m = (root / "lib/game-setup-draft.ts").read_text()
checks = [
    ("CreateGame imports canonical draft builder", 'buildGameSetupDraft' in t and 'toLegacySetupData' in t),
    ("canonical model exists", 'export type GameSetupDraft =' in m),
    ("game fields mapped", all(x in m for x in ['favoriteCourseName', 'defaultTeeIdx', 'creatorHandicapText'])),
    ("player fields mapped", all(x in m for x in ['selectedPlayers', 'guestPlayers', 'handicapOverrides'])),
    ("format fields mapped", all(x in m for x in ['gameType', 'allowancePct', 'teamScoreMode', 'trifectaScoring', 'strokeBasis', 'fmtFamily', 'matchKind', 'teamMode', 'skinsTeamStyle', 'skinsMode'])),
    ("structure fields mapped", all(x in m for x in ['team1', 'team2'])),
    ("flight fields mapped", all(x in m for x in ['mode:', 'count:'])),
    ("legacy compatibility adapter exists", 'export function toLegacySetupData' in m and 'export function fromLegacySetupDraft' in m),
    ("CreateGame save uses compatibility adapter", '...toLegacySetupData(buildGameSetupDraft({' in t and 'const draftSnapshot = useMemo(() => ({' in t),
]
failed = [name for name, ok in checks if not ok]
if failed:
    print("CREATE_GAME_DRAFT_CONTRACT_FAIL")
    for name in failed: print(f"- {name}")
    sys.exit(1)
print(f"CREATE_GAME_DRAFT_CONTRACT_PASS {len(checks)} checks")
