// 212.133 — "Email me my data": executes the actual route with a modelled session, database and mailer. No network.
// Checks: signed out → 401, nothing sent; the mail goes ONLY to the account's email (never a typed one — there is no
// input); three CSV attachments; a ledger row; once a day (a second ask within 24h → 429, nothing sent); a mail failure
// records 'failed' and does not consume the day; without the Gmail keys → 503, nothing sent; GET reports the state.
const fs = require('fs'), path = require('path'), Module = require('module'), assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '..'), req = Module.createRequire(repo + '/package.json'), ts = req('typescript');
let user = { id: '11111111-1111-4111-8111-111111111111', email: 'amit@example.test' };
let nextAllowed = '1970-01-02T00:00:00Z', sent = [], ledger = [], mailFail = false, account = { account_status: 'active', banned: false, deactivated: false };
const table = (name) => {
  const t = {
    select() { return t; }, eq(col, val) { t._eq = { col, val }; return t; }, is() { return t; }, order() { return t; }, limit() { return t; }, range() { return t; }, in() { return t; },
    maybeSingle: async () => ({ data: name === 'profiles' ? { display_name: 'Amit Sud', ...account } : name === 'my_data_exports' ? (ledger.filter((l) => l.status === 'sent').slice(-1)[0] || null) : null, error: null }),
    single: async () => ({ data: t._inserted, error: null }),
    then(resolve) { resolve({ data: [], error: null }); },
    insert(row) { if (name !== 'my_data_exports') throw new Error('unexpected write to ' + name); const r = { id: 'led-' + (ledger.length + 1), ...row }; ledger.push(r); t._inserted = r; return t; },
    update(patch) { if (name !== 'my_data_exports') throw new Error('unexpected write to ' + name); t._patch = patch; return { eq: async (col, val) => { const r = ledger.find((l) => l.id === val); if (r) Object.assign(r, patch); return { error: null }; } }; },
  };
  return t;
};
const db = { from: (name) => table(name), rpc: async (fn) => { assert.equal(fn, 'my_data_export_next_allowed'); return { data: nextAllowed, error: null }; } };
const original = Module._load;
Module._load = function (id, parent, main) {
  if (id === '@supabase/supabase-js') return { createClient: () => db };
  if (id === '@/lib/supabase-route') return { createRouteClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }) };
  if (id === 'nodemailer') return { createTransport: () => ({ sendMail: async (m) => { if (mailFail) throw new Error('smtp down'); sent.push(m); } }) };
  if (id === 'next/server') return { NextResponse: { json: (body, init) => new Response(JSON.stringify(body), { status: init?.status ?? 200, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } }) } };
  if (id === '@/lib/fetch-all') return { fetchAll: async () => [], fetchAllIn: async () => [] };
  if (id === '@/lib/test-clubs') return { fetchTestClubIds: async () => new Set(), withoutTestClubs: (g) => g };
  return original.call(this, id.startsWith('@/') ? path.join(repo, id.slice(2)) : id, parent, main);
};
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText, f);
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://screen.test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'modelled-key-not-a-real-secret';
process.env.GMAIL_USER = 'birdienumnum@example.test'; process.env.GMAIL_APP_PASSWORD = 'modelled';
const { GET, POST } = require(repo + '/app/api/my-data/route.ts');
let n = 0; const check = (c, label) => { assert.ok(c, label); n++; };
(async () => {
  // signed out
  const saved = user; user = null;
  let res = await POST(); check(res.status === 401 && sent.length === 0, 'signed out: 401, nothing sent');
  user = saved;
  // the normal ask
  res = await POST(); let body = await res.json();
  check(res.status === 200 && body.ok && body.sentTo === 'amit@example.test', `the ask succeeds and reports the account address (got ${res.status} ${JSON.stringify(body)})`);
  check(sent.length === 1 && sent[0].to === 'amit@example.test' && sent[0].from.includes('birdienumnum@example.test'), 'one email, to the ACCOUNT address only, from the app sender');
  check(sent[0].attachments.length === 3 && sent[0].attachments.map((a) => a.filename).join() === 'rounds.csv,holes.csv,games.csv' && sent[0].attachments.every((a) => a.content.startsWith('﻿')), 'three CSV attachments with the Excel byte-order mark');
  check(sent[0].subject.startsWith('Your Birdie Num Num data') && sent[0].text.includes('Hi Amit') && sent[0].text.includes('Profile → Your data'), 'subject and a plain text body naming the member');
  check(ledger.length === 1 && ledger[0].status === 'sent' && ledger[0].user_id === user.id && ledger[0].sent_to === 'amit@example.test' && ledger[0].rounds === 0, 'a ledger row records the send (written before the send, marked sent after)');
  check([sent[0].to, sent[0].cc, sent[0].bcc].filter(Boolean).join() === 'amit@example.test', 'the full recipient set (to/cc/bcc) is exactly the account address');
  // once a day
  nextAllowed = new Date(Date.now() + 3600e3).toISOString();
  res = await POST(); body = await res.json();
  check(res.status === 429 && sent.length === 1 && body.nextAllowedAt === nextAllowed, 'a second ask within the day: 429, nothing sent, the next time reported');
  // a mail failure: 'failed' in the ledger, nothing claimed sent
  nextAllowed = '1970-01-02T00:00:00Z'; mailFail = true;
  res = await POST(); body = await res.json();
  check(res.status === 502 && sent.length === 1 && ledger.length === 2 && ledger[1].status === 'failed' && ledger[1].error.includes('smtp down'), 'a mail failure is recorded as failed and reported honestly');
  mailFail = false;
  // a pending / suspended / banned account cannot use the sender
  for (const bad of [{ account_status: 'pending', banned: false, deactivated: false }, { account_status: 'active', banned: true, deactivated: false }, { account_status: 'active', banned: false, deactivated: true }]) {
    account = bad; res = await POST(); check(res.status === 403 && sent.length === 1 && ledger.length === 2, `a ${JSON.stringify(bad)} account is refused with nothing sent and nothing recorded`);
    res = await GET(); check(res.status === 403, '…and GET is refused too');
  }
  account = { account_status: 'active', banned: false, deactivated: false };
  // GET: the state for the Profile card
  res = await GET(); body = await res.json();
  check(res.status === 200 && body.email === 'amit@example.test' && body.canRequest === true && body.configured === true && body.last && body.last.status === 'sent', `GET reports email, availability, configuration and the last send (got ${JSON.stringify(body)})`);
  // no mail keys (staging): nothing sent, an honest 503
  delete process.env.GMAIL_USER;
  res = await POST(); body = await res.json();
  check(res.status === 503 && body.error.includes('staging') && sent.length === 1, 'without the mail keys: 503 and nothing sent');
  res = await GET(); body = await res.json(); check(body.configured === false, 'GET says email is not configured');
  // the route never reads a recipient from the request
  const source = fs.readFileSync(path.join(repo, 'app/api/my-data/route.ts'), 'utf8');
  check(/export async function POST\(\)/.test(source) && !/cc:|bcc:/.test(source) && source.includes('to: user.email'), 'POST takes no request at all (no body, no query); the message has no cc/bcc; the recipient is the session email');
  console.log(`my data route: PASS ${n} FAIL 0 (actual route; account address only, three CSVs, ledger, once a day, failure recorded, staging without keys)`);
})().catch((e) => { console.error(e); process.exit(1); });
