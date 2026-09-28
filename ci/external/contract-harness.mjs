// End-to-end harness for ci/external/golfcourseapi-contract.mjs.
//
// The monitor has failed in production three times for reasons that were all locally observable:
// an ambiguous column, a concurrency hole, and a malformed ledger URL. None were caught because the
// only way to run the script was to spend real provider quota. This runs the WHOLE script — the
// provider half and the ledger half — against stubs, with the real database behind the ledger.
//
//   * The ledger stub answers /rest/v1/rpc/<fn> by executing the actual SQL function via psql, and
//     rejects any other path with PostgREST's 404 PGRST125, which is exactly the failure seen in
//     production. So a URL-construction bug fails here.
//   * The provider stub serves the golden fixtures, and can be told to return 429s, a daily quota,
//     or drifted values.
//
// Usage: node ci/external/contract-harness.mjs
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const PSQL = "/usr/lib/postgresql/16/bin/psql";
const DB = ["-h", "/tmp", "-p", "5433", "-U", "postgres", "-tA"];

function sql(text) {
  const r = spawnSync("su", ["postgres", "-c", `${PSQL} ${DB.join(" ")} -c ${JSON.stringify(text)}`], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

const golden = JSON.parse(await readFile(new URL("./golfcourseapi-golden.json", import.meta.url), "utf8"));

// ── Ledger stub: PostgREST-shaped, real SQL behind it ───────────────────────────────────────────
let claimCalls = 0, recordCalls = 0;
const ledger = createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

  // PostgREST rejects anything that is not a known route with exactly this shape.
  const m = /^\/rest\/v1\/rpc\/(\w+)$/.exec(req.url ?? "");
  if (!m) {
    return send(404, { code: "PGRST125", details: null, hint: null, message: "Invalid path specified in request URL" });
  }
  const fn = m[1];
  const args = body ? JSON.parse(body) : {};
  try {
    if (fn === "claim_course_api_checks") {
      claimCalls++;
      const ids = (args.p_ids ?? []).map((s) => `'${String(s).replace(/'/g, "''")}'`).join(",");
      const out = sql(
        `select coalesce(json_agg(json_build_object('provider_id', out_provider_id)), '[]')::text ` +
        `from public.claim_course_api_checks(array[${ids}]::text[], ${Number(args.p_limit ?? 10)});`
      );
      return send(200, JSON.parse(out || "[]"));
    }
    if (fn === "record_course_api_check") {
      recordCalls++;
      const q = (v) => (v == null ? "null" : `'${String(v).replace(/'/g, "''")}'`);
      // PostgREST runs the request AS the role the key carries. A service key means service_role,
      // with no auth.uid() — which is exactly the case that was broken.
      sql(
        `set local role service_role; ` +
        `select public.record_course_api_check(${q(args.p_provider_id)}, ${q(args.p_status ?? "ok")}, ` +
        `${q(args.p_club_name)}, ${q(args.p_course_name)}, ${q(args.p_location)}, ${q(args.p_note)});`
      );
      return send(200, null);
    }
    return send(404, { code: "PGRST202", message: `Could not find the function public.${fn}` });
  } catch (e) {
    return send(500, { message: String(e.message).slice(0, 300) });
  }
});

// ── Provider stub ───────────────────────────────────────────────────────────────────────────────
const MODE = process.env.HARNESS_MODE ?? "ok";
let providerCalls = 0;
const provider = createServer((req, res) => {
  providerCalls++;
  const send = (code, obj, headers = {}) => {
    res.writeHead(code, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(obj));
  };
  if (MODE === "quota") {
    return send(429, { error: "daily usage limit exceeded" }, { "retry-after": "67453" });
  }
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/search") {
    const q = (url.searchParams.get("search_query") ?? "").toLowerCase();
    const hits = golden.filter((f) => f.query === q);
    return send(200, {
      courses: hits.map((f) => ({
        id: f.id,
        club_name: MODE === "drift" && f.name === "Forest" ? "Totally Different Club" : f.club,
        course_name: f.name,
        location: { city: f.location.split(",")[0].trim(), state: "NJ", country: "United States" },
      })),
    });
  }
  const dm = /^\/courses\/(\w+)$/.exec(url.pathname);
  if (dm) {
    const f = golden.find((g) => g.id === dm[1]);
    if (!f) return send(404, { error: "not found" });
    return send(200, { course: { id: f.id, club_name: f.club, course_name: f.name, tees: { male: [] } } });
  }
  return send(404, { error: "unknown path" });
});

await new Promise((r) => ledger.listen(54321, r));
await new Promise((r) => provider.listen(54322, r));

// Deliberately give the ledger URL a TRAILING SLASH — the shape that produced PGRST125 in
// production. If normalisation regresses, this harness fails the same way.
const env = {
  ...process.env,
  GOLF_API_KEY: "harness",
  GOLF_API_BASE: "http://127.0.0.1:54322",
  BNN_SUPABASE_URL: "http://127.0.0.1:54321/",
  BNN_SUPABASE_SERVICE_KEY: "harness",
  COURSE_CHECK_BUDGET: process.env.COURSE_CHECK_BUDGET ?? "10",
};

if (process.env.HARNESS_SERVE_ONLY === "1") {
  console.log("stubs listening: ledger :54321, provider :54322");
  console.log(`GOLF_API_BASE=${env.GOLF_API_BASE} BNN_SUPABASE_URL=${env.BNN_SUPABASE_URL}`);
  setInterval(() => {}, 1 << 30);
} else {

const run = spawnSync("node", [new URL("./golfcourseapi-contract.mjs", import.meta.url).pathname], { env, encoding: "utf8" });
ledger.close(); provider.close();

console.log("──── script output ────");
console.log((run.stdout + run.stderr).trim());
console.log("──── harness ────");
console.log(`exit=${run.status}  claim_calls=${claimCalls}  record_calls=${recordCalls}  provider_calls=${providerCalls}`);
console.log(`ledger rows now: ${sql("select count(*) from public.course_api_checks;")}`);
process.exit(run.status === 0 ? 0 : 1);
}
