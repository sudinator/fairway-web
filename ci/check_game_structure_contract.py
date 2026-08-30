#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
structure = (root / "lib/game-structure.ts").read_text()
tournaments = (root / "components/tournaments.tsx").read_text()
views = (root / "components/game/scoring-views.tsx").read_text()
tests = (root / "lib/game-structure.test.ts").read_text()

required_helpers = [
    "buildFormatPatch", "buildSkinsStylePatch", "buildMatchTeamPatch",
    "addPairing", "removePairing", "addFoursome", "removeFoursome",
    "renameFoursome", "assignFoursomePlayer", "unassignFoursomePlayer",
    "deriveTeeGroupsFromFoursomes",
]
for name in required_helpers:
    if f"function {name}" not in structure:
        raise SystemExit(f"FAIL: missing pure structure helper {name}")

runtime_links = [
    (tournaments, "buildFormatPatch(game, next)", "format transition"),
    (tournaments, "buildSkinsStylePatch(", "skins stash/restore"),
    (tournaments, "buildMatchTeamPatch(game, on)", "match team stash/restore"),
    (views, "nextPairingAdd(game.pairings, aSel, bSel)", "pairing add"),
    (views, "nextPairingRemove(game.pairings, idx)", "pairing remove"),
    (views, "nextFoursomeAdd(foursomes", "foursome add"),
    (views, "nextFoursomeRemove(foursomes, id)", "foursome remove"),
    (views, "nextFoursomeRename(foursomes, id, name)", "foursome rename"),
    (views, "assignFoursomePlayer(foursomes, fId, team, uid)", "foursome assign"),
    (views, "unassignFoursomePlayer(foursomes, fId, team, uid)", "foursome unassign"),
    (views, "deriveTeeGroupsFromFoursomes(next)", "foursome -> tee group derivation"),
]
for text, needle, label in runtime_links:
    if needle not in text:
        raise SystemExit(f"FAIL: runtime no longer reaches shared structure helper for {label}")

# Preserve the critical persistence boundary: pure helpers must not own Supabase or browser UI side effects.
for forbidden in ["supabase", "createClient(", ".rpc(", ".channel(", "alert(", "confirm(", "localStorage", "window."]:
    if forbidden in structure:
        raise SystemExit(f"FAIL: lib/game-structure.ts owns side effect {forbidden!r}")

# Differential test must retain frozen old implementations and randomized comparison volume.
for needle in ["Frozen pre-extraction implementations", "oldSkinsPatch", "oldAssign", "for(let i=0;i<5000;i++)"]:
    if needle not in tests:
        raise SystemExit(f"FAIL: differential characterization weakened: missing {needle}")

print(f"game structure contract: PASS ({len(runtime_links)} runtime links, {len(required_helpers)} pure helpers)")
