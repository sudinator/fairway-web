#!/usr/bin/env python3
"""212.34 — saving scramble teams sets tee groups through ONE rule: lib/scramble-teams scrambleTeeGroups (small teams
share a group, so one scorer keeps one card; owner, Oct 23). Before, components/tournaments.tsx made each team its own
group (index + 1) and two teams of 2 playing as a foursome had two cards."""
import pathlib, re, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
t = (ROOT / "components/tournaments.tsx").read_text(encoding="utf-8")
m = re.search(r"const setScrambleTeams = async \(groups: ScrambleGroup\[\]\) => \{(.*?)\n  \};", t, re.S)
bad = []
if not m: bad.append("components/tournaments.tsx: setScrambleTeams not found")
else:
    body = m.group(1)
    if "scrambleTeeGroups(" not in body: bad.append("setScrambleTeams must assign tee groups with scrambleTeeGroups")
    if re.search(r"gi\s*\+\s*1|findIndex\([^)]*\)\s*\+\s*1", body): bad.append("setScrambleTeams must not number groups by team position")
lib = (ROOT / "lib/scramble-teams.ts").read_text(encoding="utf-8")
if "export function scrambleTeeGroups(" not in lib or "SCRAMBLE_GROUP_MAX = 4" not in lib: bad.append("lib/scramble-teams.ts must export scrambleTeeGroups and SCRAMBLE_GROUP_MAX = 4")
b = (ROOT / "components/game/scramble-teams-builder.tsx").read_text(encoding="utf-8")
if "scrambleTeeGroups(" not in b: bad.append("the Teams screen must read the same rule (scrambleTeeGroups)")
if bad: print("SCRAMBLE TEE GROUPS: FAIL\n  " + "\n  ".join(bad)); sys.exit(1)
print("scramble tee groups: PASS (team saving and the Teams screen use one grouping rule)")
