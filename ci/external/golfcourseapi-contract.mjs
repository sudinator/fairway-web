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

const golden = JSON.parse(await readFile(new URL("./golfcourseapi-golden.json", import.meta.url), "utf8"));
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

console.log(`Checking ${golden.length} golden fixtures against ${BASE} ...`);
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

if (failures.length) {
  console.error("CONTRACT DRIFT: the GolfCourseAPI response changed.\n- " + failures.join("\n- "));
  process.exit(EXIT_DRIFT);
}
console.log(`GolfCourseAPI contract OK for ${golden.length} golden course fixtures across ${byQuery.size} searches (${elapsed()}, ${calls} requests).`);
