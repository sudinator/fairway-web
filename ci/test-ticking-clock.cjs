// 212.31 — every unit/screen suite must pass on a clock that moves 1 ms on EVERY read. A test that reads Date.now()
// twice and expects equal values passes on a fast laptop and fails at random on a slow CI runner (GitHub, Oct 23:
// lib/storage-tidy's "exact duplicate" was stamped twice). Runs after `npm test` has built .testout / .testout-screens.
const { execFileSync } = require("child_process"), fs = require("fs"), path = require("path");
const repo = path.resolve(__dirname, ".."), pkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
const suites = [...new Set((pkg.scripts.test.match(/node (\.testout[^ ;]*\.js)/g) || []).map((s) => s.slice(5)))];
if (suites.length < 100) { console.error(`TICKING CLOCK: FAIL — expected the npm test suites, found ${suites.length}`); process.exit(1); }
const hook = path.join(repo, "ci", "ticking-clock-hook.cjs");
const failed = [];
for (const s of suites) {
  const file = path.join(repo, s);
  if (!fs.existsSync(file)) { failed.push(`${s} (not built — run npm test first)`); continue; }
  try { execFileSync(process.execPath, ["-r", hook, file], { cwd: repo, stdio: "pipe", timeout: 120000, env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder" } }); }
  catch (e) { failed.push(`${s}\n      ${String(e.stdout || "").split("\n").filter((l) => /fail/i.test(l) && !/ 0 fail/i.test(l)).slice(0, 3).join("\n      ")}`); }
}
if (failed.length) { console.error("TICKING CLOCK: FAIL — these suites depend on two clock reads being equal:\n  " + failed.join("\n  ")); process.exit(1); }
console.log(`ticking clock: PASS (${suites.length} suites pass with a clock that moves on every read)`);
