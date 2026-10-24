#!/usr/bin/env python3
"""212.36 — the public live page scores skins through lib/live-skins (the app's rules, skinsTotals). It scored every skins
game as individual carry-over across the field. The only field-wide computeSkins left is the Carryovers box, which shows
ONLY for individual skins with ties carried — exactly where that IS the app's rule."""
import pathlib, re, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
s = (ROOT / "app/live/[token]/page.tsx").read_text(encoding="utf-8")
bad = []
if s.count("liveSkins(") < 2: bad.append("the team standings and the player list must both use liveSkins(...)")
calls = [m.start() for m in re.finditer(r"computeSkins\(", s)]
fn = s.find("function SkinsCarry(")
guard = s.find('if (game.skins_mode === "split" || (game.teams || []).length === 2) return null;', fn)
for c in calls:
    nxt = s.find("\nfunction ", fn + 1)
    if not (fn != -1 and fn < c < (nxt if nxt != -1 else len(s))): bad.append(f"computeSkins( outside SkinsCarry (line {s[:c].count(chr(10)) + 1})")
if calls and (guard == -1 or guard > calls[0]): bad.append("SkinsCarry must return early for halved and team skins before computeSkins")
lib = (ROOT / "lib/live-skins.ts").read_text(encoding="utf-8")
if "skinsTotals(" not in lib: bad.append("lib/live-skins.ts must use the app's skinsTotals")
if bad: print("LIVE SKINS: FAIL\n  " + "\n  ".join(bad)); sys.exit(1)
print("live skins: PASS (the live page scores skins with the app's rules; carry-overs only for individual carry-over skins)")
