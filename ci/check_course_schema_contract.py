#!/usr/bin/env python3
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
errors = []

def require(text, needle, label):
    if needle not in text:
        errors.append(f"missing {label}: {needle}")

def forbid(text, pattern, label):
    if re.search(pattern, text, re.I | re.S):
        errors.append(f"forbidden {label}: {pattern}")

baseline = (ROOT / "supabase/migrations/0001_baseline.sql").read_text()
forward = (ROOT / "migrations/0132_course_schema_reconciliation_and_privilege_hardening.sql").read_text()
client = "\n".join(p.read_text(errors="ignore") for base in ["app", "components", "lib"] for p in (ROOT/base).rglob("*.ts*") if p.is_file())

for table in ["group_course_overrides", "course_change_requests"]:
    require(baseline, f"create table if not exists {table}", f"baseline create {table}")
    require(forward, f"create table if not exists public.{table}", f"forward reconcile {table}")
    require(forward, f"alter table public.{table} enable row level security", f"RLS {table}")
    require(forward, f"revoke all privileges on table public.{table} from anon", f"anon revoke {table}")
    require(forward, f"revoke all privileges on table public.{table} from authenticated", f"authenticated revoke {table}")
    require(forward, f"grant select on table public.{table} to authenticated", f"authenticated read {table}")

require(baseline, "unique (group_id, course_id)", "override unique arbiter")
require(forward, "group_course_overrides_group_id_course_id_key unique (group_id, course_id)", "forward unique arbiter")
require(forward, "drop policy if exists group_course_overrides_insert_member", "remove override direct insert")
require(forward, "drop policy if exists group_course_overrides_update_member", "remove override direct update")
require(forward, "drop policy if exists group_course_overrides_delete_admin", "remove override direct delete")
require(forward, "drop policy if exists course_change_requests_insert_member", "remove request direct insert")
require(forward, "drop policy if exists course_change_requests_update_admin", "remove request direct update")
require(forward, "public.is_group_member(group_id, auth.uid())", "member-visible policies")

# Direct client reads are allowed; direct client mutations are not.
for table in ["group_course_overrides", "course_change_requests"]:
    pat = rf'\.from\(["\']{table}["\']\)\s*\.\s*(insert|update|upsert|delete)\s*\('
    forbid(client, pat, f"direct client mutation of {table}")

# The app must still read the two tables directly through RLS.
require(client, '.from("group_course_overrides")', "override read path")
require(client, '.from("course_change_requests")', "correction read path")

if errors:
    print("COURSE SCHEMA CONTRACT: FAIL")
    for e in errors:
        print(" -", e)
    sys.exit(1)
print("COURSE SCHEMA CONTRACT: PASS")
