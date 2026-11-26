// 212.131 — one allocation rule, two languages. The Rounds standings' per-round summary moved into SQL (migration 0239)
// so the server never sends holes; its stroke allocation (club_round_strokes_on_hole) must equal lib/golf allocateStrokes
// after summarizeRound's rounding. This regenerates the allocation table embedded in ci/assert-club-round-standings.sql
// from the TypeScript and fails when the two differ, so a change to either side is caught before the chain runs.
// Also: the two fixture rounds in that assertion, summarised by the TypeScript, must give the literal figures the SQL
// asserts (gross 84 / 36 putts / 0 net birdies / 1 net eagle / streak 1; gross 68 / no putts / 10 / 0 / 18).
// Run with --update to rewrite the table after a deliberate change to allocateStrokes.
const fs = require('fs'), path = require('path'), Module = require('module'), assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '..'), req = Module.createRequire(repo + '/package.json'), ts = req('typescript');
const original = Module._load;
Module._load = function (id, parent, main) { return original.call(this, id.startsWith('@/') ? path.join(repo, id.slice(2)) : id, parent, main); };
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, f);
const { allocateStrokes } = require(repo + '/lib/golf.ts');
const { summarizeRound } = require(repo + '/lib/season-rounds.ts');
const file = path.join(repo, 'ci/assert-club-round-standings.sql');
let sql = fs.readFileSync(file, 'utf8');
const HANDICAPS = ['-3', '0', '7', '10.5', '-10.5', '17', '18', '19', '25', '36', '40'];
const holes = Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, stroke_index: i + 1 }));
// summarizeRound rounds the course handicap first (Math.round: half toward +infinity), then allocates
const row = (ch) => { const a = allocateStrokes(holes, Math.round(Number(ch))); return holes.map((h) => a[h.hole_number]).join(','); };
const table = HANDICAPS.map((ch) => `  array['${ch}',${' '.repeat(Math.max(1, 6 - ch.length))}'${row(ch)}']`).join(',\n');
const block = `-- BEGIN ALLOCATION TABLE\ndo $$\ndeclare rows_ text[][] := array[\n${table}\n]; r int; got text;`;
const start = sql.indexOf('-- BEGIN ALLOCATION TABLE'), end = sql.indexOf(']; r int; got text;');
assert.ok(start > 0 && end > start, 'the allocation table markers are present in ci/assert-club-round-standings.sql');
const current = sql.slice(start, end + ']; r int; got text;'.length);
let n = 0; const check = (c, label) => { assert.ok(c, label); n++; };
if (process.argv.includes('--update')) { sql = sql.slice(0, start) + block + sql.slice(end + ']; r int; got text;'.length); fs.writeFileSync(file, sql); console.log('allocation table rewritten from allocateStrokes'); }
else check(current === block, 'the SQL allocation table equals allocateStrokes for every handicap (run with --update after a deliberate change)');
// the fixture rounds (the same course and scores as the SQL fixture)
const par = (i) => (i % 3 === 0 ? 3 : i % 5 === 0 ? 5 : 4);
const mk = (id, ch, rel, puttsNullOn) => ({ r: { id, user_id: 'u', display_name: 'x', played_at: '2026-06-01', course: 'Oak', course_par: 68, course_handicap: ch },
  hs: Array.from({ length: 18 }, (_, k) => { const i = k + 1; return { round_id: id, hole_number: i, par: par(i), stroke_index: i, strokes: par(i) + rel(i), putts: i === puttsNullOn ? null : 2 }; }) });
const sharer = mk('s', 12, (i) => (i === 1 ? -1 : 1), 0), priv = mk('p', 10, () => 0, 5);
const a = summarizeRound(sharer.r, sharer.hs), b = summarizeRound(priv.r, priv.hs);
check(a && a.par === 68 && a.gross === 84 && a.putts === 36 && a.net_birdies === 0 && a.net_eagles === 1 && a.par_streak === 1, `Sharer's fixture round summarises as the SQL asserts (got ${JSON.stringify(a)})`);
check(b && b.gross === 68 && b.putts === null && b.net_birdies === 10 && b.net_eagles === 0 && b.par_streak === 18, `Private's fixture round summarises as the SQL asserts (got ${JSON.stringify(b)})`);
for (const [literal, expect] of [["(s->>'gross')::int is distinct from 84", 84], ["(s->>'net_birdies')::int is distinct from 10", 10], ["(s->>'par_streak')::int is distinct from 18", 18]]) check(sql.includes(literal), `the SQL still asserts the literal ${expect}`);
check(summarizeRound({ ...sharer.r, id: 'short' }, sharer.hs.slice(0, 15).map((h) => ({ ...h, round_id: 'short' }))) === null, 'a 15-hole round has no summary (the SQL returns none either)');
console.log(`rounds summary parity: PASS ${n} FAIL 0 (SQL allocation table = allocateStrokes for ${HANDICAPS.length} handicaps; fixture summaries agree)`);
