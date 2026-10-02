import { mkdir, writeFile } from "node:fs/promises";

// Exit codes are meaningful, because the alert issue this opens tells a human where to look:
//   0  contract OK       — every course claimed today was fetched and matched its fixture.
//   1  CONTRACT DRIFT    — the provider ANSWERED (HTTP 200) and the content no longer matches.
//   2  MONITOR PROBLEM   — missing key, rate limit, quota, outage, 404, timeout, or the ledger
//                          could not be written. The API contract is NOT implicated.
//
// THE RULE THAT GOVERNS THIS FILE (0164): every course this run claims gets a recorded outcome
// before the process exits, on EVERY exit path. From 2026-09-28 to 10-01 four runs claimed their
// batch, died mid-flight (process.exit from inside the fetch loop), and left the claim placeholder in
// place — which the ledger then counted as a verification for a week. The next run printed
// "Nothing due" and went green with 17 of 18 courses unverified. So:
//   * a result is recorded for each course IMMEDIATELY after it is checked, with the real HTTP status;
//   * an abort records the course in flight and RELEASES the ones never reached, with the reason;
//   * a failure to record is itself a monitor problem and fails the run — it was silently swallowed.
// WHAT IS CHECKED (196.1): the LIBRARY, not a fixture file. Every non-deleted favorite_courses row
// with a provider id is a course someone chose to play, so that is the set worth re-verifying; a
// course that was looked up once and never saved needs no monitor. The set is read from the
// database at the start of each run, so it grows and shrinks with the library. Each course costs
// ONE request (the detail lookup); the former search step is gone, which halves the spend.
//   ok     the id still resolves to a course payload with tees (metadata differences are noted,
//          not failed: members correct names and the provider edits its casing)
//   drift  the id resolves to a DIFFERENT course, or the payload no longer carries tees
//   error  the provider did not answer with content (4xx/5xx/timeout), recorded with the status
// golfcourseapi-golden.json remains only as the harness's stub data.
const EXIT_DRIFT = 1;
const EXIT_MONITOR = 2;

const key = process.env.GOLF_API_KEY;
let allGolden = []; // filled from the library below; the name is kept so the rest of the file reads unchanged

// ── Daily budget ────────────────────────────────────────────────────────────────────────────────
// The free tier allows 35 requests per DAY, shared with the app. COURSES per day, not requests:
// each course costs up to two provider requests (one search per distinct query, one detail lookup),
// so five courses is about ten requests. Measured: ten courses cost 20 requests, and two runs in a
// day cost 33, which is the whole budget.
// One request per course now, so eight courses a day is eight requests against the 35 shared with
// the app: a 20-course library is re-verified every three days, a 50-course one every week.
const DAILY_BUDGET = Number(process.env.COURSE_CHECK_BUDGET ?? 8);
// Tolerate a trailing slash, and a URL that already carries the REST path. A secret ending in "/"
// produced "https://host//rest/v1/rpc/..." and PostgREST answered 404 PGRST125.
const SUPABASE_URL = (process.env.BNN_SUPABASE_URL ?? "")
  .trim()
  .replace(/\/+$/, "")
  .replace(/\/rest\/v1$/, "");
const SERVICE_KEY = process.env.BNN_SUPABASE_SERVICE_KEY;
const BASE = (process.env.GOLF_API_BASE ?? "https://api.golfcourseapi.com/v1").replace(/\/+$/, "");
export const PAYLOAD_DIR = process.env.COURSE_PAYLOAD_DIR ?? ".course-detail";

const START = Date.now();
const BUDGET_MS = 6 * 60 * 1000;
const elapsed = () => `${((Date.now() - START) / 1000).toFixed(0)}s`;

async function rpc(fn, body) {
  const url = `${SUPABASE_URL}/rest/v1/rpc/${fn}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // Name the path that was tried: a 404 is otherwise indistinguishable between "the function is
    // not deployed" and "the URL is malformed".
    throw new Error(`${fn} -> HTTP ${res.status} at ${url} ${(await res.text()).slice(0, 200)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ── Ledger bookkeeping ──────────────────────────────────────────────────────────────────────────
// `outcomes` is the single source of truth for what this run concluded about each claimed course.
// It is written as each course finishes and drained to the ledger by finish(), which every exit
// path goes through. Nothing calls process.exit directly except finish().
const outcomes = new Map(); // id -> { status: ok|drift|error, note, http }
let claimedIds = [];
let ledgerLive = false;
const recordFailures = [];

async function recordAll() {
  for (const id of claimedIds) {
    const o = outcomes.get(id);
    if (!o) continue; // never reached: released below
    const f = allGolden.find((g) => g.id === id);
    try {
      await rpc("record_course_api_check", {
        p_provider_id: id,
        p_status: o.status,
        p_club_name: f?.club ?? null,
        p_course_name: f?.name ?? null,
        p_location: f?.location ?? null,
        p_note: o.note ? String(o.note).slice(0, 500) : null,
        p_http_status: Number.isInteger(o.http) ? o.http : null,
      });
    } catch (e) {
      recordFailures.push(`${id}: ${e?.message ?? e}`);
    }
  }
  const unreached = claimedIds.filter((id) => !outcomes.has(id));
  if (unreached.length) {
    try {
      const n = await rpc("release_course_api_claims", { p_ids: unreached, p_reason: abortReason ?? "run aborted" });
      console.log(`  released ${n ?? "?"} unreached claim(s): ${unreached.join(", ")}`);
    } catch (e) {
      recordFailures.push(`release ${unreached.join(",")}: ${e?.message ?? e}`);
    }
  }
}

let abortReason = null;
async function finish(code, message) {
  if (ledgerLive) await recordAll();
  if (message) (code === 0 ? console.log : console.error)(message);
  if (claimedIds.length) {
    const rows = claimedIds.map((id) => {
      const o = outcomes.get(id);
      const name = allGolden.find((g) => g.id === id)?.name ?? id;
      return `  ${name.padEnd(30)} ${o ? `${o.status.padEnd(6)} ${o.http ?? "-"}  ${o.note ?? ""}` : "released (not checked)"}`;
    });
    console.log(`Outcomes recorded for ${claimedIds.length} claimed course(s):\n${rows.join("\n")}`);
  }
  if (recordFailures.length) {
    console.error(
      `MONITOR PROBLEM (not contract drift): ${recordFailures.length} ledger write(s) failed. ` +
      `The courses above may still read 'claimed' and will be re-queued after 30 minutes.\n- ` +
      recordFailures.join("\n- ")
    );
    code = Math.max(code, EXIT_MONITOR);
  }
  process.exit(code);
}
async function monitorProblem(msg) {
  abortReason = msg;
  await finish(EXIT_MONITOR, `MONITOR PROBLEM (not contract drift): ${msg}`);
}

// ── Preconditions ───────────────────────────────────────────────────────────────────────────────
if (!key) {
  await monitorProblem(
    "GOLF_API_KEY is not set. It is a GitHub Actions secret (Settings -> Secrets and variables -> " +
    "Actions). The same key is set separately in Vercel for the app; the two are independent copies."
  );
}
if (!SUPABASE_URL || !SERVICE_KEY) {
  await monitorProblem(
    "BNN_SUPABASE_URL / BNN_SUPABASE_SERVICE_KEY are not set, so the freshness ledger is unavailable " +
    "and this job cannot tell which courses exist or are due. The job declares `environment: production` to read them (0156)."
  );
}

// ── The set: every library course with a provider id ────────────────────────────────────────────
async function restGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return await res.json();
}
try {
  const rows = await restGet("favorite_courses?deleted=eq.false&external_id=not.is.null&select=id,name,location,external_id,data&order=name");
  const byId = new Map();
  for (const r of rows ?? []) {
    const id = String(r.external_id ?? "").trim();
    if (!id || byId.has(id)) continue;
    byId.set(id, { id, name: r.name ?? "", club: r.data?.club ?? "", location: r.location ?? r.data?.location ?? "" });
  }
  allGolden = [...byId.values()];
} catch (e) {
  await monitorProblem(`could not read the course library from Supabase (${e?.message ?? e}).`);
}
if (allGolden.length === 0) {
  console.log("The library has no courses with a provider id; nothing to verify.");
  process.exit(0);
}

// ── Claim today's batch ─────────────────────────────────────────────────────────────────────────
let golden = [];
let skipped = 0;
try {
  const claimed = await rpc("claim_course_api_checks", { p_ids: allGolden.map((f) => f.id), p_limit: DAILY_BUDGET });
  claimedIds = (claimed ?? []).map((r) => r.out_provider_id ?? r.provider_id).filter(Boolean);
  ledgerLive = true;
  const due = new Set(claimedIds);
  golden = allGolden.filter((f) => due.has(f.id));
  skipped = allGolden.length - golden.length;
} catch (e) {
  await monitorProblem(
    `could not claim today's batch from Supabase (${e?.message ?? e}). Refusing to check all ` +
    `${allGolden.length} library courses, which would exceed the provider's 35/day limit.`
  );
}

if (golden.length === 0) {
  console.log(`Nothing due: all ${allGolden.length} library courses were successfully verified within the last 7 days.`);
  process.exit(0);
}

// ── Provider requests ───────────────────────────────────────────────────────────────────────────
const headers = { Authorization: `Key ${key}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GAP_MS = 400;
const MAX_RETRIES = 4;
let lastCall = 0;
let calls = 0;
const expectedCalls = golden.length;

// Thrown for a provider answer that is final for THIS course but not for the run (a 404 on one
// detail id, say). Carries the status so the outcome records what the provider actually said.
class ProviderError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function json(url) {
  const wait = GAP_MS - (Date.now() - lastCall);
  if (wait > 0) await sleep(wait);
  calls++;
  const label = url.replace(BASE, "");
  for (let attempt = 0; ; attempt++) {
    if (Date.now() - START > BUDGET_MS) {
      throw Object.assign(new ProviderError(null,
        `gave up after ${elapsed()} on request ${calls} (${label}). The provider is throttling hard or is slow.`), { abort: true });
    }
    lastCall = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    let res;
    try {
      res = await fetch(url, { headers, signal: controller.signal });
    } catch (e) {
      if (attempt >= MAX_RETRIES) throw Object.assign(new ProviderError(null, `${label} -> ${e?.message ?? e}`), { abort: true });
      await sleep(1000 * 2 ** attempt);
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 429) {
      // A DAILY quota is not a transient rate limit: Retry-After is hours and the body says so.
      // Observed 2026-09-09: 429, retry-after 67453, {"error":"daily usage limit exceeded"}.
      const raSec = Number(res.headers.get("retry-after"));
      const bodyText = await res.clone().text().catch(() => "");
      const daily = /daily/i.test(bodyText) || (Number.isFinite(raSec) && raSec > 15 * 60);
      if (daily) {
        const hrs = Number.isFinite(raSec) ? ` resets in about ${(raSec / 3600).toFixed(1)}h;` : "";
        throw Object.assign(new ProviderError(429,
          `HTTP 429 DAILY QUOTA EXHAUSTED;${hrs} key is valid, contract not implicated, nothing to fix — do not re-run today. Body: ${bodyText.trim().slice(0, 120)}`), { abort: true });
      }
      if (attempt >= MAX_RETRIES) {
        throw Object.assign(new ProviderError(429,
          `HTTP 429 after ${MAX_RETRIES + 1} attempts: rate limited, not drift. Raise GAP_MS or lower the budget.`), { abort: true });
      }
      const back = Number.isFinite(raSec) && raSec > 0 ? raSec * 1000 : 1500 * 2 ** attempt;
      console.log(`  [${elapsed()}] 429 on ${label} - backing off ${(back / 1000).toFixed(1)}s (attempt ${attempt + 1})`);
      await sleep(back);
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      throw Object.assign(new ProviderError(res.status,
        `HTTP ${res.status}: the key was rejected. Regenerate at golfcourseapi.com and update BOTH the GitHub secret and the Vercel variable.`), { abort: true });
    }
    if (res.status >= 500) {
      if (attempt >= MAX_RETRIES) throw Object.assign(new ProviderError(res.status, `HTTP ${res.status} provider outage after ${MAX_RETRIES + 1} attempts`), { abort: true });
      await sleep(1500 * 2 ** attempt);
      continue;
    }
    if (!res.ok) {
      // Anything else (404 for a removed id, 400, 410...) is final for this course and is NOT drift:
      // the provider did not answer with content we can compare.
      const bodyText = await res.text().catch(() => "");
      throw new ProviderError(res.status, `HTTP ${res.status} ${label} ${bodyText.trim().slice(0, 120)}`);
    }
    console.log(`  [${elapsed()}] ${calls}/${expectedCalls} ok ${label}`);
    return await res.json();
  }
}

// ── The checks ──────────────────────────────────────────────────────────────────────────────────
console.log(`Checking ${golden.length} of ${allGolden.length} library courses (least recently attempted first, budget ${DAILY_BUDGET}/day); ${skipped} not due.`);
const loose = (v) => String(v ?? "").toLowerCase().replace(/[\u2018\u2019']/g, "'").replace(/\s+/g, " ").trim();
const providerLocation = (c) => {
  const loc = c?.location;
  return typeof loc === "string" ? loc
    : [loc?.city ?? c?.city ?? c?.club_city, loc?.state ?? c?.state ?? c?.club_state, loc?.country ?? c?.country ?? c?.club_country].filter(Boolean).join(", ");
};

for (const fixture of golden) {
  try {
    const detail = await json(`${BASE}/courses/${encodeURIComponent(fixture.id)}`);
    const course = detail?.course ?? detail;
    // Keep the payload for course-freshness-sync.mjs, which diffs it against the stored library
    // course. Same request, second use: no extra provider traffic (0166).
    try {
      await mkdir(PAYLOAD_DIR, { recursive: true });
      await writeFile(`${PAYLOAD_DIR}/${fixture.id}.json`, JSON.stringify(course));
    } catch (e) { console.error(`  could not save payload for ${fixture.id}: ${e?.message ?? e}`); }

    const drift = [];
    if (!course || String(course.id ?? "") !== fixture.id) drift.push(`detail lookup returned id ${course?.id ?? "none"}, not ${fixture.id}`);
    if (!course?.tees || typeof course.tees !== "object") drift.push("detail payload no longer contains tees");
    // Metadata is INFORMATION, not a failure: a member may have corrected the stored name, and
    // the provider edits its title-casing. Rating/slope/yardage changes are the freshness sync's job.
    const info = [];
    const pClub = String(course?.club_name ?? ""), pName = String(course?.course_name ?? course?.club_name ?? ""), pLoc = providerLocation(course);
    if (fixture.club && loose(pClub) !== loose(fixture.club)) info.push(`club "${pClub}" vs stored "${fixture.club}"`);
    if (fixture.name && loose(pName) !== loose(fixture.name)) info.push(`name "${pName}" vs stored "${fixture.name}"`);
    if (fixture.location && loose(pLoc) !== loose(fixture.location)) info.push(`location "${pLoc}" vs stored "${fixture.location}"`);
    // Record what the provider says now, so the ledger carries current names.
    fixture.club = pClub || fixture.club; fixture.name = pName || fixture.name; fixture.location = pLoc || fixture.location;

    outcomes.set(fixture.id, drift.length
      ? { status: "drift", http: 200, note: drift.join("; ") }
      : { status: "ok", http: 200, note: info.length ? `metadata differs: ${info.join("; ")}` : null });
  } catch (e) {
    if (e instanceof ProviderError) {
      outcomes.set(fixture.id, { status: "error", http: e.status, note: e.message });
      if (e.abort) { await monitorProblem(`${fixture.name}: ${e.message}`); }
      continue;
    }
    outcomes.set(fixture.id, { status: "error", http: null, note: `unexpected: ${e?.message ?? e}` });
  }
}

// ── Verdict ─────────────────────────────────────────────────────────────────────────────────────
const drifted = golden.filter((f) => outcomes.get(f.id)?.status === "drift");
const errored = golden.filter((f) => outcomes.get(f.id)?.status === "error");
if (drifted.length) {
  await finish(EXIT_DRIFT,
    `CONTRACT DRIFT in ${drifted.length} of the ${golden.length} library course(s) checked today (${skipped} not due).\n- ` +
    drifted.map((f) => `${f.name}: ${outcomes.get(f.id).note}`).join("\n- "));
}
if (errored.length) {
  await monitorProblem(
    `${errored.length} of ${golden.length} course(s) could not be fetched. The provider did not answer with ` +
    `content, so this is not drift; it is recorded as 'error' and will be retried.\n- ` +
    errored.map((f) => `${f.name}: ${outcomes.get(f.id).note}`).join("\n- "));
}
await finish(0,
  `GolfCourseAPI OK for the ${golden.length} library course(s) checked today ` +
  `(${elapsed()}, ${calls} requests). ${skipped} not due; ${allGolden.length} in the library.`);
