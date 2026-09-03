#!/usr/bin/env python3
"""Protect the organizer assignment UX for Ryder Cup and Singles formats."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
grouping = (root / "lib/grouping.ts").read_text()
groups = (root / "components/game/scorecard-views.tsx").read_text()
matches = (root / "components/game/scoring-views.tsx").read_text()
tournaments = (root / "components/tournaments.tsx").read_text()
workspace = (root / "components/game/setup/game-setup-workspace.tsx").read_text()

checks = [
    ("export function balancedTeamGroups", grouping, "team-aware balanced grouping helper"),
    ("export function balancedOneVOne", grouping, "one-use Singles pairing helper"),
    ("UNASSIGNED PLAYERS", groups, "unassigned team players shown above group cards"),
    ("p.tee_group !== group || p.id === current?.id", groups, "other-group players remain movable while duplicate same-group slots are excluded"),
    ("Move to unassigned", groups, "occupied team slots can be cleared"),
    ("group needs exactly two {teams[0].name} and two {teams[1].name} players", groups, "2-v-2 guidance"),
    ("PH ${ph(p)}", groups, "playing handicap visible in group choices"),
    ("A selected player is removed from every other dropdown.", matches, "Singles duplicate-prevention guidance"),
    ("!used.has(key) || key === current", matches, "Singles choices retain only their own current selection"),
    ("balancedOneVOne(", matches, "balanced Singles builder is reachable"),
    ("balancedTeamGroups(", tournaments, "team-aware group builder is reachable"),
    ('game.game_type === "alt_shot" || game.game_type === "trifecta"', tournaments, "Trifecta uses the team-aware group builder"),
    ("const setTeamGroupSlot", tournaments, "atomic team slot mutation"),
    ("onSetTeamGroupSlot={onSetTeamGroupSlot}", workspace, "workspace passes team slot handler"),
    ("Groups controls who plays in each foursome", matches, "Trifecta setup assigns foursomes to Groups"),
    ("SINGLES MATCHUPS", matches, "Trifecta Matchups names its sole responsibility"),
    ("Standard pairing", matches, "Trifecta standard Singles pairing choice"),
    ("Cross pairing", matches, "Trifecta cross Singles pairing choice"),
    ('gridTemplateColumns: "repeat(2, minmax(0, 1fr))"', matches, "Trifecta stroke teams shrink within the viewport"),
    ('overflowWrap: "anywhere"', matches, "long Trifecta player names wrap inside their column"),
    ("Teams are inherited from the Ryder Cup roster", workspace, "Ryder Cup session teams are explicitly inherited"),
    ("isCompetitionGame: !!competitionLink", tournaments, "competition sessions activate inherited-team setup"),
]

for needle, source, label in checks:
    if needle not in source:
        raise SystemExit(f"FAIL: missing {label}: {needle}")

if groups.index("UNASSIGNED PLAYERS") > groups.index("{Array.from({ length: groupCount }, (_, i) => i + 1).map"):
    raise SystemExit("FAIL: unassigned team players must render before group cards")
if matches.index("UNASSIGNED PLAYERS") > matches.index("{drafts.map((pair, row)"):
    raise SystemExit("FAIL: unassigned Singles players must render before match cards")
trifecta_setup = matches.index('mode === "setup" && isTrifecta')
generic_foursome_setup = matches.index('if (mode === "setup")', trifecta_setup)
if trifecta_setup > generic_foursome_setup:
    raise SystemExit("FAIL: Trifecta setup must bypass the generic foursome editor")

print(f"competitive assignment contract: PASS ({len(checks) + 2}/{len(checks) + 2})")
