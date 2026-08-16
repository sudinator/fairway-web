#!/usr/bin/env python3
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1]
t = (root / "components/tournaments.tsx").read_text()
create = t[t.index("function CreateGame("):t.index("\nfunction GameRoom(")]
w = (root / "components/game/setup/create-game-workspace.tsx").read_text()
checks = {
    "workspace imported": 'CreateGameWorkspace, type CreateGameSection' in t,
    "workspace rendered": '<CreateGameWorkspace' in t,
    "four lean section keys": all(f'key: "{k}"' in create for k in ("game", "players", "format", "review")),
    "no pre-create structure section": 'key: "structure"' not in create and '{createSection === "structure"' not in create,
    "navigation state": 'useState<CreateGameSection>("game")' in create,
    "create only on review": 'createSection === "review"' in create and 'onClick={create}' in create,
    "workspace has no supabase": "supabase" not in w.lower(),
    "workspace has no rpc": ".rpc(" not in w,
    "workspace has no persistence": all(x not in w for x in ('.from("games")', '.from("game_players")', 'localStorage')),
    "default tee wording": "Default tee for the field" in create,
    "review gives exact next destination": "Next:" in create and "GC.postCreateDestinationLabel(GC.postCreateDestination(gameType, teamMode))" in create,
    "post-create destination centralized": "GC.postCreateDestination(gameType, teamMode)" in create,
    "split skins validated before game insert": create.find("GC.splitSkinsTooBig") < create.find('.from("games")'),
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    print("Create Game workspace contract FAILED:")
    for name in failed:
        print(f" - {name}")
    sys.exit(1)
print(f"Create Game workspace contract PASS ({len(checks)}/{len(checks)})")
