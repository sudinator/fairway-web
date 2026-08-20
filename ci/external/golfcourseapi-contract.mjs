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

async function json(url) {
  const wait = GAP_MS - (Date.now() - lastCall);
  if (wait > 0) await sleep(wait);

  for (let attempt = 0; ; attempt++) {
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
      if (attempt >= MAX_RETRIES) {
        monitorProblem(
          `${url} -> HTTP 429 after ${MAX_RETRIES + 1} attempts. The API key is valid — this is a ` +
          `rate limit, not contract drift. Raise GAP_MS or reduce the golden fixture set.`
        );
      }
      // Respect Retry-After when the server sends one; otherwise back off exponentially.
      const ra = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1500 * 2 ** attempt);
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
    return await res.json();
  }
}

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

  if (actualClub !== fixture.club || actualName !== fixture.name || actualLocation !== fixture.location) {
    failures.push(`${fixture.name}: search metadata drifted (club='${actualClub}', name='${actualName}', location='${actualLocation}')`);
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
console.log(`GolfCourseAPI contract OK for ${golden.length} golden course fixtures across ${byQuery.size} searches.`);
