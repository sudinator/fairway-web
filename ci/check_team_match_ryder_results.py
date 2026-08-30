#!/usr/bin/env python3
"""Team Individual Match Ryder-style results contract.

Presentation-only guard for 178.24. It protects the approved information
architecture without coupling to exact colors or decorative styling.
"""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
src = (root / "components/game/scoring-views.tsx").read_text(encoding="utf-8")

def need(cond, msg):
    if not cond:
        raise SystemExit(f"TEAM MATCH RYDER RESULTS: FAIL - {msg}")

start = src.find('if (isTeam && teams?.length === 2)')
end = src.find('\n        return (', start)
need(start >= 0 and end > start, "team-only Ryder results branch exists")
block = src[start:end]

checks = [
    ('three-column one-row grid', 'gridTemplateColumns: "minmax(0, 1fr) 58px minmax(0, 1fr)"' in block),
    ('first team fixed left', 'teams[0].name.toUpperCase()' in block),
    ('second team fixed right', 'teams[1].name.toUpperCase()' in block),
    ('legacy reversed pairings normalized', 'reverseTeamDisplay' in src and 'rawA.team === teamBKey && rawB.team === teamAKey' in src),
    ('thru centered', '>THRU</span>' in block and 'textAlign: "center"' in block and '{st.thru}' in block),
    ('all square centered only after play begins', 'const allSquare = st.thru > 0 && st.lead === 0' in block and '>AS<' in block),
    ('leader-only UP status', 'leftLeading ? `${Math.abs(st.lead)} UP`' in block and 'rightLeading ? `${Math.abs(st.lead)} UP`' in block),
    ('no redundant down status', ' DN' not in block and '`DN`' not in block),
    ('details stays clickable', block.count('Details ›') == 2 and block.count('onClick={toggleProgress}') >= 3),
    ('progression remains canonical', 'matchProgress(' in src and 'MATCH PROGRESSION' in src and 'Net scores drive the running match position' in src),
]
for label, ok in checks:
    need(ok, label)

# Model the approved status placement across normal/edge states.
def display(lead, thru, result=None):
    left = result if result and lead > 0 else (f"{abs(lead)} UP" if lead > 0 else "")
    right = result if result and lead < 0 else (f"{abs(lead)} UP" if lead < 0 else "")
    center = "AS" if thru > 0 and lead == 0 else ""
    return left, center, right

cases = [
    ((0, 0, None), ("", "", "")),
    ((1, 3, None), ("1 UP", "", "")),
    ((-2, 7, None), ("", "", "2 UP")),
    ((0, 5, None), ("", "AS", "")),
    ((3, 16, "3 & 2"), ("3 & 2", "", "")),
    ((-1, 18, "1 UP"), ("", "", "1 UP")),
    ((0, 18, "AS"), ("", "AS", "")),
]
for args, expected in cases:
    need(display(*args) == expected, f"status placement case {args}")

print(f"Team Match Ryder results contract: PASS ({len(checks)} source + {len(cases)} model cases)")
