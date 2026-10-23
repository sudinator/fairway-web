#!/usr/bin/env python3
"""212.9 — every editable field (input, select, textarea) uses the app's ONE field style, `inputStyle`
(components/ui.tsx; DISPLAY_RULES.md §2: "do not set a field background at a call site"). A field passes when its style
is `inputStyle`, spreads it (`...inputStyle`), or is a named style in the same file built on it
(`const x = { ...inputStyle, … }`); fields with no style attribute inherit. Checkbox / radio / range / colour / file /
hidden inputs aren't text fields.

NO other exceptions than the two below — each a deliberate design decision (owner, Oct 22 2026), documented in
DISPLAY_RULES.md §2 "Field-style exceptions":
"""
import pathlib, re, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
SKIP_TYPES = ("hidden", "file", "checkbox", "radio", "range", "color")
EXCEPTIONS = {
    # file → the marker its exceptional field carries, and why
    "components/ui.tsx#date-overlay": "the invisible native date input laid over the styled date button (opacity 0 — never seen)",
    "components/ui.tsx#score-picker": "the score-entry number picker — score entry is its own surface family (DISPLAY_RULES.md §2); owner kept it as is",
}

def built_on_input(name, src):
    """`const name = { ...inputStyle`, `const name: React.CSSProperties = { ...inputStyle`, or `name: { ...inputStyle` (in a style object)"""
    return bool(re.search(rf"\b{re.escape(name)}\s*(?::\s*[\w.<>]+\s*)?=\s*\{{\s*\.\.\.inputStyle", src) or re.search(rf"\b{re.escape(name)}\s*:\s*\{{\s*\.\.\.inputStyle", src))

def ok_style(tag, src):
    if "style=" not in tag: return True
    if re.search(r"style=\{\s*inputStyle\s*\}", tag) or "...inputStyle" in tag: return True
    m = re.search(r"style=\{\s*([A-Za-z_][\w.]*)\s*\}", tag)                     # a named style …
    if m:
        name = m.group(1).split(".")[-1]
        if built_on_input(name, src): return True   # … built on inputStyle
    m = re.search(r"style=\{\{\s*\.\.\.([A-Za-z_]\w*)", tag)                      # {{ ...named, … }}
    if m and built_on_input(m.group(1), src): return True
    return False

bad, ex = [], 0
for f in sorted(list(ROOT.glob("components/**/*.tsx")) + list(ROOT.glob("app/**/*.tsx"))):
    src = f.read_text(encoding="utf-8")
    rel = str(f.relative_to(ROOT))
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
        if ok_style(tag, src): continue
        marker = re.search(r'data-field-exception="([a-z-]+)"', tag)
        if marker and f"{rel}#{marker.group(1)}" in EXCEPTIONS: ex += 1; continue
        bad.append(f"{rel}:{src[:m.start()].count(chr(10)) + 1}")
if bad:
    print("FIELD STYLE: FAIL — a field sets its own style instead of using inputStyle (DISPLAY_RULES.md §2):\n  " + "\n  ".join(bad)); sys.exit(1)
print(f"field style: PASS (every field uses inputStyle; {ex} documented exception(s))")
