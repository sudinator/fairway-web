from pathlib import Path
p = Path('components/game/setup/game-setup-workspace.tsx').read_text()
required = [
    'DESTRUCTIVE ACTIONS',
    'These actions cannot be undone.',
    'const structureSummary = usesTeams',
    'usesMatchups',
    '${cPlaced}/${total} matched',
    'sub: structureSummary',
]
missing = [x for x in required if x not in p]
for forbidden in ['>DANGER ZONE</div>']:
    if forbidden in p:
        missing.append('forbidden legacy heading: ' + forbidden)
if missing:
    raise SystemExit('GAME_CONTROL_CENTER_POLISH_FAIL: ' + '; '.join(missing))
print('GAME_CONTROL_CENTER_POLISH_PASS: destructive-action wording and format-aware overview summary are locked')
