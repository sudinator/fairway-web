from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
score = (ROOT / 'components/game/scorecard-views.tsx').read_text(encoding='utf-8')
tourn = (ROOT / 'components/tournaments.tsx').read_text(encoding='utf-8')
hook = (ROOT / 'lib/use-now-tick.ts').read_text(encoding='utf-8')

checks = {
    'shared reactive clock uses interval state': 'setInterval(() => setNow(Date.now())' in hook,
    'scorecard pace uses reactive clock': 'const paceNow = useNowTick();' in score and ': paceNow;' in score,
    'game-room pace uses reactive clock': 'const paceNow = useNowTick();' in tourn and ': paceNow;' in tourn,
}
failed=[name for name,ok in checks.items() if not ok]
if failed:
    print('Reactive-time contract: FAIL')
    for name in failed: print(' -',name)
    raise SystemExit(1)
print('Reactive-time contract: PASS')
