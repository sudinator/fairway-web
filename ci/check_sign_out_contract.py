#!/usr/bin/env python3
"""Sign-out contract (212.130). Before it, both Sign out buttons swept every bnn_* key — other identities' unsynced scores
and the recovery archive included — BEFORE the sign-out call was awaited, so a failed sign-out had already deleted the
phone's scores. Every sign-out in the app must go through lib/sign-out signOutSafely (scan → question → awaited sign-out
→ scoped cleanup), and nothing may bring the sweep back. Negative-tested: putting `clearAllLocalState(); supabase.auth
.signOut();` back on a button, or calling signOut() from a component outside the flow, fails this check."""
import pathlib, re, sys
ROOT = pathlib.Path(__file__).resolve().parents[1]
problems = []
app_files = [p for d in ("components", "app", "lib") for p in (ROOT / d).rglob("*.ts*") if ".test." not in p.name]
# 1. the sweep is gone, and no file re-creates it
for p in app_files:
    text = p.read_text(encoding="utf-8")
    for line in text.splitlines():
        if line.strip().startswith(("//", "*", "/*")): continue
        if "clearAllLocalState" in line: problems.append(f"{p.relative_to(ROOT)}: clearAllLocalState (the sign-out sweep) must not return; use lib/sign-out")
# 2. every auth.signOut() call in the app is inside the flow: a Deps.signOut passed to signOutSafely / SignOutRow, or the
#    Google account switch (which signs straight back in and keeps the phone's data)
ALLOWED = {"lib/google-sign-in.ts"}
for p in app_files:
    rel = str(p.relative_to(ROOT))
    text = p.read_text(encoding="utf-8")
    for i, line in enumerate(text.splitlines(), 1):
        if "auth.signOut(" not in line or line.strip().startswith("//"): continue
        if rel in ALLOWED: continue
        if "signOutSafely(" in line or "onSignOut={() => supabase.auth.signOut()}" in line or "signOut: () => supabase.auth.signOut()" in line: continue
        problems.append(f"{rel}:{i}: auth.signOut() outside signOutSafely — sign-out must scan, ask, await, then clear (lib/sign-out)")
# 3. the flow itself keeps its order and its exemptions
flow = (ROOT / "lib/sign-out.ts").read_text(encoding="utf-8")
order = [flow.find("unsyncedWork(storage)"), flow.find("await deps.signOut()"), flow.find("archiveScoringBackups(false, userId)"), flow.find("clearLocalStateForSignOut(userId, storage)")]
if any(i < 0 for i in order) or order != sorted(order): problems.append("lib/sign-out.ts: signOutSafely must scan, await the sign-out, archive, then clear — in that order")
if "if (error) {" not in flow or flow.find("if (error) {") > order[2]: problems.append("lib/sign-out.ts: a sign-out error must return before anything is archived or removed")
for must in ("key === SCORING_ARCHIVE_KEY) continue", "m[1] !== userId) continue"):
    if must not in flow: problems.append(f"lib/sign-out.ts: cleanup must keep the recovery archive and other identities' outboxes ({must})")
# 4. the test runs
pkg = (ROOT / "package.json").read_text(encoding="utf-8")
if "node .testout-screens/lib/sign-out.test.js" not in pkg or '"lib/sign-out.test.ts"' not in (ROOT / "tsconfig.screens.json").read_text(encoding="utf-8"):
    problems.append("lib/sign-out.test.ts must be compiled (tsconfig.screens.json) and run (package.json test)")
if problems:
    print("SIGN-OUT CONTRACT: FAIL"); [print("  " + x) for x in problems]; sys.exit(1)
print("sign-out contract: PASS (both buttons on signOutSafely; no sweep; archive and other identities kept; test wired)")
