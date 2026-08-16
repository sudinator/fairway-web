#!/usr/bin/env python3
from pathlib import Path
import re, sys
root = Path(__file__).resolve().parents[1]
src = (root / 'components/tournaments.tsx').read_text()
start = src.index('function CreateGame(')
end = src.index('\nfunction ', start + len('function CreateGame(')) if '\nfunction ' in src[start + 20:] else len(src)
block = src[start:end]
actual_state = set(re.findall(r'const \[([A-Za-z0-9_]+),\s*set[A-Za-z0-9_]+\]\s*=\s*useState', block))
actual_refs = set(re.findall(r'const\s+([A-Za-z0-9_]+)\s*=\s*React\.useRef', block))

# Every CreateGame state cell is deliberately classified. Domain fields are represented
# by GameSetupDraft; context/transient/runtime state deliberately stays outside that model.
domain = {
  'name','matchDate','pickedFav','teeIdx','idxStr','gameType','allowancePct','flightMode','flightCount',
  'hcpOverrides','teamScoreMode','trifectaScoring','strokeBasis','fmtFamily','matchKind','teamMode',
  'skinsTeamStyle','skinsMode','team1','team2','selectedPlayers','guestPlayers',
}
context = {'favorites','profileIdx','groupRoster'}
transient = {'flightHcpDraft','guestName','guestHcp','guestSponsor','guestIdxEdits'}
runtime = {'busy','err','draftAvailable','draftDismissed','pendingFavName'}
expected_state = domain | context | transient | runtime
expected_refs = {'hydratedRef','resumedRef','guestsSeeded'}

missing = expected_state - actual_state
unclassified = actual_state - expected_state
missing_refs = expected_refs - actual_refs
unclassified_refs = actual_refs - expected_refs
if missing or unclassified or missing_refs or unclassified_refs:
    print('CREATE_GAME_STATE_INVENTORY_FAIL')
    if missing: print('missing expected state:', ', '.join(sorted(missing)))
    if unclassified: print('unclassified state:', ', '.join(sorted(unclassified)))
    if missing_refs: print('missing expected refs:', ', '.join(sorted(missing_refs)))
    if unclassified_refs: print('unclassified refs:', ', '.join(sorted(unclassified_refs)))
    sys.exit(1)
print(f'CREATE_GAME_STATE_INVENTORY_PASS {len(actual_state)} state cells + {len(actual_refs)} refs classified')
