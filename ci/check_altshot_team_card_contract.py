#!/usr/bin/env python3
from pathlib import Path
import sys
score = Path('components/game/scorecard-views.tsx').read_text(encoding='utf-8')
tour = Path('components/tournaments.tsx').read_text(encoding='utf-8')
seg = Path('components/game/segment-views.tsx').read_text(encoding='utf-8')
checks = {
    'alternate shot collapses duplicated partner rows into side columns': 'renders exactly TWO scoring entities: the two sides' in score and 'const makeSide = (ids: string[], which: "a" | "b")' in score,
    'alternate shot card names the team not the clicked player': 'altSide: { name: teamName' in score and 'sideCol.altSide.name' in score,
    'alternate shot card shows side playing handicap': 'playing hcp {c.altSide.sideCh' in score and 'playing hcp ${sideCol.altSide.sideCh' in score,
    'alternate shot score cells show side net rather than Stableford points': 'c.altSide && gross != null && gross > 0' in score and '!c.altSide && gross != null && gross > 0' in score,
    'alternate shot modal hides individual stat entry': 'showFairway={!sideCol?.altSide}' in score and 'showPutts={!sideCol?.altSide}' in score and 'showPenalties={!sideCol?.altSide}' in score,
    'alternate shot modal writes only the side score': 'if (sideCol?.altSide && edit.alt && onSetAltShotScore)' in score and 'onSetAltShotScore(edit.alt.foursomeId, edit.alt.side, edit.holeIdx, patch.strokes ?? null)' in score,
    'alternate shot group segment component hard-stops if called': 'if (game.game_type === "alt_shot") return null;' in seg,
    'alternate shot does not render individual group segment side game': 'game.game_type === "match" || game.game_type === "fourball" || game.game_type === "trifecta")' in tour and 'game.game_type === "trifecta" || game.game_type === "alt_shot") && (\n        <GroupSegmentSummary' not in tour,
    'alternate shot does not render an individual personal scorecard': 'me && game.game_type !== "alt_shot" && (() => {' in tour,
    'alternate shot six-hole individual board remains gated off': 'shapeOf(game).dotBasis !== "alt_shot_side" && (' in tour,
}
failed = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items(): print(('PASS' if ok else 'FAIL'), name)
if failed: sys.exit(1)
