#!/usr/bin/env python3
"""Version ledger contract — package.json must agree with DEPLOY_NOTES.md.

Why this exists: 177.59 was packaged, committed and deployed to staging with package.json still
reading 177.58.260816. The Help screen therefore kept reporting the previous version, and nothing
in the pipeline noticed — typecheck, lint, 54 guards, tests and the build were all green, because
the version string is data, not code.

The user-visible version comes from package.json:

    package.json  ->  scripts/write-version.mjs (prebuild)  ->  lib/app-version.ts
                                                             ->  public/app-version.json
                                                             ->  public/sw.js

Note the DATE segment is auto-stamped at build time from the US/Eastern date, so only FEATURE.EDIT
is hand-maintained — and FEATURE.EDIT is exactly what gets forgotten. This guard makes forgetting
it a red build instead of a silently stale Help screen.

Checks:
  1. package.json version parses as FEATURE.EDIT.YYMMDD (the current scheme).
  2. The newest DEPLOY_NOTES.md heading is a version heading.
  3. Their FEATURE.EDIT match. The date segment is deliberately NOT compared — DEPLOY_NOTES records
     the date the notes were written, while the build stamps the date it actually ran, and a release
     prepared late in the day or deployed the next morning would legitimately differ.
  4. The newest DEPLOY_NOTES version is not older than the one below it (catches a prepend that
     went in out of order).
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / "package.json"
NOTES = ROOT / "DEPLOY_NOTES.md"

VERSION = re.compile(r"^(\d+)\.(\d+)\.(\d{6})$")
HEADING = re.compile(r"^##\s+(\d+)\.(\d+)\.(\d{6})\b")

failures = []

pkg_version = json.loads(PKG.read_text(encoding="utf-8")).get("version", "")
m = VERSION.match(pkg_version)
if not m:
    failures.append(
        f"package.json version {pkg_version!r} is not FEATURE.EDIT.YYMMDD. "
        f"The legacy 1.MINOR.PATCH scheme is no longer accepted for new releases."
    )
    print("VERSION LEDGER FAILED:")
    for f in failures:
        print("  " + f)
    sys.exit(1)

pkg_fe = (int(m.group(1)), int(m.group(2)))

headings = []
for line in NOTES.read_text(encoding="utf-8", errors="replace").splitlines():
    h = HEADING.match(line.strip())
    if h:
        headings.append(((int(h.group(1)), int(h.group(2))), h.group(3), line.strip()))
    if len(headings) >= 2:
        break

if not headings:
    failures.append("DEPLOY_NOTES.md has no `## FEATURE.EDIT.YYMMDD — ...` heading")
else:
    newest_fe, newest_date, newest_line = headings[0]
    if newest_fe != pkg_fe:
        failures.append(
            f"package.json is {pkg_version} (FEATURE.EDIT {pkg_fe[0]}.{pkg_fe[1]}) but the newest\n"
            f"      DEPLOY_NOTES entry is {newest_fe[0]}.{newest_fe[1]}.{newest_date}\n"
            f"      -> {newest_line[:100]}\n"
            f"      Bump package.json, or add the DEPLOY_NOTES entry for this release."
        )
    if len(headings) > 1 and headings[0][0] < headings[1][0]:
        p_fe = headings[1][0]
        failures.append(
            f"DEPLOY_NOTES.md is out of order: newest heading {newest_fe[0]}.{newest_fe[1]} is older "
            f"than the one below it ({p_fe[0]}.{p_fe[1]}). New entries go at the TOP."
        )

if failures:
    print("VERSION LEDGER FAILED:")
    for f in failures:
        print("  " + f)
    print("\n  The user-visible version in Help comes from package.json via scripts/write-version.mjs.")
    print("  Shipping without bumping it leaves Help reporting the previous release.")
    sys.exit(1)

print(f"version ledger: PASS (package.json {pkg_version} matches DEPLOY_NOTES {newest_line[3:40].strip()})")
