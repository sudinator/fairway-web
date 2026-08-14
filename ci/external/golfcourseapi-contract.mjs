import { readFile } from "node:fs/promises";

const key = process.env.GOLF_API_KEY;
if (!key) throw new Error("GOLF_API_KEY GitHub secret is required for the GolfCourseAPI contract monitor");

const golden = JSON.parse(await readFile(new URL("./golfcourseapi-golden.json", import.meta.url), "utf8"));
const BASE = "https://api.golfcourseapi.com/v1";
const headers = { Authorization: `Key ${key}` };
const byQuery = new Map();

async function json(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
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
  console.error("GolfCourseAPI contract drift detected:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log(`GolfCourseAPI contract OK for ${golden.length} golden course fixtures across ${byQuery.size} searches.`);
