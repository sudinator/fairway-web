#!/usr/bin/env node
// 212.8 — fetch the security contract's state from a LIVE database (production or staging), read-only, with the server
// key: public.security_contract_state() (0214) reads the catalog and returns JSON. Prints the JSON; the comparison is
// ci/check_security_contract.py --state-json <file> — the same check the migrated database passes.
//   node ci/fetch_security_contract_state.mjs production > /tmp/state.json
const target = (process.argv[2] || '').toLowerCase();
if (!['production', 'staging'].includes(target)) { console.error('usage: fetch_security_contract_state.mjs production|staging'); process.exit(2); }
const prefix = target === 'production' ? 'BNN_PRODUCTION' : 'BNN_STAGING';
const url = process.env[`${prefix}_SUPABASE_URL`], serviceKey = process.env[`${prefix}_SUPABASE_SERVICE_ROLE_KEY`];
if (!url || !serviceKey) { console.error(`${prefix}_SUPABASE_URL / _SERVICE_ROLE_KEY are not set`); process.exit(2); }
// the project origin, whether the secret holds the base URL or a copied REST endpoint (as check_live_migration_parity)
const origin = new URL(url).origin;
const r = await fetch(`${origin}/rest/v1/rpc/security_contract_state`, {
  method: 'POST',
  headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
  body: '{}',
});
if (!r.ok) { console.error(`security_contract_state() on ${target} returned HTTP ${r.status}: ${(await r.text()).slice(0, 300)} — is 0214 applied?`); process.exit(1); }
process.stdout.write(JSON.stringify(await r.json()));
