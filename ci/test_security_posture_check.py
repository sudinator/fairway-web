#!/usr/bin/env python3
"""The live security-posture check (0182) fails on a hand-made / RLS-off table and passes when clean.

Runs ci/check_live_migration_parity.mjs against fixtures — no network, no credentials. The ledger
fixture is built the way the script builds its expectation (every migration file 0113+), so only the
posture part varies. Also proves ci/public_tables.json lists every table a migration creates.
"""
import json, os, re, subprocess, sys, tempfile, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[1]
files = sorted(p.name[:-4] for p in (ROOT / "migrations").glob("[0-9][0-9][0-9][0-9]_*.sql") if int(p.name[:4]) >= 113)
tables = json.loads((ROOT / "ci/public_tables.json").read_text())["tables"]
fails = []

def run(posture):
    with tempfile.TemporaryDirectory() as d:
        led = pathlib.Path(d, "ledger.json"); led.write_text(json.dumps([{"id": f} for f in files]))
        pos = pathlib.Path(d, "posture.json"); pos.write_text(json.dumps(posture))
        env = dict(os.environ, BNN_PRODUCTION_SUPABASE_URL="https://x.supabase.co", BNN_PRODUCTION_SUPABASE_SERVICE_ROLE_KEY="x",
                   BNN_MIGRATION_LEDGER_FIXTURE=str(led), BNN_SECURITY_POSTURE_FIXTURE=str(pos))
        r = subprocess.run(["node", str(ROOT / "ci/check_live_migration_parity.mjs"), "production"], env=env, capture_output=True, text=True, timeout=60)
        return r.returncode, r.stdout + r.stderr

clean = [{"table": t, "rls": True} for t in tables]
code, out = run(clean)
if code != 0 or "SECURITY POSTURE: PASS" not in out: fails.append(f"clean posture should pass: {out[-300:]}")
code, out = run(clean + [{"table": "course_id_reconciliation_tmp", "rls": False}])
if code == 0 or "course_id_reconciliation_tmp" not in out or "Row-Level Security is OFF" not in out: fails.append("a hand-made RLS-off table must fail, naming it")
code, out = run([dict(t, rls=False) if t["table"] == "rounds" else t for t in clean])
if code == 0 or "rounds: Row-Level Security is OFF" not in out: fails.append("RLS switched off on a real table must fail")
code, out = run(clean + [{"table": "scratch_backup", "rls": True}])
if code == 0 or "scratch_backup: not created by any migration" not in out: fails.append("an unknown table WITH RLS must still fail (made by hand)")

# Every `create table public.X` in the migrations is in the list (the full-chain run checks the reverse).
created = set()
for p in (ROOT / "migrations").glob("*.sql"):
    for m in re.finditer(r"create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(", p.read_text(encoding="utf-8"), re.I):
        created.add(m.group(1).lower())
dropped = set()
for p in (ROOT / "migrations").glob("*.sql"):
    for m in re.finditer(r"drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)", p.read_text(encoding="utf-8"), re.I):
        dropped.add(m.group(1).lower())
missing = sorted(created - dropped - set(tables) - {"schema_migrations"})
if missing and set(missing) - {"public"}: fails.append(f"ci/public_tables.json is missing tables a migration creates: {missing[:10]}")

if fails:
    print("SECURITY POSTURE CHECK TEST: FAIL"); [print(" -", f) for f in fails]; sys.exit(1)
print(f"security posture check: PASS (4 fixture cases; {len(tables)} tables listed)")
