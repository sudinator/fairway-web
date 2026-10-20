#!/usr/bin/env python3
"""210.10 — the database test's list of app tabs must equal lib/app-links.ts APP_TABS."""
import re, sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
ts = re.search(r"APP_TABS = \[([^\]]*)\]", (ROOT / "lib/app-links.ts").read_text()).group(1)
sql = re.search(r"app_tabs text\[\] := array\[([^\]]*)\]", (ROOT / "ci/assert-notification-links.sql").read_text()).group(1)
a = sorted(re.findall(r'"([a-z_]+)"', ts)); b = sorted(re.findall(r"'([a-z_]+)'", sql))
if a != b: print(f"App tabs out of sync: lib/app-links.ts {a} vs ci/assert-notification-links.sql {b}"); sys.exit(1)
print(f"App tabs in sync: PASS ({len(a)} tabs)")
