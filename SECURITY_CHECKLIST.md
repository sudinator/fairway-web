# Security checklist — mandatory for new attack surface

This has the same status as REFACTOR_VERIFICATION.md: changes that add attack surface do not ship
without walking this list. It exists because UI gating is not enforcement, and because the 0124
freshness RPCs shipped with exactly the misses this list would have caught (see the 176.30 external
review response in DEPLOY_NOTES).

## When this applies
Any change that adds or modifies:
- a `SECURITY DEFINER` function, or any `grant execute ... to authenticated/anon/public`
- an API route (app/api/**)
- an RLS policy
- any code path where a CLIENT-SUPPLIED id (course id, group id, game id, user id...) crosses into
  privileged code (a definer function, a service-role client, an admin capability)

## The questions (answer all, in writing, in the migration header or DEPLOY_NOTES)
1. **Who may call this?** Enforced WHERE? The answer must be a check *inside the function/route*
   (membership/role lookup against the caller's auth.uid()), never "the UI only shows it to admins."
2. **Ownership derived server-side?** Every id the client passes must be resolved to its owning
   row/group by primary key ON THE SERVER, and authorization checked against THAT — never against a
   client-supplied group/owner id. If a parameter exists only because the client conveniently had
   the value in scope, remove the parameter and derive it.
3. **Worst-case token test.** Assume an arbitrary authenticated JWT calls this directly with crafted
   arguments (any UUIDs, any strings, any sizes). What is the worst it can do? Write the answer down.
   If the answer includes touching another group's data or spamming anyone, fix before shipping.
4. **Enums constrained?** Any status/mode/kind column gets a DB CHECK, and the RPC validates input
   as defense in depth.
5. **Errors:** no upstream/provider error bodies or stack details returned to clients; log server-side.
6. **Misconfiguration is loud:** missing secrets/config return 5xx, never a 200 with an error field.

## Mechanical enforcement
`ci/check_migration_authorization.py` (runs in `npm run guards` and `npm run ci`): every migration
numbered >= 0125 that contains `security definer` or grants execute to authenticated/anon/public MUST
carry an `-- AUTHORIZATION:` header line stating who may call it and how that is enforced. The guard
fails the build otherwise. The header is not decoration — writing it forces question 1.

## Definition of done for features (threat-model line)
Any feature adding surface includes one paragraph in DEPLOY_NOTES: who can call the new surface,
with what inputs, and what stops abuse. Refactors get differential proof; features get a stated
threat model.

## Review cadence
After each major arc: one functional cold-eyes pass (does it behave right?) AND one adversarial pass
(what can a hostile JWT do?). They find different bug classes; both are required.

## Dependency currency (added with the Next 16 / React 19 upgrade, Aug 2026)
Framework/major-version drift is a security posture problem (an EOL major stops receiving patches).
Two backstops:
1. **Mechanical (in-repo):** `npm run deps:check` (also runs at the top of `npm run ci`) compares the
   installed major of next/react/react-dom/@supabase/*/typescript against the npm registry and prints
   a loud ALERT when any watched package is a major behind. Non-blocking. TypeScript is deliberately
   held at 5.x (Next rejects TS >= 7) and is exempt from the alert.
2. **PRIMARY, admin-facing (GitHub):** enable **Dependabot** on the repo so the ADMIN is alerted
   directly, without waiting for a build: GitHub → repo Settings → Code security → turn on
   "Dependabot alerts" and "Dependabot security updates". This opens PRs/alerts automatically when a
   dependency has a known CVE or a new version. This is the alert channel that would have surfaced the
   Next SSRF advisory the day it published rather than at external-review time.

Cadence: framework major upgrades are their own dedicated pass with a full manual QA sweep — there is
NO differential test that can prove a framework upgrade preserved behavior (unlike logic extractions).
