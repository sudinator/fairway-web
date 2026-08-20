#!/usr/bin/env python3
"""Release verification: assert every agreed change actually took, and nothing regressed.

Gates prove the code compiles. They do not prove that MY specific edits did what I said they
would. This checks each agreed item explicitly, by reading the shipped files.
"""
import json, re, sys
from pathlib import Path
ROOT = Path(sys.argv[1])
ok = fail = 0
def check(cond, label, detail=""):
    global ok, fail
    if cond: ok += 1; print(f"  PASS  {label}")
    else:    fail += 1; print(f"  FAIL  {label}" + (f"\n          {detail}" if detail else ""))

def read(p): return (ROOT/p).read_text(encoding="utf-8", errors="replace")
def allsrc():
    for d in ("components","app"):
        for f in sorted((ROOT/d).rglob("*.tsx")): yield f, f.read_text(encoding="utf-8",errors="replace")

def lum(h):
    h=h.lstrip('#'); c=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    c=[(x/12.92 if x<=0.03928 else ((x+0.055)/1.055)**2.4) for x in c]
    return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]
def ratio(a,b):
    x,y=sorted([lum(a),lum(b)],reverse=True); return (x+0.05)/(y+0.05)

TOK = {m.group(1): m.group(2).upper() for m in
       re.finditer(r'(\w+):\s*"(#[0-9A-Fa-f]{6})"', read("lib/golf.ts").split("export const C")[1].split("\n}")[0])}

print("=== 177.69 · agreed fixes ===")

# 1 destructive ghost buttons readable.
# Resolved by walking the JSX ancestor chain, NOT by a proximity lookback. A 900-character
# window silently missed the very bug this check exists for: the nearest preceding
# `background:` is often a sibling's, or is too far above to be inside the window.
def scan_tags(src):
    i, n = 0, len(src)
    while i < n:
        lt = src.find("<", i)
        if lt < 0: return
        j = lt + 1; closing = False
        if j < n and src[j] == "/": closing, j = True, j + 1
        m = re.match(r"[A-Za-z][\w.]*", src[j:])
        if not m: i = lt + 1; continue
        name = m.group(0); j += len(name); depth, a0 = 0, j
        while j < n:
            c = src[j]
            if c in "\"'`":
                q, j = c, j + 1
                while j < n and src[j] != q: j += 2 if src[j] == "\\" else 1
            elif c == "{": depth += 1
            elif c == "}": depth -= 1
            elif c == ">" and depth == 0: break
            j += 1
        if j >= n: return
        yield lt, closing, name, src[a0:j], src[a0:j].rstrip().endswith("/")
        i = j + 1

DARKS = {"C.green", "C.greenMid", "C.greenLight"}
bad = []
for f, t in allsrc():
    stack = []
    for start, closing, name, attrs, selfclose in scan_tags(t):
        if closing:
            for k in range(len(stack) - 1, -1, -1):
                if stack[k][0] == name: del stack[k:]; break
            continue
        bm = re.search(r"background(?:Color)?:\s*(C\.\w+)", attrs)
        own = bm.group(1) if bm else None
        cm = re.search(r"color:\s*[^,}]{0,40}\bC\.birdie\b", attrs)
        if cm:
            eff = own or next((b for _, b in reversed(stack) if b), None)
            if eff in DARKS:
                bad.append(f"{f.name}:{t[:start].count(chr(10)) + 1}")
        if not selfclose: stack.append((name, own))
check(not bad, "no C.birdie text on a green surface", ", ".join(bad[:4]))
check(ratio(TOK["overRedDark"], TOK["greenLight"]) >= 4.5,
      f"C.overRedDark readable on green ({ratio(TOK['overRedDark'],TOK['greenLight']):.2f}:1)")
n=sum(len(re.findall(r'C\.overRedDark', t)) for _,t in allsrc())
check(n >= 45, f"C.overRedDark in use at {n} sites")

# 2 success buttons mint, not blue
blue=[(f.name, t.count('background: C.underDark, color: C.green')) for f,t in allsrc()
      if 'background: C.underDark, color: C.green' in t]
check(not blue, "no success button using C.underDark", str(blue))
mint=sum(t.count('background: "#7FD6A3", color: C.green') for _,t in allsrc())
check(mint == 6, f"6 success buttons restored to mint (found {mint})")
check(ratio("#06251A", "#7FD6A3") >= 4.5, f"mint carries dark text ({ratio('#06251A','#7FD6A3'):.2f}:1)")

print("\n=== earlier releases · still holding ===")
check("font-weight: 500" in read("app/globals.css"), "177.67 body weight 500")
check("color-scheme: light" in read("app/globals.css"), "177.65 color-scheme declared")
check(":focus-visible" in read("app/globals.css"), "177.65 focus ring")
w=set()
for _,t in allsrc(): w.update(int(x) for x in re.findall(r'fontWeight:\s*(\d+)', t))
check(w <= {500,700,800}, f"177.67 weights are 500/700/800 (found {sorted(w)})")
r=set()
for _,t in allsrc(): r.update(int(x) for x in re.findall(r'borderRadius:\s*(\d+)', t))
check(r <= {6,8,10,12,14,999}, f"177.67 radii are 6 values (found {sorted(r)})")
check(TOK["field"] == "#EBE3CC", "177.61 C.field")
check(TOK["faint"] == "#676253" and TOK["sage"] == "#B2CBBD", "177.61 C.faint / C.sage")
check("...(canFinishGroup ?" in read("components/tournaments.tsx"), "177.59 end-game undefined-override fix")
check("...(copied ?" in read("components/game/organizer-panel.tsx"), "177.59 copy-summary fix")
check(not re.search(r'borderRadius:\s*99(?!\d)', read("components/game/scorecard-views.tsx")), "177.59 pill radius 999")
check("ghost" in read("components/ui.tsx") and "BtnRole" in read("components/ui.tsx"), "177.67 btn() roles")

print("\n=== regression checks ===")
bad=[f"{f.name}" for f,t in allsrc() if re.search(r'"#[0-9A-Fa-f]*C\.|C\.\w+C\.\w+', t)]
check(not bad, "no mangled token names from scripted edits", ", ".join(bad[:4]))
ver = json.loads(read("package.json"))["version"]
check(re.fullmatch(r"\d+\.\d+\.\d{6}", ver) is not None, f"version parses ({ver})")
head = read("DEPLOY_NOTES.md").split("\n")[0]
check(head.startswith(f"## {ver}"), f"DEPLOY_NOTES newest entry is {ver}",
      f"newest heading: {head[:48]}")

print(f"\n{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
