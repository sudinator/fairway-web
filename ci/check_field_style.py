#!/usr/bin/env python3
"""212.0 — every editable field (input, select, textarea) uses the app's ONE field style, `inputStyle`
(components/ui.tsx; DISPLAY_RULES.md §2: "do not set a field background at a call site"). Scramble's 211.9 boxes set
their own green background and nothing caught it — the style checks assumed fields already spread inputStyle.

A ratchet: ci/field_style_baseline.json records today's fields that style themselves, per file. A NEW one fails;
fixing an old one lowers the count (run with --update to record the improvement). Fields with no style attribute
(they inherit) and checkbox / radio / range / colour / file / hidden inputs are not editable text fields."""
import json, pathlib, re, sys
from collections import Counter
ROOT = pathlib.Path(__file__).resolve().parent.parent
BASE = ROOT / "ci" / "field_style_baseline.json"
SKIP_TYPES = ("hidden", "file", "checkbox", "radio", "range", "color")

def offenders():
    out = Counter()
    for f in sorted(list(ROOT.glob("components/**/*.tsx")) + list(ROOT.glob("app/**/*.tsx"))):
        src = f.read_text(encoding="utf-8")
        for m in re.finditer(r"<(input|select|textarea)\b", src):
            j, depth = m.end(), 0
            while j < len(src):
                c = src[j]
                if c == "{": depth += 1
                elif c == "}": depth -= 1
                elif c == ">" and depth == 0: break
                j += 1
            tag = src[m.start():j]
            if any(f'type="{t}"' in tag for t in SKIP_TYPES): continue
            if "style=" in tag and "...inputStyle" not in tag:
                out[str(f.relative_to(ROOT))] += 1
    return out

now = offenders()
if "--update" in sys.argv:
    BASE.write_text(json.dumps(dict(sorted(now.items())), indent=1) + "\n")
    print(f"field style: baseline written — {sum(now.values())} field(s) style themselves"); sys.exit(0)
base = json.loads(BASE.read_text()) if BASE.exists() else {}
worse = {f: (base.get(f, 0), n) for f, n in now.items() if n > base.get(f, 0)}
if worse:
    print("FIELD STYLE: FAIL — a field sets its own style instead of spreading inputStyle (DISPLAY_RULES.md §2):")
    for f, (was, n) in sorted(worse.items()): print(f"  {f}: {was} -> {n}")
    sys.exit(1)
print(f"field style: PASS ({sum(now.values())} known self-styled field(s), none new)")
