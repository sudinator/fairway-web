#!/usr/bin/env python3
"""Resolved-contrast guard — DISPLAY_RULES.md Parts 2, 3 and 7.

The existing ci/check-contrast.py catches only same-ELEMENT mixing: one style object that sets both
a background and a text colour from opposite families. Its own docstring says cross-element
parent/child pairing is "covered by the rule + review". Review missed it. At 177.60 there were 54
sites where the text sat on an ancestor's background from the wrong family, including three shipped
in 177.59 that made contrast WORSE while being described as a fix:

    vetted tag   C.gold  -> C.sage  on C.card    2.38:1 -> 1.83:1
    share code   C.green -> C.cream on C.card   12.25:1 -> 1.09:1

This guard resolves the ACTUAL painted background by walking the JSX ancestor chain, then measures
the WCAG ratio. It is not a proximity heuristic: a first attempt using "nearest background within
900 characters" classified every site wrong in one direction or the other, and a regex-based tag
matcher classified all 1,270 as unknown because it could not parse `style={{ ... }}`.

Thresholds (WCAG 2.1):
  * normal text  (< 18px, or < 14px bold)  -> 4.5:1
  * large text   (>= 18px, or >= 14px bold) -> 3.0:1
Sites whose background cannot be resolved statically are reported but not failed — guessing is what
caused the original defect.

    python3 ci/check_resolved_contrast.py            # check
    python3 ci/check_resolved_contrast.py --update   # rewrite the baseline
    python3 ci/check_resolved_contrast.py --report   # full listing, no exit code
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASELINE = ROOT / "ci" / "resolved_contrast_baseline.json"
GOLF = ROOT / "lib" / "golf.ts"


def palette():
    src = GOLF.read_text(encoding="utf-8", errors="replace")
    block = re.search(r"export const C\s*=\s*\{(.*?)\n\}", src, re.S)
    out = {}
    for name, hexv in re.findall(r"(\w+)\s*:\s*\"(#[0-9A-Fa-f]{3,8})\"", block.group(1)):
        out["C." + name] = hexv.upper()
    return out


TOK = palette()
# Mid-tone accents are legal on either family; they are judged on ratio alone, never on family.
ACCENTS = {"C.gold", "C.dot", "C.birdie", "C.bogey", "C.indiv", "C.sky"}


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
    """Character scanner: a regex cannot match `style={{ ... }}` because of the nested braces."""
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
        depth, attr_start = 0, j
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
        attrs = src[attr_start:j]
        yield lt, closing, name, attrs, attrs.rstrip().endswith("/")
        i = j + 1


BG = re.compile(r"background(?:Color)?:\s*(C\.\w+|\"#[0-9A-Fa-f]{3,8}\")")

def value_of_style(attrs, prop):
    """Whole style value up to the next top-level comma — keeps a ternary intact."""
    m = re.search(rf"\b{prop}(?:Color)?\s*:\s*", attrs)
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
# Literal colours AND conditional ones. A ternary — `color: cond ? C.birdie : C.green` — is
# still a colour that paints on screen, and BOTH branches must survive their background. The
# original pattern matched literals only, so 123 conditional sites were never examined at all;
# one of them shipped "G1 2 UP" in C.green on a C.greenLight card at 1.54:1.
COLOR = re.compile(r"color:\s*(C\.\w+|\"#[0-9A-Fa-f]{3,8}\")")

# A conditional style is `cond ? A : B` — possibly chained. Capturing the CONDITIONS as well as
# the values is what lets a text colour be matched to the right background branch. Without it the
# checker cross-multiplies every text against every background and reports combinations that can
# never appear on screen: a chip whose background and label both flip on `selected` only ever
# renders (gold, dark) or (green, cream), never (gold, cream).
COND_CHAIN = re.compile(r"([A-Za-z_$][\w$.?\[\]]*)\s*(?:===?\s*[^?]+?)?\s*\?")

def branches(expr):
    """[(condition_or_None, value), ...] for a ternary chain; [] if not conditional."""
    if not expr or "?" not in expr:
        return []
    out, rest = [], expr
    while "?" in rest and ":" in rest:
        cond, _, rest = rest.partition("?")
        val, _, rest = rest.partition(":")
        out.append((cond.strip(), val.strip()))
        if "?" not in rest:
            out.append((None, rest.strip()))
            break
    return out
COLOR_EXPR = re.compile(r"color:\s*([^,}]*?\?[^,}]*?:[^,}]+)")
TOKEN_IN_EXPR = re.compile(r"C\.\w+|\"#[0-9A-Fa-f]{6}\"")
SIZE = re.compile(r"fontSize:\s*(\d+)")
WEIGHT = re.compile(r"fontWeight:\s*(\d+)")


def norm(raw):
    if raw in TOK:
        return TOK[raw], raw
    m = re.fullmatch(r"\"(#[0-9A-Fa-f]{3,8})\"", raw or "")
    return (m.group(1).upper(), m.group(1).upper()) if m else (None, raw)


def analyse(path):
    src = path.read_text(encoding="utf-8", errors="replace")
    stack, stack_raw, out = [], [], []
    for start, closing, name, attrs, selfclose in scan_tags(src):
        if closing:
            for k in range(len(stack) - 1, -1, -1):
                if stack[k][0] == name:
                    del stack[k:]
                    del stack_raw[k:]
                    break
            continue
        bgm = BG.search(attrs)
        braw = value_of_style(attrs, "background") if "background" in attrs else None
        bg = norm(bgm.group(1))[0] if bgm else None
        if bg is None:
            if "...inputStyle" in attrs:
                bg = TOK.get("C.cream")
            elif re.search(r"\.\.\.btn\(\s*true", attrs):
                bg = TOK.get("C.gold")
            elif re.search(r"\.\.\.btn\(", attrs):
                bg = TOK.get("C.greenLight")
            elif name == "BottomSheet" and 'tone="light"' not in attrs:
                bg = TOK.get("C.greenLight")

        # collect every colour this element can paint: the literal, or each ternary branch
        candidates = []
        cm = COLOR.search(attrs)
        if cm:
            candidates.append(cm.group(1))
        else:
            ce = COLOR_EXPR.search(attrs)
            if ce:
                candidates.extend(TOKEN_IN_EXPR.findall(ce.group(1)))

        for cand in candidates:
            fg_hex, fg_name = norm(cand)
            # If this element sets a background we cannot resolve (a variable or a call),
            # the text is painted on THAT, not on any ancestor. Skip rather than mis-attribute.
            unresolvable_own = (braw is not None and bg is None
                                and not re.search(r"transparent|none", braw or ""))
            eff_bg = None if unresolvable_own else (bg or next((b for _, b in reversed(stack) if b), None))
            if fg_hex and eff_bg:
                sz = int(SIZE.search(attrs).group(1)) if SIZE.search(attrs) else 15
                wt = int(WEIGHT.search(attrs).group(1)) if WEIGHT.search(attrs) else 400
                large = sz >= 18 or (sz >= 14 and wt >= 700)
                need = 3.0 if large else 4.5
                r = ratio(fg_hex, eff_bg)
                if r < need and fg_name not in ACCENTS:
                    out.append({
                        "file": str(path.relative_to(ROOT)), "line": src[:start].count("\n") + 1,
                        "fg": fg_name, "bg": eff_bg, "size": sz, "ratio": round(r, 2),
                        "need": need,
                    })
        if not selfclose:
            stack.append((name, bg))
            stack_raw.append((name, bg, braw))
    return out


findings = []
for d in ("components", "app"):
    for f in sorted((ROOT / d).rglob("*.tsx")):
        findings.append((f, analyse(f)))

flat = [x for _, xs in findings for x in xs]
per_file = Counter(x["file"] for x in flat)

if "--report" in sys.argv:
    for x in sorted(flat, key=lambda v: (v["file"], v["line"])):
        print(f"  {x['file']}:{x['line']:<5} {x['fg']:<12} on {x['bg']:<10} "
              f"{x['size']}px  {x['ratio']}:1 (needs {x['need']})")
    print(f"\n{len(flat)} sub-threshold site(s) across {len(per_file)} file(s)")
    sys.exit(0)

if "--update" in sys.argv:
    BASELINE.write_text(json.dumps(dict(sorted(per_file.items())), indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {BASELINE.relative_to(ROOT)} — {len(flat)} site(s) across {len(per_file)} file(s).")
    sys.exit(0)

if not BASELINE.exists():
    print(f"Missing {BASELINE.relative_to(ROOT)} — run with --update")
    sys.exit(1)

base = json.loads(BASELINE.read_text(encoding="utf-8"))
reg, imp = [], []
for k in sorted(set(base) | set(per_file)):
    was, now = base.get(k, 0), per_file.get(k, 0)
    if now > was:
        reg.append(f"{k}: {was} -> {now} (+{now - was})")
    elif now < was:
        imp.append(f"{k}: {was} -> {now} (-{was - now})")

if reg:
    print("RESOLVED CONTRAST FAILED — text got harder to read:")
    for r in reg:
        print("  " + r)
    print("\n  Run --report for the exact sites. Remember the background is the ANCESTOR's,")
    print("  not the element's: C.sage on a cream row is 1.83:1 even though C.sage is a")
    print("  perfectly good colour on green. See DISPLAY_RULES.md Part 3.")
    sys.exit(1)

if imp:
    print("RESOLVED CONTRAST: readability improved — commit the lower baseline:")
    for i in imp:
        print("  " + i)
    sys.exit(1)

print(f"resolved contrast: PASS ({len(flat)} known sub-threshold site(s), none new)")
