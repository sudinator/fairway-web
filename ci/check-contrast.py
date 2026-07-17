#!/usr/bin/env python3
"""
Contrast guard (APP_RULES #21).

The palette has two families that must never be mixed on one surface:
  • LIGHT surfaces  — C.card (#FFFDF6), C.cream — carry DARK text: C.ink, C.faint.
  • DARK surfaces   — C.green/greenMid/greenLight — carry LIGHT text: C.cream, C.sage (gold = accent, ok on both).

Light text on a light surface (C.cream on C.card) or dark text on a dark surface (C.faint on C.greenMid) is
unreadable and off-theme — it produced the washed-out "how this differential is calculated" sheet.

Conservative check: flag a SINGLE element (one style={{...}} object) that sets BOTH a background and a text
color from the SAME family. This is the unambiguous case — the element paints its own surface and its own
text the wrong way. (Cross-element parent/child mixing is covered by the rule + review; judging it statically
mis-attributes inherited backgrounds and produces false positives.)
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMP = ROOT / "components"
LIGHT_BG = {"C.card", "C.cream", "#FFFDF6", "#F7F3E8"}
LIGHT_TEXT = {"C.cream", "C.sage", "#F7F3E8"}
DARK_BG = {"C.green", "C.greenMid", "C.greenLight", "#0E3B2E", "#16503D", "#1B5A46"}
DARK_TEXT = {"C.ink", "C.faint", "#26251F", "#8B8775"}

def tok(s: str) -> str:
    return s.strip().strip('"').strip("`").strip()

violations = []
for f in sorted(COMP.glob("*.tsx")):
    text = f.read_text(encoding="utf-8", errors="replace")
    for m in re.finditer(r'style=\{\{(.*?)\}\}', text, re.S):
        obj = m.group(1)
        mb = re.search(r'background:\s*([^,}\n]+)', obj)
        if not mb:
            continue
        bg = tok(mb.group(1))
        fam = "light" if bg in LIGHT_BG else "dark" if bg in DARK_BG else None
        if not fam:
            continue
        bad = LIGHT_TEXT if fam == "light" else DARK_TEXT
        hit = next((tok(c) for c in re.findall(r'color:\s*([^,}\n]+)', obj) if tok(c) in bad), None)
        if hit:
            line = text[:m.start()].count("\n") + 1
            violations.append(f"{f.relative_to(ROOT)}:{line}  {fam} background ({bg}) with {fam} text ({hit}) — dark surfaces use cream/sage, light surfaces (C.card) use ink/faint")

if violations:
    print("CONTRAST CHECK FAILED — an element sets background and text from the same light/dark family:")
    for v in violations:
        print("  " + v)
    sys.exit(1)
print("contrast check passed: no element mixes same-family background and text")
