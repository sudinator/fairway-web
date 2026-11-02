"""Prevent supported game formats disappearing from member-facing Help."""
import json, re
from pathlib import Path
root = Path(__file__).resolve().parents[1]
shape = (root / 'lib/game-shape.ts').read_text()
match = re.search(r'export const GAME_TYPES[^=]*=\s*\[(.*?)\]', shape, re.S)
if not match: raise SystemExit('Cannot read canonical GAME_TYPES catalog')
actual = set(re.findall(r'"([a-z_]+)"', match.group(1)))
labels = {'stableford': 'stableford', 'stroke': 'stroke play', 'match': 'singles', 'fourball': 'four-ball', 'skins': 'skins', 'trifecta': 'trifecta', 'alt_shot': 'alternate shot', 'scramble': 'scramble'}
if actual != set(labels): raise SystemExit('Update the member-format descriptions for the changed GAME_TYPES catalog')
cap = json.loads((root / 'lib/capabilities.json').read_text())
body = next(c['body'] for c in cap['cards'] if c['title'] == 'Every format you play').lower()
faq = (root / 'components/help-search.tsx').read_text().split('q: "What are the different formats?"', 1)[1].split('    ],', 1)[0].lower()
for kind in sorted(actual):
    label = labels[kind]
    if label not in body or label not in faq: raise SystemExit(f'Member guide/format FAQ is missing {label}')
print(f'Capabilities formats: PASS ({len(actual)} supported formats in the shared guide and Help answer)')
