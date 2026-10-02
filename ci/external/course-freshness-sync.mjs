// Scheduled course-freshness check (0166).
//
// The contract monitor fetches each golden course's full detail payload and saves it under
// .course-detail/<provider id>.json. This script diffs each payload against the stored library
// course with the SAME code the app uses when a golfer picks the course in New Round
// (lib/course-normalize.ts + lib/course-diff.ts, compiled here with tsc) and records the result
// through record_course_freshness_system, which shares its body with the app's path. Admins get the
// same notification and the same Courses "Needs review" entry, without anyone having to play.
//
// Exit codes: 0 done (changes or not); 2 the ledger or the build was unavailable. It never spends a
// provider request and never changes a stored course; it only records what differs.
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Everything below is relative to the REPO ROOT, never to the caller's working directory. The
// fresh-database rebuild runs from a scratch directory (cd "$TMP" for the Supabase CLI); from
// there "lib/course-diff.ts" does not exist and `npx tsc` resolves a stranger's package. That is
// how 196.0 failed in CI after passing a local replay that never changed directory.
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
process.chdir(REPO);

const PAYLOAD_DIR = process.env.COURSE_PAYLOAD_DIR ?? ".course-detail";
const SUPABASE_URL = (process.env.BNN_SUPABASE_URL ?? "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
const SERVICE_KEY = process.env.BNN_SUPABASE_SERVICE_KEY;
const OUT = ".freshness-build";

function fail(msg) { console.error(`FRESHNESS SYNC PROBLEM: ${msg}`); process.exit(2); }
if (!SUPABASE_URL || !SERVICE_KEY) fail("BNN_SUPABASE_URL / BNN_SUPABASE_SERVICE_KEY are not set.");

let files = [];
try { files = (await readdir(PAYLOAD_DIR)).filter((f) => f.endsWith(".json")); } catch { files = []; }
if (!files.length) { console.log(`No detail payloads in ${PAYLOAD_DIR}; nothing to diff.`); process.exit(0); }

// Compile the app's own normaliser and diff. Importing the TypeScript directly would need a
// loader; compiling the four pure files takes a second and guarantees the monitor and the app
// run the identical comparison.
// Output lands under OUT/lib/... with rootDir "."; the @/ alias is rewritten by the same patcher
// the screen tests use, so the emitted require("@/lib/courses") resolves.
const TSCONFIG = ".freshness-tsconfig.json";
await writeFile(TSCONFIG, JSON.stringify({
  compilerOptions: { module: "commonjs", target: "es2020", esModuleInterop: true, skipLibCheck: true, moduleResolution: "node",
    baseUrl: ".", paths: { "@/*": ["./*"] }, outDir: OUT, rootDir: "." },
  files: ["lib/course-normalize.ts", "lib/course-diff.ts", "lib/courses.ts", "lib/course-provider-id.ts"],
}));
// The repo's OWN TypeScript, by path. `npx tsc` without node_modules installed resolves a different
// registry package called "tsc" ("This is not the tsc command you are looking for") — which is how
// this step failed in the fresh-database CI job, where nothing had run npm ci. If TypeScript is
// not installed, say exactly that.
const TSC = resolve("node_modules", "typescript", "bin", "tsc");
if (!existsSync(TSC)) { await rm(TSCONFIG, { force: true }); fail(`TypeScript is not installed at ${TSC}; run npm ci first (the workflow job must install dependencies before this step).`); }
const tsc = spawnSync("node", [TSC, "-p", TSCONFIG], { encoding: "utf8" });
await rm(TSCONFIG, { force: true });
if (tsc.status !== 0) fail(`could not compile lib/course-diff.ts: ${(tsc.stdout + tsc.stderr).slice(0, 500)}`);
const patch = spawnSync("node", ["ci/patch_test_aliases.mjs", OUT], { encoding: "utf8" });
if (patch.status !== 0) fail(`alias patch failed: ${(patch.stdout + patch.stderr).slice(0, 300)}`);
const require = createRequire(import.meta.url);
const { normalizeCourse } = require(resolve(OUT, "lib", "course-normalize.js"));
const { buildFreshnessDiff } = require(resolve(OUT, "lib", "course-diff.js"));

const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };
async function rest(path, init) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers, ...init });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

let flagged = 0, unchanged = 0, notInLibrary = 0;
const problems = [];
for (const f of files) {
  const providerId = f.replace(/\.json$/, "");
  try {
    const raw = JSON.parse(await readFile(`${PAYLOAD_DIR}/${f}`, "utf8"));
    const api = normalizeCourse(raw?.course ?? raw);
    const rows = await rest(`favorite_courses?external_id=eq.${encodeURIComponent(providerId)}&deleted=eq.false&select=id,name,data`);
    if (!rows?.length) { notInLibrary++; console.log(`  ${providerId}: not in the library, skipped`); continue; }
    for (const row of rows) {
      const diff = buildFreshnessDiff(row.data ?? { name: row.name, tees: [], holes: [] }, api);
      const n = await rest("rpc/record_course_freshness_system", { method: "POST", body: JSON.stringify({
        p_provider_id: providerId, p_api_data: api, p_diff: diff, p_has_changes: !!diff.hasChanges }) });
      const changes = (diff.tees || []).reduce((s, t) => s + (t.ratingChanged ? 1 : 0) + (t.slopeChanged ? 1 : 0) + (t.yardageChanges?.length || 0), 0);
      if (diff.hasChanges) { flagged++; console.log(`  ${row.name}: ${changes} change(s) -> pending review, admins notified (${n} row(s))`); }
      else { unchanged++; console.log(`  ${row.name}: matches the provider`); }
    }
  } catch (e) {
    problems.push(`${providerId}: ${e?.message ?? e}`);
  }
}
await rm(OUT, { recursive: true, force: true });
console.log(`Freshness sync: ${flagged} flagged, ${unchanged} unchanged, ${notInLibrary} not in library, ${problems.length} problem(s).`);
if (problems.length) { console.error("- " + problems.join("\n- ")); process.exit(2); }
