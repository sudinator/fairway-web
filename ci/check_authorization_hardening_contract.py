#!/usr/bin/env python3
"""Source-level closure for the v179.8 authorization boundaries."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
migration = (ROOT / "migrations/0144_authorization_hardening.sql").read_text(encoding="utf-8")
home = (ROOT / "components/home.tsx").read_text(encoding="utf-8")
workflow = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
robustness = (ROOT / ".github/workflows/robustness.yml").read_text(encoding="utf-8")
production_schema = (ROOT / ".github/workflows/production-schema-guard.yml").read_text(encoding="utf-8")
behavior = (ROOT / "ci/assert-core-rls-behavior.sql").read_text(encoding="utf-8")
errors: list[str] = []

required_sql = [
    "coalesce(new.is_owner, false) is distinct from coalesce(old.is_owner, false)",
    "profiles_single_owner_idx",
    "g.created_by = auth.uid()",
    "create or replace function public.accept_group_email_invites()",
    "drop policy if exists \"games_group_member_all\"",
    "revoke all on function public._money_snapshot(uuid) from public, anon, authenticated",
    "revoke all on function public.sweep_stale_games() from public, anon",
    "revoke references, trigger, truncate on table",
    "record_migration('0144_authorization_hardening')",
]
for token in required_sql:
    if token not in migration:
        errors.append(f"0144 is missing required boundary: {token}")

if 'supabase.rpc("accept_group_email_invites")' not in home:
    errors.append("home invite activation must use the role-preserving RPC")
if '.from("group_members").update({ user_id: user.id, status: "active" })' in home:
    errors.append("home retains direct invite-row activation")

production_job = workflow.split("production-migration-parity:", 1)[-1]
if "if: github.event_name == 'push' && github.ref == 'refs/heads/main'" not in production_job:
    errors.append("Production parity is not restricted to trusted push-to-main code")
if "SUPABASE_DB_URL" in robustness:
    errors.append("all-branch robustness workflow still references Production database credentials")
if "branches: [main]" not in production_schema or "pull_request:" in production_schema or "workflow_dispatch:" in production_schema:
    errors.append("Production schema guard is not restricted to trusted main code")

for token in (
    "user self-promoted to owner",
    "outsider self-appointed as group admin",
    "invite acceptance did not preserve member role",
    "group member edited another organizer''s game",
    "browser role retains TRUNCATE",
):
    if token not in behavior:
        errors.append(f"negative authorization test missing: {token}")

if errors:
    print("AUTHORIZATION HARDENING CONTRACT: FAIL")
    for error in errors:
        print(" -", error)
    sys.exit(1)

print("Authorization hardening contract: PASS (migration, client, CI secret boundary, negative tests)")
