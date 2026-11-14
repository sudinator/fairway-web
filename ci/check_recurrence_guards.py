#!/usr/bin/env python3
"""Guards for incidents that have already happened once and must not happen twice (audit, 201.4).
Each check names the release where the class of bug last shipped. Negative-tested in the audit.

  A. Server-side wall-clock formatting (199.2): code that runs on the server (app/api/**, lib/push-send.ts,
     ci/external/*.mjs) must not format a time for display without an explicit timeZone — Vercel runs in
     UTC and "2:38am" reached a user at 10:38pm. Migrations from 0176 on: to_char() of a timestamptz
     column must carry `at time zone`.
  B. NULL-unsafe SQL assertions (201.2): in ci/assert-*.sql, `if <var> <> 'x'` or `if <var> not like 'x'`
     on a plpgsql variable never raises when the variable is NULL — a missing row passes. Use
     `is distinct from` / `is null or not like`.
  C. is_admin() called with an argument (188.2): the helper takes none; a call with one silently
     resolved to nothing and "Create live link did nothing".
  D. Fixed listen ports in CI helpers (197.1, 197.2): the runner shares its network with the Supabase CLI
     stack, whose ports move between versions. Bind 0.
  E. Ad-hoc first-name shortening (202.2): `name.split(" ")[0]` scattered across seven files showed three
     "Amit"s on one scorecard. lib/short-names.ts is the one rule (first name unless it collides, then
     last initial, then full name); components and lib must go through it. components/player-card.tsx is
     the documented exception (a single person's own name; no set to collide with).
"""
import re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
problems = []

# A. server-side time formatting
server_files = list((ROOT / "app" / "api").rglob("*.ts")) + [ROOT / "lib" / "push-send.ts"] + list((ROOT / "ci" / "external").glob("*.mjs"))
for f in server_files:
    if not f.exists(): continue
    src = f.read_text(encoding="utf-8")
    for i, line in enumerate(src.splitlines(), 1):
        if re.search(r"\.toLocale(Time|Date)?String\(|Intl\.DateTimeFormat\(", line) and "timeZone" not in line:
            problems.append(f"A {f.relative_to(ROOT)}:{i}: formats a time on the server without timeZone (199.2)")
for m in sorted((ROOT / "migrations").glob("*.sql")):
    try: num = int(m.name[:4])
    except ValueError: continue
    if num < 176: continue
    for i, line in enumerate(m.read_text(encoding="utf-8").splitlines(), 1):
        if re.search(r"to_char\(\s*[\w.]*(_at|now\(\))\b", line) and "at time zone" not in line:
            problems.append(f"A {m.relative_to(ROOT)}:{i}: to_char() of a timestamp without `at time zone` (199.2)")

# B. NULL-unsafe assertions
for f in sorted((ROOT / "ci").glob("assert-*.sql")):
    for i, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
        m = re.search(r"\bif\s+([a-z_][a-z0-9_]*)\s+(<>|not like)\s+'", line)
        if m and m.group(1) not in ("current_user", "session_user", "current_role"):
            problems.append(f"B {f.relative_to(ROOT)}:{i}: `if {m.group(1)} {m.group(2)} '…'` is NULL-unsafe — use `is distinct from` / `is null or not like` (201.2)")

# C. is_admin() with an argument
for f in list((ROOT / "migrations").glob("*.sql")) + list((ROOT / "components").rglob("*.tsx")) + list((ROOT / "lib").rglob("*.ts")) + list((ROOT / "app").rglob("*.ts*")):
    src = f.read_text(encoding="utf-8", errors="ignore")
    for i, line in enumerate(src.splitlines(), 1):
        if re.search(r"\bis_admin\(\s*[^)\s]", line) and "function public.is_admin(" not in line and not line.lstrip().startswith("--") and not line.lstrip().startswith("//"):
            problems.append(f"C {f.relative_to(ROOT)}:{i}: is_admin() called with an argument — the helper takes none (188.2)")

# D. fixed ports
for f in (ROOT / "ci").rglob("*.mjs"):
    for i, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
        if re.search(r"\.listen\(\s*[1-9]\d*", line):
            problems.append(f"D {f.relative_to(ROOT)}:{i}: fixed listen port in a CI helper — bind 0 (197.2)")

# F. staging-only tooling must stay staging-only (204.2): any component that renders the auto-score
#    control must gate it on isStagingClient(); the layout must set html[data-env].
op = (ROOT / "components" / "game" / "organizer-panel.tsx").read_text(encoding="utf-8")
if "onAutoScore" in op and "isStagingClient()" not in op:
    problems.append("F components/game/organizer-panel.tsx: auto-score control is not gated on isStagingClient() (204.2)")
lay = (ROOT / "app" / "layout.tsx").read_text(encoding="utf-8")
if 'data-env={isStaging ? "staging" : "production"}' not in lay:
    problems.append("F app/layout.tsx: html[data-env] marker missing — staging-only tooling would leak or vanish (204.2)")

# G. a Supabase request builder is LAZY: `void x.rpc(...)` / `void x.from(...)` without a .then in the
#    same statement sends nothing (review finding 7, 205.4). Await it, or chain .then.
for src in [p for d in ("app", "components", "lib") for p in (ROOT / d).rglob("*.ts*") if "node_modules" not in p.parts and not p.name.endswith(".test.ts") and not p.name.endswith(".test.tsx")]:
    text = src.read_text(encoding="utf-8")
    for m in re.finditer(r"\bvoid\s+[A-Za-z_][\w.()]*\s*\.\s*(rpc|from)\s*\(", text):
        stmt = text[m.start(): text.find(";", m.end()) if text.find(";", m.end()) > 0 else len(text)]
        if ".then(" not in stmt:
            line = text.count("\n", 0, m.start()) + 1
            problems.append(f"G {src.relative_to(ROOT)}:{line}: discarded Supabase request (lazy builder — nothing is sent); await it or chain .then (205.4)")

# H. createClient() returns a NEW wrapper each call. Created inside a component and listed as a hook
#    dependency, it changes every render and re-runs the effect forever (207.0: the course-history
#    panel looped until its rendered test hung). Inside components: useMemo(() => createClient(), []).
for src in [p for d in ("app", "components") for p in (ROOT / d).rglob("*.tsx") if "node_modules" not in p.parts]:
    text = src.read_text(encoding="utf-8")
    if re.search(r"^[ \t]+const supabase = createClient\(\);", text, re.M) and re.search(r"\[[^\]\n]*\bsupabase\b[^\]\n]*\]\s*\)", text):
        problems.append(f"H {src.relative_to(ROOT)}: createClient() inside a component AND used as a hook dependency — wrap it: useMemo(() => createClient(), []) (207.0)")

# E. ad-hoc name shortening
ALLOW_E = {ROOT / "lib" / "short-names.ts", ROOT / "components" / "player-card.tsx"}
for f in list((ROOT / "components").rglob("*.tsx")) + list((ROOT / "lib").rglob("*.ts")):
    if f in ALLOW_E or f.name.endswith(".test.ts") or f.name.endswith(".test.tsx"): continue
    for i, line in enumerate(f.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
        if re.search(r"\.split\(\s*[\"']\s[\"']\s*\)\s*\[\s*0\s*\]|\.split\(/\\s\+/\)", line) and ("name" in line.lower()):
            problems.append(f"E {f.relative_to(ROOT)}:{i}: shortens a name by hand — use shortNamer/shortLabels from lib/short-names (202.2)")

# I. Never CALL an EXECUTE-revoked function as anon/authenticated (208.4, 212.105).
# Reuse the central server-only catalogue; inspect direct calls inside app-role
# sections, including DO bodies. Literals/comments are data, not calls. This is
# a source guard for direct SQL; the database security contract remains authoritative.
def app_role_calls(sql, names):
    clean = re.sub(r"'(?:''|[^'])*'|--[^\n]*|/\*[\s\S]*?\*/", lambda m: re.sub(r"[^\n]", " ", m.group()), sql)
    tokens = re.compile(r'\bset\s+(?:local\s+|session\s+)?role\s+"?([a-z_][a-z0-9_]*)"?|\breset\s+role\b|\b(?:public\.)?(' + '|'.join(re.escape(n) for n in sorted(names)) + r')\s*\(', re.I)
    role = None
    found = []
    for m in tokens.finditer(clean):
        if m.group(1): role = m.group(1).lower()
        elif m.group(2):
            if role in ('anon', 'authenticated'):
                found.append((sql.count('\n', 0, m.start()) + 1, m.group(2)))
        else: role = None
    return found

# Canaries: actual regression, multiline/anon, caught denials, owner/reset,
# and privilege-catalogue strings. These execute every time this guard runs.
for sql, expected in [
    ("set local role authenticated; do $$begin perform public.private_job(); exception when insufficient_privilege then null; end $$;", 1),
    ("set role anon; select public.\nprivate_job();", 1),
    ("set role authenticated; select private_job();", 1),
    ("select public.private_job();", 0),
    ("set role authenticated; reset role; select public.private_job();", 0),
    ("set role authenticated; set role postgres; select public.private_job();", 0),
    ("set role authenticated; select has_function_privilege(current_user,'public.private_job()','execute');", 0),
    ("set role authenticated; -- perform public.private_job();\nselect 1;", 0),
    ("set role authenticated; /* perform public.private_job(); */ select 1;", 0),
]:
    if len(app_role_calls(sql, {'private_job'})) != expected:
        problems.append('I revoked-function source-guard canary failed')

catalogue = (ROOT / 'ci' / 'assert-no-app-call-to-revoked.sql').read_text(encoding='utf-8')
private_names = set(re.findall(r"\('public\.([a-z_][a-z0-9_]*)\(", catalogue))
if not {'run_daily_stale_games', 'finish_stale_rounds', 'sweep_stale_games'} <= private_names:
    problems.append('I stale maintenance is missing from the central server-only privilege check')
for f in sorted((ROOT / 'ci').glob('assert-*.sql')):
    for line, name in app_role_calls(f.read_text(encoding='utf-8'), private_names):
        problems.append(f'I {f.relative_to(ROOT)}:{line}: app role calls server-only {name} — check has_function_privilege instead (208.4, 212.105)')

if problems:
    print("recurrence guards: FAIL")
    for p in problems: print("  " + p)
    sys.exit(1)
print("recurrence guards: PASS (server time formatting, NULL-safe assertions, is_admin arity, OS-assigned ports, one name-shortening rule, staging-only tooling gated, no discarded Supabase requests, stable Supabase client in hooks, no app-role calls to server-only functions; 9 denial-call canaries)")
