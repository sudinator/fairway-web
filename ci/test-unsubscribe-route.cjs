// 212.131 — the unsubscribe link: OPENING it (GET) changes nothing; only the page's button or a mail client's RFC 8058
// one-click (POST) turns the emails off. Executes the actual route with a modelled database client; no network.
// Before this release, a GET performed the write — any mail scanner or link preview that fetched the link opted the
// member out. Negative-tested: the old route fails "opening the link writes nothing".
const fs = require('fs'), path = require('path'), Module = require('module'), assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '..'), req = Module.createRequire(repo + '/package.json'), ts = req('typescript');
const writes = [];
const db = { from(table) { return { update(values) { return { eq(col, val) { writes.push({ table, values, col, val }); return Promise.resolve({ error: null }); } }; } }; } };
const original = Module._load;
Module._load = function (id, parent, main) {
  if (id === '@supabase/supabase-js') return { createClient: () => db };
  return original.call(this, id.startsWith('@/') ? path.join(repo, id.slice(2)) : id, parent, main);
};
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, f);
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://screen.test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'modelled-key-not-a-real-secret';
const { GET, POST } = require(repo + '/app/api/round-emails/unsubscribe/route.ts');
const { unsubscribeToken } = require(repo + '/lib/round-email-server.ts');
const member = '19300000-0000-0000-0000-000000000001';
let n = 0; const check = (c, label) => { assert.ok(c, label); n++; };
const link = (kind) => `https://bnn.test/api/round-emails/unsubscribe?u=${member}&t=${unsubscribeToken(member, kind)}${kind === 'club' ? '&k=club' : ''}`;
(async () => {
  // 1. opening the link (a scanner, a preview, a member): a page that asks, no write
  let res = await GET(new Request(link('round')));
  let html = await res.text();
  check(res.status === 200 && html.includes('Turn off round summaries from Birdie Num Num?'), 'GET shows the question');
  check(html.includes('<form method="post">') && html.includes('<button type="submit"'), 'GET offers one button that posts');
  check(!html.includes('are off'), 'GET does not claim anything changed');
  check(writes.length === 0, 'opening the link writes nothing');
  // 2. an invalid link: no page with a button, no write
  res = await GET(new Request(`https://bnn.test/api/round-emails/unsubscribe?u=${member}&t=${'0'.repeat(32)}`));
  check((await res.text()).includes("That link isn't valid") && writes.length === 0, 'an invalid link gets the invalid page and no button');
  // 3. the button: a form post carrying the same fields turns the emails off
  res = await POST(new Request('https://bnn.test/api/round-emails/unsubscribe', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ u: member, t: unsubscribeToken(member, 'round'), k: 'round' }).toString() }));
  check((await res.text()).includes('Round summaries are off'), 'the button turns round summaries off');
  check(writes.length === 1 && writes[0].table === 'profiles' && writes[0].values.round_emails === false && writes[0].val === member, 'one write: round_emails=false for that member only');
  // 4. a mail client's one-click: POST to the link URL with the RFC 8058 body
  res = await POST(new Request(link('club'), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' }));
  check((await res.text()).includes('Club report emails are off'), 'one-click on the club link turns club reports off');
  check(writes.length === 2 && writes[1].values.club_report_emails === false, 'one-click writes club_report_emails=false');
  // 5. a forged post: another member's token, or no token — no write
  res = await POST(new Request('https://bnn.test/api/round-emails/unsubscribe', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ u: member, t: unsubscribeToken('19300000-0000-0000-0000-000000000002', 'round') }).toString() }));
  check((await res.text()).includes("That link isn't valid") && writes.length === 2, "another member's token cannot turn these emails off");
  res = await POST(new Request('https://bnn.test/api/round-emails/unsubscribe', { method: 'POST' }));
  check((await res.text()).includes("That link isn't valid") && writes.length === 2, 'an empty post writes nothing');
  // 6. the sender advertises one-click on every email kind
  const sender = fs.readFileSync(path.join(repo, 'app/api/round-emails/route.ts'), 'utf8');
  check((sender.match(/"List-Unsubscribe-Post": "List-Unsubscribe=One-Click"/g) || []).length === 3 && (sender.match(/"List-Unsubscribe": `<\$\{unsubscribeUrl\}>`/g) || []).length === 3, 'round, club-report and team-round emails all carry List-Unsubscribe and List-Unsubscribe-Post');
  console.log(`unsubscribe route: PASS ${n} FAIL 0 (actual route; GET asks and writes nothing, button and one-click POST write, forged posts refused, sender headers)`);
})().catch((e) => { console.error(e); process.exit(1); });
