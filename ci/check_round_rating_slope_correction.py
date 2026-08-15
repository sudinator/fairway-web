#!/usr/bin/env python3
from pathlib import Path

editor = Path('components/round-editor.tsx').read_text()
golf = Path('lib/golf.ts').read_text()
pkg = Path('package.json').read_text()

checks = {
    'pure historical correction helper exists': 'withHistoricalRatingSlopeCorrection' in golf,
    'helper uses stored round handicap index': 'r.handicap_index' in golf and 'courseHandicap(r.handicap_index, slope, rating, r.course_par)' in golf,
    'helper refreshes per-hole recv allocation': 'holes: r.holes.map((h) => ({ ...h, recv: alloc[h.hole_number] || 0 }))' in golf,
    'editor exposes historical correction UI': 'Historical rating / slope' in editor,
    'editor separates correction from course library': 'it does not change the course library or the game result' in editor,
    'recorded-round save writes rating': 'rating: effectiveRating' in editor,
    'recorded-round save writes slope': 'slope: effectiveSlope' in editor,
    'recorded-round save writes recalculated course handicap': 'course_handicap: effectiveCourseHandicap' in editor,
    'gross-only metadata correction preserves gross total': 'gross_score: metadataOnly ? (round.gross_score ?? null) : null' in editor,
    'recorded-round cancel is non-destructive': 'if (isRecordedFinal) { onCancel(); return; }' in editor,
    'game rows are not rewritten by round editor': '.from("game_players")' not in editor and '.from("games")' not in editor,
    'course-library save still uses original round snapshot': 'rating: round.rating ?? t.rating' in editor and 'slope: round.slope ?? t.slope' in editor,
    'guard is wired into npm guards': 'check_round_rating_slope_correction.py' in pkg,
}

failed = [name for name, ok in checks.items() if not ok]
if failed:
    print('Historical rating/slope correction contract: FAIL')
    for name in failed:
        print(f'- {name}')
    raise SystemExit(1)
print(f'Historical rating/slope correction contract: PASS ({len(checks)} checks)')
