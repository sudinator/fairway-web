# Release Verification — 177.15.260808

## Scope
Corrective release for the TGC Money atomic-post RPC introduced in 0133 / v177.14.

## Runtime defect found by staging
The first credentialed GitHub/Supabase staging run reached the real `save_bet_expense_atomic` RPC and PostgreSQL returned:

`column reference "id" is ambiguous`

Root cause: `RETURNS TABLE(id uuid, created_at timestamptz)` creates PL/pgSQL output variables named `id` and `created_at`, while the 0133 body contained bare table-column references such as `where id = p_game`.

## Fix
Migration `0134_fix_bet_rpc_ambiguous_id.sql` preserves the RPC signature, authorization, validation, transaction semantics and grants, but qualifies collision-prone columns with table aliases (`g.id`, `ge.id`, `gg.id`, `e.id`, `e.created_at`). It does not modify application data or table shape.

The GitHub staging workflow also maps the protected staging URL/anon secret to `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` so the normal Next.js build can prerender against staging before the integration suite runs.

## Verification performed
- Real GitHub `Staging integration` run after the function hotfix: **PASS**.
- The successful run covered real Supabase Auth/RLS/RPC paths, correction retry/review, direct-write denial, Money rollback, parallel RSVP ordering, atomic TGC bet post/re-post rollback, safe group deletion and cleanup.
- Repository static guard suite on the 177.15 tree: **PASS**.
- Workflow fault simulation: **PASS — 50,087 checks, including 50,000 randomized RSVP operations**.
- Course schema contract: **PASS**.
- Staging integration source contract: **PASS**.
- Bet atomicity contract: **PASS**, now requiring the 0134 qualified-column correction.

## Local environment limitation
A fresh `npm ci` in the review container could not complete because the environment's internal npm mirror returned HTTP 404 for `zod-validation-error@4.0.2`. Therefore a second full local TypeScript/unit/Next build was not represented as having run after the documentation/version-only packaging changes. The full GitHub `ci:staging` pipeline had already passed against the corrected RPC in the real staging project.

## Production deployment
For a production database that already has 0133 / v177.14:
1. Apply `0134_fix_bet_rpc_ambiguous_id.sql`.
2. Verify `0134_fix_bet_rpc_ambiguous_id` is recorded in `public.schema_migrations`.
3. Deploy v177.15.260808.

Fresh environments: 0129 remains intentionally skipped/reserved; apply 0130 → 0131 → 0132 → 0133 → 0134.
