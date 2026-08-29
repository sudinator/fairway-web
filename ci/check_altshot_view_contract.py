#!/usr/bin/env python3
from pathlib import Path
import sys
p = Path('components/game/scoring-views.tsx')
s = p.read_text(encoding='utf-8')
t = Path('components/tournaments.tsx').read_text(encoding='utf-8')
checks = {
    'FourballView identifies alternate shot explicitly': 'const isAltShot = game.game_type === "alt_shot";' in s,
    'Alternate shot match summary uses altShotStatus': 'altShotStatus(game.holes_meta, alt!.a as never, alt!.b as never)' in s or 'altShotStatus(game.holes_meta, alt.a as never, alt.b as never)' in s,
    'Alternate shot hole detail uses altShotHoleDetail': 'altShotHoleDetail(game.holes_meta, alt.a as never, alt.b as never)' in s,
    'Alternate shot reads duplicated partner rows safely': 'readAltShotSideScores(' in s,
    'Alternate shot surfaces partner-row conflicts': 'Those holes are excluded from the match result until the scores agree.' in s,
    'Alternate shot has its own results heading': 'ALTERNATE SHOT MATCHES' in s,
    'Scorecard running line reads both partner rows': 'readAltShotSideScores(rows[0].scores, rows[1].scores' in t,
    'Play header identifies alternate shot': '"⛳ Alternate Shot Match"' in t,
    'Play subtitle identifies one-ball match play': '"2 v 2 · one ball per side · match play"' in t,
    'Alternate shot conflicts block group finish': 'Fix those scores before finishing the group.' in t,
    'Alternate shot conflicts block game end': 'Fix those scores before ending the game.' in t,
}
failed = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print(('PASS' if ok else 'FAIL'), name)
if failed:
    sys.exit(1)
