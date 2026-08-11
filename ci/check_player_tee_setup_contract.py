#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
panel = (root / "components/game/organizer-panel.tsx").read_text(encoding="utf-8")
tournaments = (root / "components/tournaments.tsx").read_text(encoding="utf-8")

checks = [
    ("player tee selector always rendered", 'disabled={teeOptions.length === 0}' in panel and 'No tee data available' in panel),
    ("tee options merge player snapshots", 'byName.set(p.tee_name' in panel and 'p.rating == null || p.slope == null' in panel),
    ("yardage is not a tee-selection prerequisite", 'yardages' not in panel[panel.find('const teeOptions = useMemo'):panel.find('const groupOptions')]),
    ("handicap override uses the player tee only", 'const rating = p.rating ?? null;' in tournaments and 'const slope = p.slope ?? null;' in tournaments),
    ("handicap override does not borrow another player tee", 'players.find((x) => x.rating != null && x.slope != null)' not in tournaments[tournaments.find('const overridePlayerHandicap'):tournaments.find('const setPlayerTeam')]),
    ("course lookup has global fallback", '.from("favorite_courses")' in tournaments[tournaments.find('if (!found)'):tournaments.find('const tees = Array.isArray(found?.tees)')]),
    ("tee change still recalculates course handicap", 'courseHandicap(p.handicap_index, tee.slope, tee.rating, game.course_par)' in tournaments[tournaments.find('const setPlayerTee = async'):tournaments.find('// Organizer: mark/unmark')]),
    ("tee change still persists player tee snapshot", 'tee_name: tee.name' in tournaments[tournaments.find('const setPlayerTee = async'):tournaments.find('// Organizer: mark/unmark')]),
]

failed = [name for name, ok in checks if not ok]
if failed:
    for name in failed:
        print(f"FAIL: {name}")
    raise SystemExit(1)

for name, _ in checks:
    print(f"PASS: {name}")
