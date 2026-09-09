#!/usr/bin/env python3
"""Guard: privileged migrations must actually enforce authorization (not just document it).

History: v1 only checked for an `-- AUTHORIZATION:` comment. An external review (Aug 2026) noted that
0125's comment said "active member" while its body queried group_members WITHOUT status='active', so a
removed member kept access — and the comment-only guard passed. This version adds mechanical checks that
catch that class. Heuristic (regex over SQL text), tuned to avoid false positives on the canonical
patterns; flags for human review, doesn't try to prove correctness. See SECURITY_CHECKLIST.md.
"""
import re, sys, runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOC_ENFORCE_FROM = 125   # -- AUTHORIZATION: header required from here
MECH_ENFORCE_FROM = 126  # mechanical checks apply to new migrations from here (0125 is superseded by 0126)

def mig_no(p):
    m = re.match(r"^(\d+)_", p.name)
    return int(m.group(1)) if m else None

def strip_sql_comments(s):
    """Remove -- line comments and /* */ blocks.

    The mechanical checks must read CODE, not prose. Without this, a migration whose header merely
    MENTIONS auth.uid() — including one explaining why it legitimately has none — satisfies the
    "contains a real auth predicate" rule on the strength of a comment. That is the exact failure
    this guard exists to catch (0125 documented "active member" while its body did not filter
    status), reproduced inside the guard itself. Found 0151.
    """
    s = re.sub(r"/\*.*?\*/", " ", s, flags=re.S)
    return re.sub(r"--[^\n]*", " ", s)

def norm(s):  # collapse whitespace for pattern matching
    return re.sub(r"\s+", " ", strip_sql_comments(s).lower())

def main() -> int:
    failures = []
    for d in (ROOT / "migrations", ROOT / "supabase" / "migrations"):
        if not d.exists():
            continue
        for f in sorted(d.glob("*.sql")):
            n = mig_no(f)
            if n is None:
                continue
            raw = f.read_text(encoding="utf-8", errors="replace")
            low = norm(raw)               # CODE only — comments stripped (see strip_sql_comments)
            low_raw = re.sub(r"\s+", " ", raw.lower())  # includes comments; rule 1 looks FOR one
            rel = f.relative_to(ROOT)

            is_definer = "security definer" in low
            grants_app = re.search(r"grant\s+execute[^;]*to\s+(authenticated|anon|public)", low)
            privileged = is_definer or bool(grants_app)

            # 1) Documentation header (from 0125)
            if n >= DOC_ENFORCE_FROM and privileged and "-- authorization:" not in low_raw:
                failures.append(f"{rel}: privileged migration missing '-- AUTHORIZATION:' header")

            if n < MECH_ENFORCE_FROM or not privileged:
                continue

            # 2) Deny-by-default: granting to app roles requires revoking from public first
            if grants_app and "revoke all on function" not in low:
                failures.append(f"{rel}: grants EXECUTE to an app role but never REVOKEs from public "
                                f"(deny-by-default)")

            # 3) A SECURITY DEFINER function granted to authenticated must contain a real auth predicate.
            #
            #    EXCEPT a token-scoped public read (the live-share links). There the authorization IS
            #    the unguessable token: the caller is anonymous by design, so auth.uid() is null and
            #    demanding it would make the feature impossible. This exemption is deliberately narrow
            #    — the function must take a p_token argument, reject short/absent tokens, and look the
            #    row up BY that token. Anything else granted to an app role still needs a real
            #    predicate. Added with 0151; 0047/0018 predate MECH_ENFORCE_FROM and are grandfathered.
            token_scoped = (
                "p_token" in low
                and "share_token = p_token" in low
                and re.search(r"length\s*\(\s*p_token\s*\)\s*<", low) is not None
            )
            uses_helper = any(h in low for h in ("is_group_member", "is_group_admin", "is_admin("))
            if is_definer and grants_app and "auth.uid()" not in low and not uses_helper and not token_scoped:
                failures.append(f"{rel}: SECURITY DEFINER granted to an app role but has no auth.uid() "
                                f"check or recognized authorization helper")

            # 3b) Authorization helpers must be called with the RIGHT NUMBER OF ARGUMENTS.
            #     The name-only check above is satisfied by `is_admin(auth.uid())`, which does not
            #     exist — is_admin() takes none and reads auth.uid() itself. Postgres raises at RUNTIME,
            #     so it type-checks, deploys, and then the feature silently does nothing (0152: the
            #     Create live link button). Signatures, from 0136:
            #       is_admin()                                  0 args
            #       is_group_admin(group_uuid, user_uuid)       2 args
            #       is_group_member(group_uuid, user_uuid)      2 args
            HELPER_ARITY = {"is_admin": 0, "is_group_admin": 2, "is_group_member": 2}
            for hname, want in HELPER_ARITY.items():
                # Arguments can themselves be calls — auth.uid() — so allow ONE level of nesting.
                # A pattern that excluded parens silently matched nothing and the check was inert.
                for hm in re.finditer(rf"\b{hname}\s*\(((?:[^()]|\([^()]*\))*)\)", low):
                    inner = hm.group(1).strip()
                    got = 0 if not inner else inner.count(",") + 1
                    # A definition line (create function is_admin(...)) declares, not calls.
                    before = low[max(0, hm.start() - 40):hm.start()]
                    if "function public." in before or "function " in before:
                        continue
                    if got != want:
                        failures.append(f"{rel}: calls {hname}() with {got} argument(s); it takes {want} "
                                        f"— this fails at RUNTIME, not at deploy")

            # 4) Hand-rolled admin/membership check on group_members without status='active'
            #    (the exact 0125 bug). If the migration queries group_members with role='admin' or a
            #    user_id auth match but never filters status and never uses the canonical helpers, flag.
            queries_gm = "group_members" in low
            handrolled_admin = queries_gm and re.search(r"role\s*=\s*'admin'", low)
            handrolled_member = queries_gm and "gm.user_id = auth.uid()" in low
            if (handrolled_admin or handrolled_member) and not uses_helper and "status = 'active'" not in low:
                failures.append(f"{rel}: authorizes via a direct group_members query without "
                                f"status='active' and without is_group_member/is_group_admin "
                                f"(removed members retain a row) — use the canonical helpers")

    if failures:
        print("MIGRATION AUTHORIZATION GUARD FAILED:")
        for x in failures:
            print("  " + x)
        return 1
    print("migration authorization guard: ok")
    return 0

if __name__ == "__main__":
    result = main()
    if result == 0:
        runpy.run_path(str(ROOT / "ci" / "check_authorization_hardening_contract.py"), run_name="__main__")
    sys.exit(result)
