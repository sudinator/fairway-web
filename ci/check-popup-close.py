#!/usr/bin/env python3
"""
Popup close-control guard (APP_RULES #18).

Every popup must have a visible way to dismiss it. Popups are built on <BottomSheet>, which renders a
top-right × automatically — but only when it's given an `onClose`. So every <BottomSheet> must pass
`onClose`. (This is why the differential sheet shipped without an ×: no guard checked it. Now one does.)
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMP = ROOT / "components"

violations = []
for f in sorted(COMP.glob("*.tsx")):
    text = f.read_text(encoding="utf-8", errors="replace")
    for m in re.finditer(r'<BottomSheet\b', text):
        i = m.end()
        # find the end of the opening tag: first '>' that isn't part of an arrow fn '=>'
        end = None
        for k in range(i, min(len(text), i + 2000)):
            if text[k] == '>' and text[k - 1] != '=':
                end = k
                break
        props = text[i:end] if end else text[i:i + 2000]
        if 'onClose' not in props:
            line = text[:m.start()].count("\n") + 1
            violations.append(f"{f.relative_to(ROOT)}:{line}  <BottomSheet> without onClose — its × close control won't render (APP_RULES #18)")

if violations:
    print("POPUP CLOSE CHECK FAILED — a popup can't be dismissed:")
    for v in violations:
        print("  " + v)
    sys.exit(1)
print("popup-close check passed: every BottomSheet has an onClose (× close control)")
