from pathlib import Path

root = Path(__file__).resolve().parents[1]
dash = (root / 'components/dashboard.tsx').read_text()
rounds = (root / 'components/rounds-list.tsx').read_text()
detail = (root / 'components/round-detail.tsx').read_text()
helper = (root / 'lib/round-stats.ts').read_text()

checks = {
    'dashboard label is Putts / round': 'label="Putts / round"' in dash,
    'dashboard whole-round eligibility uses shared helper': 'roundStatCompleteness(r.holes).puttsRoundEligible' in dash,
    'dashboard aggregate averages total putts across eligible rounds': 'completePuttRounds.reduce((s, r) => s + puttsOf(r)' in dash,
    'old Putts / hole card removed': 'label="Putts / hole"' not in dash,
    'shared helper requires 18 played + 18 putt holes': 'playedHoles.length === 18 && puttHoles === 18' in helper,
    'near-complete putt nudge threshold is 15-17': 'puttHoles >= 15 && puttHoles < 18' in helper,
    'round list names exact missing putt holes': 'Putts not recorded on' in rounds and 'statHoleList(completeness.missingPutts)' in rounds,
    'round list explains dashboard eligibility': 'included in your Putts / round dashboard trend' in rounds,
    'existing round-detail reminder reuses shared completeness helper': 'roundStatCompleteness(round.holes)' in detail,
    'fairway completeness remains par-3 aware': 'h.par >= 4' in helper,
}

failed = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print(('PASS' if ok else 'FAIL') + ': ' + name)
if failed:
    raise SystemExit('Dashboard putts/round contract failed: ' + '; '.join(failed))
print('dashboard putts/round contract: PASS')
