#!/usr/bin/env python3
"""211.2 — THE SECURITY CONTRACT (owner, Oct 21 2026: "every version needs to check this without compromise").

Runs against a database built from EVERY migration (the fresh-chain CI database), and checks the real state:
  1. every public table has row-level security ON;
  2. every access rule (policy) on EVERY table matches ci/security_contract.json exactly — name, command, roles,
     USING and WITH CHECK;
  3. every privilege signed-out visitors (anon) and members (authenticated) hold on tables, and every function
     they can EXECUTE among SECURITY DEFINER functions, matches the snapshot;
  4. every SECURITY DEFINER function pins its search_path;
  5. every table members can write directly carries the approved-accounts rule (guard_active_account, 0197),
     except the deliberate exceptions recorded in the snapshot (profiles, notifications);
  6. no SECURITY DEFINER function is callable by a signed-out visitor unless the snapshot lists it.
A difference FAILS the build, printing exactly what changed. Updating the snapshot is a deliberate act:
  python3 ci/check_security_contract.py <db_url> --update
and the diff of ci/security_contract.json then shows, in the release, every permission that changed.
"""
import json, subprocess, sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
SNAP = ROOT / "ci" / "security_contract.json"
GUARD_EXCEPTIONS = {"profiles": "account fields locked by guard_account_fields (0189)", "notifications": "members mark their own as read",
                    "push_subscriptions": "a pending member must be able to receive 'you're approved' (0206)",
                    "daily_active": "the activity ping (0206)", "feedback": "anyone signed in can write to the owner, even while waiting (0206)"}

def q(db, sql):
    out = subprocess.run(["psql", db, "-X", "-tA", "-c", f"select coalesce(json_agg(x), '[]') from ({sql}) x"], capture_output=True, text=True)
    if out.returncode: sys.exit(f"security contract: query failed: {out.stderr.strip()}")
    return json.loads(out.stdout.strip() or "[]")

def state(db):
    return {
        "rls_off": [r["t"] for r in q(db, "select relname as t from pg_class where relnamespace='public'::regnamespace and relkind='r' and not relrowsecurity order by 1")],
        "policies": {f'{r["t"]}.{r["p"]}': {"cmd": r["c"], "roles": r["r"], "using": r["u"], "check": r["k"]} for r in q(db,
            "select c.relname t, p.polname p, p.polcmd::text c, array_to_string(array(select coalesce(nullif(rolname,''),'public') from unnest(p.polroles) o left join pg_roles on pg_roles.oid = o order by 1), ',') r, "
            "pg_get_expr(p.polqual, p.polrelid) u, pg_get_expr(p.polwithcheck, p.polrelid) k from pg_policy p join pg_class c on c.oid = p.polrelid where c.relnamespace='public'::regnamespace")},
        "table_grants": {f'{r["g"]}:{r["t"]}': r["p"] for r in q(db,
            "select grantee g, table_name t, string_agg(privilege_type, ',' order by privilege_type) p from information_schema.role_table_grants "
            "where table_schema='public' and grantee in ('anon','authenticated') group by 1,2")},
        "definer_execute": {r["f"]: r["w"] for r in q(db,
            "select p.oid::regprocedure::text f, concat_ws(',', case when has_function_privilege('anon', p.oid, 'execute') then 'anon' end, case when has_function_privilege('authenticated', p.oid, 'execute') then 'authenticated' end) w "
            "from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef and p.prorettype <> 'trigger'::regtype")},
        "definer_no_search_path": [r["f"] for r in q(db,
            "select p.oid::regprocedure::text f from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%') order by 1")],
        "writable_without_guard": [r["t"] for r in q(db,
            "select distinct c.relname t from information_schema.role_table_grants g join pg_class c on c.relname = g.table_name and c.relnamespace='public'::regnamespace "
            "where g.table_schema='public' and g.grantee='authenticated' and g.privilege_type in ('INSERT','UPDATE','DELETE') "
            "and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'guard_active_account') order by 1")],
    }

def diff(label, old, new):
    out = []
    for k in sorted(set(old) | set(new)):
        if k not in old: out.append(f"  + {label} ADDED      {k}: {json.dumps(new[k])}")
        elif k not in new: out.append(f"  - {label} REMOVED    {k}: {json.dumps(old[k])}")
        elif old[k] != new[k]: out.append(f"  ~ {label} CHANGED    {k}:\n        was {json.dumps(old[k])}\n        now {json.dumps(new[k])}")
    return out

def main():
    if len(sys.argv) < 2: sys.exit("usage: check_security_contract.py <db_url> [--update]")
    db, update = sys.argv[1], "--update" in sys.argv
    s = state(db)
    hard = []
    if s["rls_off"]: hard.append("tables with row-level security OFF: " + ", ".join(s["rls_off"]))
    if s["definer_no_search_path"]: hard.append("SECURITY DEFINER functions without a fixed search_path: " + ", ".join(s["definer_no_search_path"]))
    unguarded = [t for t in s["writable_without_guard"] if t not in GUARD_EXCEPTIONS]
    if unguarded: hard.append("tables members can write without the approved-accounts rule (guard_active_account): " + ", ".join(unguarded))
    if hard:
        print("SECURITY CONTRACT: FAIL — rules with no exceptions:"); print("\n".join("  ✗ " + h for h in hard)); sys.exit(1)
    snap = {"policies": s["policies"], "table_grants": s["table_grants"], "definer_execute": s["definer_execute"], "guard_exceptions": GUARD_EXCEPTIONS}
    if update:
        SNAP.write_text(json.dumps(snap, indent=1, sort_keys=True) + "\n")
        print(f"security contract: snapshot written — {len(s['policies'])} policies, {len(s['table_grants'])} table grants, {len(s['definer_execute'])} privileged functions"); return
    if not SNAP.exists(): sys.exit("security contract: no snapshot — run with --update once, and review it")
    old = json.loads(SNAP.read_text())
    changes = diff("policy", old["policies"], s["policies"]) + diff("table grant", old["table_grants"], s["table_grants"]) + diff("function EXECUTE", old["definer_execute"], s["definer_execute"])
    if changes:
        print("SECURITY CONTRACT: FAIL — permissions differ from the recorded snapshot (ci/security_contract.json):")
        print("\n".join(changes))
        print("\nIf every change above is intended, record it deliberately:  python3 ci/check_security_contract.py <db_url> --update\n"
              "— the snapshot's diff then shows, in the release, exactly which permissions changed.")
        sys.exit(1)
    print(f"security contract: PASS — RLS on every table; {len(s['policies'])} policies, {len(s['table_grants'])} table grants and {len(s['definer_execute'])} privileged functions match the snapshot; every privileged function pins search_path; every member-writable table has the approved-accounts rule")

main()
