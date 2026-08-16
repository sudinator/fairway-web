#!/usr/bin/env python3
from pathlib import Path
import sys
root = Path(__file__).resolve().parents[1]
tour = (root / "components/tournaments.tsx").read_text()
leader = (root / "components/game/leader-row.tsx").read_text()
setup = (root / "lib/setup-draft.ts").read_text()
create = (root / "lib/game-create.ts").read_text()
checks = [
    ("resume checkpoints pagehide", 'window.addEventListener("pagehide", checkpoint)' in tour),
    ("resume checkpoints visibility hidden", 'document.visibilityState === "hidden"' in tour),
    ("resume restores workspace section", 'setCreateSection(d.createSection as CreateGameSection)' in tour),
    ("resume restores handicap overrides", 'setHcpOverrides(d.hcpOverrides || {})' in tour),
    ("draft stores workspace section", 'createSection?: "game" | "players" | "format" | "structure" | "review";' in setup),
    ("draft stores handicap overrides", 'hcpOverrides?: Record<string, number>;' in setup),
    ("leader no-bet label is capability gated", 'showBetStatus && p.bets === false' in leader),
    ("create path passes TGC capability", 'tgcBettingEnabled: effectiveGroupId(activeGroupId) === TGC_GROUP_ID' in tour),
    ("non-TGC guest row defaults neutral", 'bets: o.tgcBettingEnabled === false ? true : false' in create),
    ("in-game guest betting is TGC gated", 'bets: effectiveGroupId(game.group_id) === TGC_GROUP_ID ? false : true' in tour),
]
failed=[n for n,ok in checks if not ok]
if failed:
    print("CREATE_GAME_RESUME_BETTING_SCOPE_FAIL")
    for n in failed: print("-", n)
    sys.exit(1)
print(f"CREATE_GAME_RESUME_BETTING_SCOPE_PASS {len(checks)}/{len(checks)} checks")
