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
    ("p.tee_group == null || p.id === current?.id", groups, "assigned players removed from other group dropdowns"),
    ("Each {game.game_type === \"alt_shot\" ? \"Alternate Shot\" : \"Four-Ball\"} group needs exactly two", groups, "2-v-2 guidance"),
    ("PH ${ph(p)}", groups, "playing handicap visible in group choices"),
    ("A selected player is removed from every other dropdown.", matches, "Singles duplicate-prevention guidance"),
    ("!used.has(key) || key === current", matches, "Singles choices retain only their own current selection"),
    ("balancedOneVOne(", matches, "balanced Singles builder is reachable"),
    ("balancedTeamGroups(", tournaments, "team-aware group builder is reachable"),
    ("const setTeamGroupSlot", tournaments, "atomic team slot mutation"),
    ("onSetTeamGroupSlot={onSetTeamGroupSlot}", workspace, "workspace passes team slot handler"),
]

for needle, source, label in checks:
    if needle not in source:
        raise SystemExit(f"FAIL: missing {label}: {needle}")

if groups.index("UNASSIGNED PLAYERS") > groups.index("{Array.from({ length: groupCount }, (_, i) => i + 1).map"):
    raise SystemExit("FAIL: unassigned team players must render before group cards")
if matches.index("UNASSIGNED PLAYERS") > matches.index("{drafts.map((pair, row)"):
    raise SystemExit("FAIL: unassigned Singles players must render before match cards")

print(f"competitive assignment contract: PASS ({len(checks) + 2}/{len(checks) + 2})")
