#!/usr/bin/env python3
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1]
t = (root / "components/tournaments.tsx").read_text()
w = (root / "components/game/setup/create-game-workspace.tsx").read_text()
checks = {
    "workspace imported": 'CreateGameWorkspace, type CreateGameSection' in t,
    "workspace rendered": '<CreateGameWorkspace' in t,
    "five section keys": all(f'key: "{k}"' in t for k in ("game", "players", "format", "structure", "review")),
    "navigation state": 'useState<CreateGameSection>("game")' in t,
    "create only on review": 'createSection === "review"' in t and 'onClick={create}' in t,
    "workspace has no supabase": "supabase" not in w.lower(),
    "workspace has no rpc": ".rpc(" not in w,
    "workspace has no persistence": all(x not in w for x in ('.from("games")', '.from("game_players")', 'localStorage')),
    "default tee wording": "Default tee for the field" in t,
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    print("Create Game workspace contract FAILED:")
    for name in failed:
        print(f" - {name}")
    sys.exit(1)
print(f"Create Game workspace contract PASS ({len(checks)}/{len(checks)})")
