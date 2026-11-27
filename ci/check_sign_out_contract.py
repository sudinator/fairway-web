#!/usr/bin/env python3
"""Sign-out contract (212.130). Before it, both Sign out buttons swept every bnn_* key — other identities' unsynced scores
and the recovery archive included — BEFORE the sign-out call was awaited, so a failed sign-out had already deleted the
phone's scores. Every sign-out in the app must go through lib/sign-out signOutSafely (scan → question → awaited sign-out
→ scoped cleanup), and nothing may bring the sweep back. Negative-tested: putting `clearAllLocalState(); supabase.auth
.signOut();` back on a button, or calling signOut() from a component outside the flow, fails this check."""
import pathlib, re, sys
ROOT = pathlib.Path(__file__).resolve().parents[1]
problems = []
app_files = [p for d in ("components", "app", "lib") for p in (ROOT / d).rglob("*.ts*") if ".test." not in p.name and p.name not in ("test-dom.ts", "test-render.ts", "screen-harness.ts")]
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
    if rel in ALLOWED: continue
    # whitespace-insensitive over the whole file: a call split across lines, or an alias, is still a bypass
    flat = re.sub(r"\s+", "", re.sub(r"//[^\n]*", "", p.read_text(encoding="utf-8")))
    rest = flat.replace("onSignOut={()=>supabase.auth.signOut()}", "").replace("signOut:()=>supabase.auth.signOut()", "")
    if ("auth.signOut(" in rest or "auth[\"signOut\"]" in rest or "auth['signOut']" in rest or ".auth.signOut;" in rest or "=supabase.auth.signOut" in rest
        or re.search(r"=supabase\.auth[;,)]", rest) or re.search(r"\{[^}]*signOut[^}]*\}=[\w.]*auth", rest)):   # an alias of the auth object, or a destructured signOut
        problems.append(f"{rel}: auth.signOut reached outside signOutSafely (direct call, alias or bracket access) — sign-out must scan, ask, archive, await, then clear (lib/sign-out)")
    if rel != "lib/sign-out.ts" and ("localStorage.clear()" in flat or re.search(r"startsWith\(\"bnn_\"\)[^;]{0,80}removeItem", flat)):
        problems.append(f"{rel}: a sweep of local storage outside lib/sign-out.ts — the scoped clear is the only one allowed")
# 3. the flow itself keeps its order and its exemptions
flow = (ROOT / "lib/sign-out.ts").read_text(encoding="utf-8")
# 212.132: the archive (non-destructive) and every question come BEFORE the sign-out call, while the app's own sheet is
# still on screen; the clear comes after a successful sign-out only
order = [flow.find("unsyncedWork(storage"), flow.find("archiveScoringBackups(false, userId)"), flow.find("await deps.signOut()"), flow.find("clearLocalStateForSignOut(userId, storage")]
if any(i < 0 for i in order) or order != sorted(order): problems.append("lib/sign-out.ts: signOutSafely must scan, ask and archive, await the sign-out, then clear — in that order")
if "if (error) {" not in flow or flow.find("if (error) {") > order[3]: problems.append("lib/sign-out.ts: a sign-out error must return before anything is removed")
if flow.find("deps.notify(") > order[3] and "deps.notify(" in flow[order[3]:]: problems.append("lib/sign-out.ts: nothing may be toasted after the clear — the screen that shows toasts is gone once signed out")
# 212.135: the automatic retirement of unsyncable entries (deleted/ended games) judges only the member's OWN entries,
# never another identity's outbox by this member's game list (the cold review's P1), and archives before it removes
retire = flow[flow.find("export function retireItems"):flow.find("export function retiredSummary")]
if "items.filter((i) => i.owner === userId)" not in flow[flow.find("export async function retireUnsyncable"):]: problems.append("lib/sign-out.ts: retireUnsyncable must consider only the signed-in member's own entries")
if retire.find("archiveScoringBackups(false, userId)") < 0 or retire.find("archiveScoringBackups(false, userId)") > retire.find("storage.removeItem("): problems.append("lib/sign-out.ts: retireItems must archive before it removes")
for must in ("key === SCORING_ARCHIVE_KEY || key.startsWith(RECOVERY_PREFIX)) continue", "(m[1] !== userId || opts.keepOwnOutbox)) continue", "keepOwnOutbox: !archived"):
    if must not in flow: problems.append(f"lib/sign-out.ts: cleanup must keep the recovery archive, the Recovery copies, other identities' outboxes, and the member's own when it could not be archived ({must})")
# 4. the test runs
pkg = (ROOT / "package.json").read_text(encoding="utf-8")
if "node .testout-screens/lib/sign-out.test.js" not in pkg or '"lib/sign-out.test.ts"' not in (ROOT / "tsconfig.screens.json").read_text(encoding="utf-8"):
    problems.append("lib/sign-out.test.ts must be compiled (tsconfig.screens.json) and run (package.json test)")
if problems:
    print("SIGN-OUT CONTRACT: FAIL"); [print("  " + x) for x in problems]; sys.exit(1)
print("sign-out contract: PASS (both buttons on signOutSafely; no sweep; archive and other identities kept; retirement own-entries-only and archived first; test wired)")
