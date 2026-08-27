#!/usr/bin/env python3
"""Every game type's setup must be COMPLETABLE.

WHY THIS EXISTS
alt_shot's shape required foursomes, but the foursome builder in tournaments.tsx was gated on
`fourball || trifecta`. The Matchups tab therefore rendered nothing, and the Tee groups tab is
hidden whenever usesFoursomes is true — so there was no route to build the sides and setup could
never complete. The game was unplayable from the moment it was created.

Every existing check passed: the type had a label, a valid shape, a picker entry and a payload. None
of them asked the only question that mattered — can a user actually finish?

This checks the GATES, because they are JSX conditions and no unit test sees them: any game type
that uses foursomes must appear in the foursome editor's condition.

    python3 ci/check_setup_reachable.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
shape_src = (ROOT / "lib" / "game-shape.ts").read_text(encoding="utf-8")
room_src = (ROOT / "components" / "tournaments.tsx").read_text(encoding="utf-8")

failures: list[str] = []

# Types whose shape uses foursomes, read from shapeOf rather than restated here.
m = re.search(r"const usesFoursomes\s*=\s*(.*?);", shape_src, re.S)
if not m:
    failures.append("lib/game-shape.ts: usesFoursomes not found — has shapeOf been restructured?")
    foursome_types: set[str] = set()
else:
    foursome_types = set(re.findall(r'gt === "(\w+)"', m.group(1)))

# The foursome editor's own gate, in the game room.
editors = re.findall(r'\(game\.game_type === "fourball"[^)]*\)', room_src)
gated: set[str] = set()
for e in editors:
    gated |= set(re.findall(r'game_type === "(\w+)"', e))

missing = foursome_types - gated
if missing:
    failures.append(
        "these types use foursomes but are NOT in the foursome editor's gate:\n"
        f"    {', '.join(sorted(missing))}\n"
        "  Their setup can never complete: the Matchups tab renders nothing for them, and the Tee\n"
        "  groups tab is hidden whenever usesFoursomes is true. Add them to the gate in\n"
        "  components/tournaments.tsx alongside fourball and trifecta."
    )

if failures:
    print("SETUP REACHABILITY — violations:\n")
    for f in failures:
        print("  " + f.replace("\n", "\n  "))
        print()
    sys.exit(1)

print(f"setup reachability: PASS ({len(foursome_types)} foursome format(s), all have an editor)")
