#!/usr/bin/env python3
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1]
helper = (root / 'lib/game-tee-assignment.ts').read_text()
create = (root / 'lib/game-create.ts').read_text()
tour = (root / 'components/tournaments.tsx').read_text()
draft = (root / 'lib/setup-draft.ts').read_text()

checks = [
    ('pure precedence helper exists', 'player override > flight tee > game default tee' in helper),
    ('pure helper has no Supabase', 'supabase' not in helper.lower()),
    ('member rows resolve effective tee', 'participantKey: p.id' in create and 'const playerTee = resolved?.tee ?? o.tee;' in create),
    ('guest rows resolve effective tee', 'participantKey: p.id || `guest:${guestIndex}`' in create),
    ('row rating uses resolved tee', 'rating: playerTee.rating' in create and 'slope: playerTee.slope' in create),
    ('CreateGame owns tee assignment draft state', 'const [teeAssignments, setTeeAssignments]' in tour),
    ('CreateGame passes tee hierarchy to player rows', 'playerTeeOverrides: teeAssignments.player' in tour and 'flightTeeIdx: teeAssignments.flight' in tour),
    ('course change clears inherited tee maps', 'setTeeAssignments({ player: {}, flight: {} });' in tour),
    ('player UI exposes inherited/default selection', 'Use {resolved?.source === "flight"' in tour),
    ('flight UI exposes flight tee', '>Flight tee</label>' in tour),
    ('draft persists player tee overrides', 'playerTeeOverrides?: Record<string, number>;' in draft),
    ('draft persists flight tee choices', 'flightTeeIdx?: Record<string, number>;' in draft),
]
failed = [name for name, ok in checks if not ok]
if failed:
    print('CREATE_GAME_TEE_INHERITANCE_FAIL')
    for f in failed:
        print('-', f)
    sys.exit(1)
print(f'CREATE_GAME_TEE_INHERITANCE_PASS {len(checks)}/{len(checks)} checks')
