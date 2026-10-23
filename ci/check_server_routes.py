#!/usr/bin/env python3
"""212.8 — SERVER ROUTES (owner, Oct 22: the server-key audit). A route that uses the server key bypasses row-level
security, so its own gate is its only protection. Every app/api route using SUPABASE_SERVICE_ROLE_KEY must:
  1. have a recognised gate before using it — a signed-in user (auth.getUser + a 401), the job / webhook secret
     (x-webhook-secret), or a signed link (validUnsubscribe);
  2. pass the SIGNED-IN user as the actor to any acting-on-behalf function (`*_as`, p_actor) — never an id from the
     request body or query.
The 212.8 audit found all nine routes sound; this keeps every future route to the same standard."""
import pathlib, re, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
GATES = [r"auth\.getUser\(\)[\s\S]*?status:\s*401", r"x-webhook-secret", r"validUnsubscribe\("]
bad, n = [], 0
for f in sorted(ROOT.glob("app/api/**/route.ts")):
    src = f.read_text(encoding="utf-8")
    if "SUPABASE_SERVICE_ROLE_KEY" not in src: continue
    n += 1
    rel = str(f.relative_to(ROOT))
    if not any(re.search(g, src) for g in GATES):
        bad.append(f"{rel}: uses the server key with no recognised gate (signed-in user + 401, webhook secret, or signed link)")
    for m in re.finditer(r"p_actor:\s*([^,}\n]+)", src):
        if m.group(1).strip() != "user.id":
            bad.append(f"{rel}: p_actor is `{m.group(1).strip()}` — an acting-on-behalf call must pass the signed-in user (user.id)")
if bad:
    print("SERVER ROUTES: FAIL\n  " + "\n  ".join(bad)); sys.exit(1)
print(f"server routes: PASS ({n} routes use the server key; each is gated; every acting-on-behalf call passes the signed-in user)")
