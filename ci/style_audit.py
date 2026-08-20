#!/usr/bin/env python3
"""Complete style analysis — every background and colour, literal OR conditional, with an explicit
report of anything it could not parse.

Written after three separate misses, all the same mistake: a regex matched the literal form,
found nothing for the conditional form, and I read "no match" as "nothing there".

    color: C.faint                      matched
    color: st.result ? C.birdie : C.green   NOT matched  -> 123 sites never examined
    background: C.card                  matched
    background: selected ? C.cream : C.card NOT matched  -> 19 surfaces never inventoried

The second of those is why Courses went green while New Round and Create Game stayed white.

The rule this file follows: NEVER silently skip. Anything with a `background:` or `color:` that
cannot be resolved to concrete values is counted and printed under UNPARSED. A scanner that hides
its blind spots is worse than no scanner, because it produces confident wrong answers.

    python3 style_audit.py <tree>            summary + unparsed report
    python3 style_audit.py <tree> --surfaces every surface, literal and conditional
    python3 style_audit.py <tree> --contrast every text/background pair below WCAG
"""
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve()
MODE = sys.argv[2] if len(sys.argv) > 2 else ""


def palette():
    src = (ROOT / "lib" / "golf.ts").read_text(encoding="utf-8", errors="replace")
    blk = re.search(r"export const C\s*=\s*\{(.*?)\n\}", src, re.S).group(1)
    return {"C." + n: h.upper() for n, h in re.findall(r"(\w+)\s*:\s*\"(#[0-9A-Fa-f]{6})\"", blk)}


TOK = palette()
ACCENTS = {"C.gold", "C.dot", "C.birdie", "C.bogey", "C.indiv", "C.indivDot", "C.parBlue"}


def lum(h):
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    ch = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    ch = [(c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4) for c in ch]
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]


def ratio(a, b):
    x, y = sorted([lum(a), lum(b)], reverse=True)
    return (x + 0.05) / (y + 0.05)


def scan_tags(src):
    i, n = 0, len(src)
    while i < n:
        lt = src.find("<", i)
        if lt < 0:
            return
        j = lt + 1
        closing = False
        if j < n and src[j] == "/":
            closing, j = True, j + 1
        m = re.match(r"[A-Za-z][\w.]*", src[j:])
        if not m:
            i = lt + 1
            continue
        name = m.group(0)
        j += len(name)
        depth, astart = 0, j
        while j < n:
            c = src[j]
            if c in "\"'`":
                q, j = c, j + 1
                while j < n and src[j] != q:
                    j += 2 if src[j] == "\\" else 1
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
            elif c == ">" and depth == 0:
                break
            j += 1
        if j >= n:
            return
        yield lt, closing, name, src[astart:j], src[astart:j].rstrip().endswith("/")
        i = j + 1


# A style value runs to the next comma at brace-depth 0 — handles `cond ? A : B` and nested calls.
def value_of(attrs, prop):
    m = re.search(rf"\b{prop}\s*:\s*", attrs)
    if not m:
        return None
    i, depth, out = m.end(), 0, []
    while i < len(attrs):
        c = attrs[i]
        if c in "({[":
            depth += 1
        elif c in ")]}":
            if depth == 0:
                break
            depth -= 1
        elif c == "," and depth == 0:
            break
        out.append(c)
        i += 1
    return "".join(out).strip()


LITERAL = re.compile(r'^(C\.\w+|"#[0-9A-Fa-f]{3,8}")$')
TOKEN = re.compile(r'C\.\w+|"#[0-9A-Fa-f]{6}"')


def resolve(expr):
    """Return (list_of_concrete_values, parsed_ok). A ternary yields BOTH branches."""
    if expr is None:
        return [], True
    e = expr.strip()
    if LITERAL.match(e):
        return [hexof(e)], True
    if "?" in e and ":" in e:
        vals = [hexof(t) for t in TOKEN.findall(e)]
        vals = [v for v in vals if v]
        return (vals, True) if vals else ([], False)
    vals = [hexof(t) for t in TOKEN.findall(e)]
    vals = [v for v in vals if v]
    return (vals, bool(vals))


def hexof(tok):
    tok = tok.strip()
    if tok in TOK:
        return TOK[tok]
    m = re.fullmatch(r'"(#[0-9A-Fa-f]{3,8})"', tok)
    return m.group(1).upper() if m else None


surfaces, findings = [], []
unparsed = Counter()
unparsed_ex = defaultdict(list)

for d in ("components", "app"):
    for f in sorted((ROOT / d).rglob("*.tsx")):
        src = f.read_text(encoding="utf-8", errors="replace")
        rel = str(f.relative_to(ROOT))
        stack = []
        for start, closing, name, attrs, selfclose in scan_tags(src):
            ln = src[:start].count("\n") + 1
            if closing:
                for k in range(len(stack) - 1, -1, -1):
                    if stack[k][0] == name:
                        del stack[k:]
                        break
                continue

            braw = value_of(attrs, "background") or value_of(attrs, "backgroundColor")
            bgs, bok = resolve(braw)
            if braw is not None and not bok:
                unparsed["background"] += 1
                unparsed_ex["background"].append(f"{rel}:{ln}  {braw[:56]}")
            if not bgs:
                if "...inputStyle" in attrs:
                    bgs = [TOK.get("C.field") or TOK["C.cream"]]
                elif re.search(r"\.\.\.btn\(\s*true", attrs):
                    bgs = [TOK["C.gold"]]
                elif re.search(r"\.\.\.btn\(", attrs):
                    bgs = [TOK["C.greenLight"]]
                elif name == "BottomSheet" and 'tone="light"' not in attrs:
                    bgs = [TOK["C.greenLight"]]
            if bgs:
                for b in bgs:
                    surfaces.append((rel, ln, name, b, "light" if lum(b) > 0.5 else "dark",
                                     braw is not None and "?" in (braw or "")))

            craw = value_of(attrs, "color")
            cols, cok = resolve(craw)
            if craw is not None and not cok:
                unparsed["color"] += 1
                unparsed_ex["color"].append(f"{rel}:{ln}  {craw[:56]}")
            if cols:
                eff = bgs or next((b for _, b in reversed(stack) if b), None)
                effs = eff if isinstance(eff, list) else ([eff] if eff else [])
                sz = int((re.search(r"fontSize:\s*(\d+)", attrs) or re.match("x", "x")).group(1)) \
                    if re.search(r"fontSize:\s*(\d+)", attrs) else 15
                wt = int(re.search(r"fontWeight:\s*(\d+)", attrs).group(1)) \
                    if re.search(r"fontWeight:\s*(\d+)", attrs) else 400
                need = 3.0 if (sz >= 18 or (sz >= 14 and wt >= 700)) else 4.5
                # A conditional colour paired with a conditional background is correlated —
                # branch i goes with branch i, not every combination.
                pair = (craw and "?" in craw) and (braw and "?" in braw) and len(cols) == len(effs)
                combos = zip(cols, effs) if pair else [(c, b) for c in cols for b in effs]
                for c, b in combos:
                    if not c or not b:
                        continue
                    r = ratio(c, b)
                    if r < need and not any(TOK.get(a) == c for a in ACCENTS):
                        findings.append((round(r, 2), rel, ln, c, b, sz, need, bool(pair)))
            if not selfclose:
                stack.append((name, bgs or None))

if MODE == "--surfaces":
    light = [s for s in surfaces if s[4] == "light"]
    for rel, ln, tag, b, fam, cond in sorted(light):
        print(f"  {rel}:{ln:<5} <{tag:<10} {b}  {'CONDITIONAL' if cond else ''}")
    print(f"\n{len(light)} light surface(s) "
          f"({sum(1 for s in light if s[5])} of them conditional)")
elif MODE == "--contrast":
    for r, rel, ln, c, b, sz, need, pair in sorted(findings):
        print(f"  {r:>5.2f}:1  {rel}:{ln:<5} {c} on {b} {sz}px (needs {need})"
              + ("  [correlated]" if pair else ""))
    print(f"\n{len(findings)} sub-threshold")
else:
    light = [s for s in surfaces if s[4] == "light"]
    print("STYLE AUDIT")
    print(f"  surfaces found ........ {len(surfaces)}  ({len(light)} light)")
    print(f"  light + conditional ... {sum(1 for s in light if s[5])}")
    print(f"  sub-threshold text .... {len(findings)}")
    print()
    print("UNPARSED — expressions this tool could NOT resolve:")
    if not unparsed:
        print("  none — full coverage")
    for k, n in unparsed.items():
        print(f"  {k}: {n}")
        for ex in unparsed_ex[k][:6]:
            print(f"      {ex}")
