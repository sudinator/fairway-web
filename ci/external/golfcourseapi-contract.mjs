import { readFile } from "node:fs/promises";

// Exit codes are meaningful, because the alert issue this opens tells a human where to look:
//   0  contract OK
//   1  CONTRACT DRIFT  — the API changed. Check provider ids and response shape.
//   2  MONITOR PROBLEM — missing key, rate limit, outage. The API contract is NOT implicated.
// Before this distinction existed, a missing secret produced an alert telling the reader to go
// hunting for a provider change that had never happened.
const EXIT_DRIFT = 1;
const EXIT_MONITOR = 2;

function monitorProblem(msg) {
  console.error(`MONITOR PROBLEM (not contract drift): ${msg}`);
  process.exit(EXIT_MONITOR);
}

const key = process.env.GOLF_API_KEY;
if (!key) {
  monitorProblem(
    "GOLF_API_KEY is not set. This is a repository secret in GitHub -> Settings -> Secrets and " +
    "variables -> Actions. It must be a REPOSITORY secret: this workflow declares no `environment:`, " +
    "so environment-scoped secrets are invisible to it. The same key is set separately in Vercel " +
    "for the app itself; the two are independent copies."
  );
}

const allGolden = JSON.parse(await readFile(new URL("./golfcourseapi-golden.json", import.meta.url), "utf8"));

// ── Daily budget ────────────────────────────────────────────────────────────────────────────────
// The free tier allows 35 requests per DAY. This monitor once checked all 18 fixtures in one run —
// 31 requests, 89% of the budget — which left four for the entire app and meant any manual re-run
// exceeded the limit. On 2026-09-17 that is exactly what happened, and the resulting 429 was
// reported as CONTRACT DRIFT, sending a reader hunting for a provider change that never occurred.
//
// So: ten courses a day, oldest first, skipping anything verified in the last seven days. A full
// pass takes about a week and then idles. The freshness ledger lives in Supabase (0156) and the APP
// writes to it too — a successful /api/courses lookup IS a verification — so ordinary traffic
// reduces this job's work instead of competing with it.
const DAILY_BUDGET = Number(process.env.COURSE_CHECK_BUDGET ?? 10);
const SUPABASE_URL = process.env.BNN_SUPABASE_URL;
const SERVICE_KEY = process.env.BNN_SUPABASE_SERVICE_KEY;

async function rpc(fn, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${fn} -> HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return await res.json();
}

let golden = allGolden;
let skipped = 0;
if (SUPABASE_URL && SERVICE_KEY) {
  try {
    const claimed = await rpc("claim_course_api_checks", {
      p_ids: allGolden.map((f) => f.id),
      p_limit: DAILY_BUDGET,
    });
    const due = new Set((claimed ?? []).map((r) => r.provider_id));
    golden = allGolden.filter((f) => due.has(f.id));
    skipped = allGolden.length - golden.length;
  } catch (e) {
    monitorProblem(
      `could not claim today's batch from Supabase (${e?.message ?? e}). Set BNN_SUPABASE_URL and ` +
      `BNN_SUPABASE_SERVICE_KEY, or set COURSE_CHECK_BUDGET to run without the ledger. Refusing to ` +
      `check all ${allGolden.length} fixtures, which would exceed the provider's 35/day limit.`
    );
  }
} else {
  monitorProblem(
    "BNN_SUPABASE_URL / BNN_SUPABASE_SERVICE_KEY are not set, so the freshness ledger is " +
    "unavailable and this job cannot tell which courses are due. Checking all fixtures would use " +
    "31 of the provider's 35 daily requests. Add the secrets (0156)."
  );
}

if (golden.length === 0) {
  console.log(`Nothing due: all ${allGolden.length} fixtures were verified within the last 7 days.`);
  process.exit(0);
}
const BASE = "https://api.golfcourseapi.com/v1";
const headers = { Authorization: `Key ${key}` };
const byQuery = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The free tier rate-limits. This monitor makes 31 requests (13 searches + 18 detail lookups) and
// originally fired them back-to-back, which returned HTTP 429 about a third of the way through.
// A fixed gap between calls plus backoff on 429 keeps it inside the limit; the whole run takes
// roughly 20 seconds, which is irrelevant for a weekly job.
const GAP_MS = 400;
const MAX_RETRIES = 4;
let lastCall = 0;

// The run prints NOTHING until it finishes, so a slow run and a hung one look identical. With the
// free tier throttling, 31 requests with 1.5/3/6/12s backoffs can take ten minutes, and a reader
// watching a silent step for three minutes reasonably concludes it is stuck. Progress lines and a
// wall-clock budget make the difference legible.
const START = Date.now();
const BUDGET_MS = 6 * 60 * 1000;
const elapsed = () => `${((Date.now() - START) / 1000).toFixed(0)}s`;
let calls = 0;

async function json(url) {
  const wait = GAP_MS - (Date.now() - lastCall);
  if (wait > 0) await sleep(wait);

  calls++;
  const label = url.replace(BASE, "");
  for (let attempt = 0; ; attempt++) {
    if (Date.now() - START > BUDGET_MS) {
      monitorProblem(
        `gave up after ${elapsed()} on request ${calls} (${label}). The provider is throttling hard ` +
        `or is slow; this is not contract drift. Re-run, or raise BUDGET_MS.`
      );
    }
    lastCall = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    let res;
    try {
      res = await fetch(url, { headers, signal: controller.signal });
    } catch (e) {
      if (attempt >= MAX_RETRIES) monitorProblem(`${url} -> ${e?.message ?? e}`);
      await sleep(1000 * 2 ** attempt);
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 429) {
      // A DAILY quota is not a transient rate limit and must not be retried: the provider tells us
      // how long with Retry-After, and it is hours. Treating the two alike burned four backoffs and
      // then reported CONTRACT DRIFT \u2014 sending a reader hunting for a provider change that had not
      // happened. Observed 2026-09-09: 429, retry-after 67453, body {"error":"daily usage limit
      // exceeded"}.
      const raSec = Number(res.headers.get("retry-after"));
      const bodyText = await res.clone().text().catch(() => "");
      const daily = /daily/i.test(bodyText) || (Number.isFinite(raSec) && raSec > 15 * 60);
      if (daily) {
        const hrs = Number.isFinite(raSec) ? ` Resets in about ${(raSec / 3600).toFixed(1)} hours.` : "";
        monitorProblem(
          `${url} -> HTTP 429, DAILY QUOTA EXHAUSTED.${hrs} The key is valid and the contract is ` +
          `not implicated \u2014 nothing to fix, wait for the reset. Body: ${bodyText.trim().slice(0, 200)}`
        );
      }
      if (attempt >= MAX_RETRIES) {
        monitorProblem(
          `${url} -> HTTP 429 after ${MAX_RETRIES + 1} attempts. The API key is valid — this is a ` +
          `rate limit, not contract drift. Raise GAP_MS or reduce the golden fixture set.`
        );
      }
      // Respect Retry-After when the server sends one; otherwise back off exponentially.
      const ra = Number(res.headers.get("retry-after"));
      const back = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1500 * 2 ** attempt;
      console.log(`  [${elapsed()}] 429 on ${label} - backing off ${(back / 1000).toFixed(1)}s (attempt ${attempt + 1})`);
      await sleep(back);
      continue;
    }

    if (res.status === 401 || res.status === 403) {
      monitorProblem(
        `${url} -> HTTP ${res.status}. The key was rejected. Regenerate at golfcourseapi.com and ` +
        `update BOTH the GitHub repository secret and the Vercel environment variable.`
      );
    }

    if (res.status >= 500) {
      if (attempt >= MAX_RETRIES) monitorProblem(`${url} -> HTTP ${res.status} (provider outage)`);
      await sleep(1500 * 2 ** attempt);
      continue;
    }

    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    console.log(`  [${elapsed()}] ${calls}/31 ok ${label}`);
    return await res.json();
  }
}

console.log(`Checking ${golden.length} of ${allGolden.length} fixtures (oldest first, budget ${DAILY_BUDGET}/day); ${skipped} verified within 7 days.`);
const failures = [];
for (const fixture of golden) {
  let courses = byQuery.get(fixture.query);
  if (!courses) {
    const data = await json(`${BASE}/search?search_query=${encodeURIComponent(fixture.query)}`);
    courses = Array.isArray(data?.courses) ? data.courses : [];
    byQuery.set(fixture.query, courses);
  }

  const found = courses.find((c) => String(c?.id ?? "") === fixture.id);
  if (!found) {
    failures.push(`${fixture.name}: expected id ${fixture.id} not returned by search '${fixture.query}'`);
    continue;
  }

  const actualClub = String(found.club_name ?? "");
  const actualName = String(found.course_name ?? found.club_name ?? "");
  const loc = found.location;
  const actualLocation = typeof loc === "string"
    ? loc
    : [loc?.city ?? found.city ?? found.club_city, loc?.state ?? found.state ?? found.club_state, loc?.country ?? found.country ?? found.club_country]
        .filter(Boolean).join(", ");

  // The CLUB name is compared loosely: case-insensitively, with whitespace and apostrophes
  // normalised. What this contract protects is that the course ID still resolves to the same
  // course; the club's display string is cosmetic and the provider edits it. It failed the build
  // once already on "Fiddler'S Elbow" becoming "Fiddler's Elbow" — their title-casing bug, fixed —
  // which changed nothing the app uses. A guard that fails on a capital letter gets ignored, and an
  // ignored guard catches nothing.
  //
  // Course name and location stay STRICT: those identify WHICH course a stored ID points at, and a
  // change there is a real remap worth stopping the build for.
  const loose = (v) => String(v ?? "").toLowerCase().replace(/[\u2018\u2019']/g, "'").replace(/\s+/g, " ").trim();
  // Name WHICH field drifted, and show it escaped with its code points. The previous message
  // printed all three values, which rendered identically to the fixture when the difference was an
  // invisible character — a curly apostrophe, a non-breaking space, a trailing space. A failure you
  // cannot read is a failure you cannot act on.
  const show = (v) =>
    `${JSON.stringify(v)} [${[...String(v)].map((c) => c.codePointAt(0).toString(16)).join(" ")}]`;
  const diffs = [];
  if (loose(actualClub) !== loose(fixture.club)) diffs.push(`club: got ${show(actualClub)} want ${show(fixture.club)}`);
  if (actualName !== fixture.name) diffs.push(`course name: got ${show(actualName)} want ${show(fixture.name)}`);
  if (actualLocation !== fixture.location) diffs.push(`location: got ${show(actualLocation)} want ${show(fixture.location)}`);
  if (diffs.length) {
    failures.push(`${fixture.name}: search metadata drifted\n    ${diffs.join("\n    ")}`);
  }

  try {
    const detail = await json(`${BASE}/courses/${encodeURIComponent(fixture.id)}`);
    const course = detail?.course ?? detail;
    if (!course || String(course.id ?? "") !== fixture.id) {
      failures.push(`${fixture.name}: detail lookup no longer returns id ${fixture.id}`);
    }
    if (!course?.tees || typeof course.tees !== "object") {
      failures.push(`${fixture.name}: detail payload no longer contains tees`);
    }
  } catch (e) {
    failures.push(`${fixture.name}: detail lookup failed (${e?.message ?? e})`);
  }
}

// Record what happened, so tomorrow's run skips these and picks up the next oldest.
if (SUPABASE_URL && SERVICE_KEY) {
  for (const fixture of golden) {
    const failed = failures.find((f) => f.startsWith(`${fixture.name}:`));
    try {
      await rpc("record_course_api_check", {
        p_provider_id: fixture.id,
        p_status: failed ? "drift" : "ok",
        p_club_name: fixture.club,
        p_course_name: fixture.name,
        p_location: fixture.location,
        p_note: failed ? failed.slice(0, 500) : null,
      });
    } catch (e) {
      console.error(`  could not record result for ${fixture.id}: ${e?.message ?? e}`);
    }
  }
}

if (failures.length) {
  // Say what was actually checked. "The GolfCourseAPI response changed" is a claim about the whole
  // API; this job now sees a tenth of it per run, and a monitor that overstates its coverage is one
  // you will misread later.
  console.error(
    `CONTRACT DRIFT in ${failures.length} of the ${golden.length} fixture(s) checked today ` +
    `(${skipped} not due).\n- ` + failures.join("\n- ")
  );
  process.exit(EXIT_DRIFT);
}
console.log(
  `GolfCourseAPI contract OK for the ${golden.length} fixture(s) checked today across ` +
  `${byQuery.size} searches (${elapsed()}, ${calls} requests). ${skipped} not due; ` +
  `${allGolden.length} in the golden set.`
);
