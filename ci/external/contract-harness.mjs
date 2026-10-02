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
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

// HARNESS_DB_URL points at a scratch database with the migrations applied. Default matches the
// Supabase CLI local stack used by ci/test_fresh_db_rebuild.sh.
const DB_URL = process.env.HARNESS_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

function sql(text) {
  const r = spawnSync("psql", [DB_URL, "-X", "-tA", "-v", "ON_ERROR_STOP=1", "-c", text], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

const golden = JSON.parse(await readFile(new URL("./golfcourseapi-golden.json", import.meta.url), "utf8"));

// ── Ledger stub: PostgREST-shaped, real SQL behind it ───────────────────────────────────────────
let claimCalls = 0, recordCalls = 0, releaseCalls = 0, target = null;
const ledger = createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

  // PostgREST table read used by the monitor: the library set.
  if ((req.url ?? "") === "/rest/v1/favorite_courses?deleted=eq.false&external_id=not.is.null&select=id,name,location,external_id,data&order=name") {
    const out = sql(`select coalesce(json_agg(json_build_object('id', id, 'name', name, 'location', location, 'external_id', external_id, 'data', data) order by name), '[]')::text from public.favorite_courses where coalesce(deleted,false) = false and external_id is not null;`);
    return send(200, JSON.parse(out || "[]"));
  }
  // PostgREST table read used by the freshness sync: favorite_courses by external_id.
  const fm = /^\/rest\/v1\/favorite_courses\?external_id=eq\.([\w%]+)&deleted=eq\.false&select=id,name,data$/.exec(req.url ?? "");
  if (fm) {
    const out = sql(`select coalesce(json_agg(json_build_object('id', id, 'name', name, 'data', data)), '[]')::text from public.favorite_courses where external_id = '${decodeURIComponent(fm[1]).replace(/'/g, "''")}' and coalesce(deleted, false) = false;`);
    return send(200, JSON.parse(out || "[]"));
  }
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
      const rows = JSON.parse(out || "[]");
      // drift / detail404 modes act on a course that is actually claimed today, whichever it is.
      target = rows[0]?.provider_id ?? null;
      return send(200, rows);
    }
    if (fn === "record_course_api_check") {
      recordCalls++;
      const q = (v) => (v == null ? "null" : `'${String(v).replace(/'/g, "''")}'`);
      // PostgREST runs the request AS the role the key carries. A service key means service_role,
      // with no auth.uid() — which is exactly the case that was broken.
      if (MODE === "ledgerdown") return send(500, { message: "harness: ledger write refused" });
      const hs = args.p_http_status == null ? "null" : Number(args.p_http_status);
      sql(
        `set local role service_role; ` +
        `select public.record_course_api_check(${q(args.p_provider_id)}, ${q(args.p_status ?? "ok")}, ` +
        `${q(args.p_club_name)}, ${q(args.p_course_name)}, ${q(args.p_location)}, ${q(args.p_note)}, ${hs});`
      );
      return send(200, null);
    }
    if (fn === "record_course_freshness_system") {
      const q = (v) => (v == null ? "null" : `'${String(typeof v === "object" ? JSON.stringify(v) : v).replace(/'/g, "''")}'`);
      const out = sql(`set local role service_role; select public.record_course_freshness_system(${q(args.p_provider_id)}, ${q(args.p_api_data)}::jsonb, ${q(args.p_diff)}::jsonb, ${args.p_has_changes ? "true" : "false"});`);
      return send(200, Number(out.trim().split("\n").pop()));
    }
    if (fn === "release_course_api_claims") {
      releaseCalls++;
      const ids = (args.p_ids ?? []).map((s) => `'${String(s).replace(/'/g, "''")}'`).join(",");
      const q = (v) => (v == null ? "null" : `'${String(v).replace(/'/g, "''")}'`);
      const out = sql(`set local role service_role; select public.release_course_api_claims(array[${ids}]::text[], ${q(args.p_reason)});`);
      return send(200, Number(out.trim().split("\n").pop()));
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
  // Modes: ok | drift | quota (every request) | midquota (quota from the 4th request, so some
  // courses are recorded and the rest released) | keyrejected | detail404 (one id gone) | ledgerdown
  if (MODE === "quota" || (MODE === "midquota" && providerCalls > 3)) {
    return send(429, { error: "daily usage limit exceeded" }, { "retry-after": "67453" });
  }
  if (MODE === "keyrejected") return send(401, { error: "invalid key" });
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/search") {
    const q = (url.searchParams.get("search_query") ?? "").toLowerCase();
    const hits = golden.filter((f) => f.query === q);
    return send(200, {
      courses: hits.map((f) => ({
        id: f.id,
        club_name: f.club,
        course_name: f.name,
        location: { city: f.location.split(",")[0].trim(), state: "NJ", country: "United States" },
      })),
    });
  }
  const dm = /^\/courses\/(\w+)$/.exec(url.pathname);
  if (dm) {
    const f = golden.find((g) => g.id === dm[1]);
    if (!f || (MODE === "detail404" && f.id === target)) return send(404, { error: "not found" });
    if (MODE === "drift" && f.id === target) return send(200, { course: { id: "remapped", club_name: f.club, course_name: f.name, tees: { male: [] } } });
    // One tee with nine holes so the freshness sync has something to compare. In 'freshness' mode
    // the harness seeds a stored course whose hole 1 differs, so exactly one yardage change results.
    const holes = Array.from({ length: 9 }, (_, i) => ({ par: 4, handicap: i + 1, yardage: 350 + i }));
    return send(200, { course: { id: f.id, club_name: f.club, course_name: f.name, tees: { male: [{ tee_name: "Blue", course_rating: 70.1, slope_rating: 125, par_total: 36, holes }] } } });
  }
  return send(404, { error: "unknown path" });
});

// The monitor's set is the LIBRARY (196.1). Seed one library course per golden id so the stub
// provider (which serves the golden ids) has something to answer for. Removed at the end.
const HG = "16670000-0000-0000-0000-000000000001", HU = "16670000-0000-0000-0000-000000000002";
sql(`insert into auth.users(id,email) values ('${HU}','harness-lib@example.com') on conflict (id) do nothing;
     insert into public.profiles(id,display_name) values ('${HU}','Harness Library') on conflict (id) do nothing;
     insert into public.groups(id,name) values ('${HG}','Harness Library Club') on conflict (id) do nothing;
     insert into public.group_members(group_id,user_id,email,role,status) values ('${HG}','${HU}','harness-lib@example.com','admin','active') on conflict do nothing;
     delete from public.favorite_courses where group_id = '${HG}';`);
for (const f of golden) {
  const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
  sql(`insert into public.favorite_courses(group_id,user_id,name,external_id,location,data) values ('${HG}','${HU}',${q(f.name)},${q(f.id)},${q(f.location)},
       jsonb_build_object('name',${q(f.name)},'club',${q(f.club)},'location',${q(f.location)},'externalId',${q(f.id)},'tees','[]'::jsonb,'holes','[]'::jsonb));`);
}
function dropLibrary() {
  sql(`delete from public.course_freshness where course_id in (select id from public.favorite_courses where group_id = '${HG}');
       delete from public.notifications where user_id = '${HU}';
       delete from public.favorite_courses where group_id = '${HG}';
       delete from public.group_members where group_id = '${HG}'; delete from public.groups where id = '${HG}';
       delete from public.profiles where id = '${HU}'; delete from auth.users where id = '${HU}';`);
}

await new Promise((r) => ledger.listen(54611, r));
await new Promise((r) => provider.listen(54612, r));

// Deliberately give the ledger URL a TRAILING SLASH — the shape that produced PGRST125 in
// production. If normalisation regresses, this harness fails the same way.
const env = {
  ...process.env,
  GOLF_API_KEY: "harness",
  GOLF_API_BASE: "http://127.0.0.1:54612",
  BNN_SUPABASE_URL: "http://127.0.0.1:54611/",
  BNN_SUPABASE_SERVICE_KEY: "harness",
  COURSE_CHECK_BUDGET: process.env.COURSE_CHECK_BUDGET ?? "10",
  COURSE_PAYLOAD_DIR: `/tmp/bnn-course-detail-${process.pid}`,
};

if (process.env.HARNESS_SERVE_ONLY === "1") {
  console.log("stubs listening: ledger :54611, provider :54612");
  console.log(`GOLF_API_BASE=${env.GOLF_API_BASE} BNN_SUPABASE_URL=${env.BNN_SUPABASE_URL}`);
  setInterval(() => {}, 1 << 30);
} else {

// The script must be spawned ASYNCHRONOUSLY: the stubs live in this process, and spawnSync blocks
// the event loop, so the child's very first request would wait forever on a server that cannot
// answer. Measured: the previous spawnSync version hung until the 6-minute budget on every mode.
const run = await new Promise((resolve) => {
  const child = spawn("node", [new URL("./golfcourseapi-contract.mjs", import.meta.url).pathname], { env });
  let stdout = "", stderr = "";
  child.stdout.on("data", (d) => { stdout += d; });
  child.stderr.on("data", (d) => { stderr += d; });
  child.on("close", (status) => resolve({ status, stdout, stderr }));
});
let syncRun = null;
if (MODE === "freshness") {
  // Seed a club, an admin, and a stored copy of the FIRST claimed course whose hole 1 is 999 yards.
  // Make the library's stored copy of the first claimed course differ from the provider by one yardage.
  sql(`update public.favorite_courses set data = jsonb_set(data, '{tees}', '[{"name":"Blue","rating":70.1,"slope":125,"par":36,"yardages":[999,351,352,353,354,355,356,357,358]}]'::jsonb) where group_id = '${HG}' and external_id = '${target}';
       delete from public.course_freshness where course_id in (select id from public.favorite_courses where group_id = '${HG}');
       delete from public.notifications where user_id = '${HU}';`);
  syncRun = await new Promise((resolve) => {
    const child = spawn("node", [new URL("./course-freshness-sync.mjs", import.meta.url).pathname], { env });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}
ledger.close(); provider.close();

console.log("──── script output ────");
console.log((run.stdout + run.stderr).trim());
console.log("──── harness ────");
console.log(`exit=${run.status}  claim_calls=${claimCalls}  record_calls=${recordCalls}  release_calls=${releaseCalls}  provider_calls=${providerCalls}`);
console.log(`ledger: ${sql("select coalesce(string_agg(last_status||':'||coalesce(last_http_status::text,'-'), ' ' order by provider_id), '') from public.course_api_checks;")}`);
console.log(`ledger rows now: ${sql("select count(*) from public.course_api_checks;")}`);
if (syncRun) {
  console.log("──── freshness sync ────");
  console.log((syncRun.stdout + syncRun.stderr).trim());
  const status = sql(`select status || ':' || coalesce(jsonb_array_length(diff->'tees'->0->'yardageChanges')::text, '-') from public.course_freshness where course_id = (select id from public.favorite_courses where group_id = '${HG}' and external_id = '${target}');`);
  const notice = sql(`select message from public.notifications where user_id = '${HU}' and type = 'course_change' order by created_at desc limit 1;`);
  console.log(`course_freshness: ${status}  notification: ${notice}`);
  if (syncRun.status !== 0 || status !== "pending:1" || !/GolfCourseAPI now lists different data/.test(notice)) {
    console.error("HARNESS FAIL: scheduled freshness did not flag the seeded change"); process.exit(1);
  }
}
dropLibrary();
const want = process.env.HARNESS_EXPECT_EXIT;
if (want !== undefined && Number(want) !== run.status) { console.error(`HARNESS FAIL: expected exit ${want}, got ${run.status}`); process.exit(1); }
process.exit(want !== undefined ? 0 : (run.status === 0 ? 0 : 1));
}
