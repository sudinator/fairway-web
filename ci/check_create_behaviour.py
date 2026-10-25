#!/usr/bin/env python3
"""212.38 (one-step creation, phase 1) — lib/create-behaviour.test pins what Create saves by running the SHARED rules.
That only holds if the Create screen uses those same rules: the format default allowance (defaultAllowanceFor), the
scramble settings (scrambleCreateSettings), and a button-change application identical to the replay
(applyGuidedFormatPatch sets exactly the fields lib/create-game-format applyCreateFormatPatch sets)."""
import pathlib, re, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
t = (ROOT / "components/tournaments.tsx").read_text(encoding="utf-8")
lib = (ROOT / "lib/create-game-format.ts").read_text(encoding="utf-8")
bad = []
if "GC.defaultAllowanceFor(" not in t: bad.append("Create must take the format's default allowance from lib/game-create defaultAllowanceFor")
if re.search(r'nextType === "alt_shot" \? 50', t): bad.append("Create must not keep its own copy of the default allowance rule")
if "GC.scrambleCreateSettings(" not in t: bad.append("Create must build the scramble settings with lib/game-create scrambleCreateSettings")
if re.search(r'scramble: gameType === "scramble" \? \{', t): bad.append("Create must not keep its own copy of the scramble settings")
m1 = re.search(r"const applyGuidedFormatPatch = \(patch: CreateFormatPatch\) => \{(.*?)\n  \};", t, re.S)
m2 = re.search(r"export function applyCreateFormatPatch\([^)]*\): ReplayedFormat \{(.*?)\n\}", lib, re.S)
if not m1 or not m2: bad.append("applyGuidedFormatPatch (Create) and applyCreateFormatPatch (lib) must both exist")
else:
    a = set(re.findall(r"patch\.(\w+)", m1.group(1))); b = set(re.findall(r"patch\.(\w+)", m2.group(1)))
    if a != b: bad.append(f"Create applies {sorted(a)} but the replay applies {sorted(b)} — keep them identical")
if bad: print("CREATE BEHAVIOUR: FAIL\n  " + "\n  ".join(bad)); sys.exit(1)
print("create behaviour: PASS (the Create screen uses the shared rules the phase-1 snapshot pins)")
