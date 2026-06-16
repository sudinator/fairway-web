import { NextResponse } from "next/server";

// This runs on the server (not the browser), so the API key stays secret.
// It talks to golfcourseapi.com — a free database of ~30,000 courses.
//
// Two modes:
//   /api/courses?q=bethpage        -> search, returns a list of matches
//   /api/courses?id=1234           -> full detail for one course (tees + holes)

const BASE = "https://api.golfcourseapi.com/v1";

function authHeaders() {
  const key = process.env.GOLF_API_KEY;
  if (!key) return null;
  // golfcourseapi expects: Authorization: Key THE_KEY
  return { Authorization: `Key ${key}` };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");
  const id = searchParams.get("id");

  const headers = authHeaders();
  if (!headers) {
    return NextResponse.json(
      { error: "Course search isn't configured yet (missing GOLF_API_KEY)." },
      { status: 500 }
    );
  }

  try {
    // ---- Detail mode ----
    if (id) {
      const res = await fetch(`${BASE}/courses/${encodeURIComponent(id)}`, { headers });
      if (!res.ok) throw new Error(`Course lookup failed (${res.status})`);
      const data = await res.json();
      return NextResponse.json({ course: normalizeCourse(data.course || data) });
    }

    // ---- Search mode ----
    if (q && q.trim().length) {
      const res = await fetch(`${BASE}/search?search_query=${encodeURIComponent(q.trim())}`, { headers });
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      const data = await res.json();
      const courses = (data.courses || []).slice(0, 15).map((c: any) => ({
        id: c.id,
        club: c.club_name,
        name: c.course_name || c.club_name,
        location: courseLocation(c),
      }));
      return NextResponse.json({ courses });
    }

    return NextResponse.json({ courses: [] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Course service error" }, { status: 502 });
  }
}

function locationString(loc: any): string {
  if (!loc) return "";
  if (typeof loc === "string") return loc;
  // golfcourseapi returns location either as a nested object or as flat fields.
  const city = loc.city || loc.town || "";
  const state = loc.state || loc.region || loc.province || "";
  const country = loc.country || "";
  const joined = [city, state, country].filter(Boolean).join(", ");
  return joined || loc.address || "";
}

// Pull a location string from a course payload that may carry it nested under
// `location` OR as flat top-level fields (city/state) depending on the endpoint.
function courseLocation(c: any): string {
  const fromObj = locationString(c.location);
  if (fromObj) return fromObj;
  const flat = [c.city || c.club_city, c.state || c.club_state, c.country || c.club_country]
    .filter(Boolean).join(", ");
  return flat;
}

// golfcourseapi returns tees grouped by gender, each with rating/slope and a
// holes array (par + handicap). We flatten that into the shape our app uses.
function normalizeCourse(c: any) {
  const teeGroups = c.tees || {};
  const allTees: any[] = [];
  let courseHoles: any[] = [];
  ["male", "female"].forEach((g) => {
    (teeGroups[g] || []).forEach((t: any) => {
      const holes = (t.holes || []).map((h: any, i: number) => ({
        n: i + 1,
        par: h.par,
        si: h.handicap ?? null,
      }));
      // Par and stroke index are the same across tees — capture them once.
      if (holes.length > courseHoles.length) courseHoles = holes;
      allTees.push({
        name: t.tee_name + (g === "female" ? " (W)" : ""),
        rating: t.course_rating,
        slope: t.slope_rating,
        par: t.par_total || holes.reduce((s: number, h: any) => s + (h.par || 0), 0),
        yardages: (t.holes || []).map((h: any) => h.yardage ?? null), // per-hole yardage for THIS tee
      });
    });
  });
  return {
    id: c.id,
    externalId: c.id != null ? String(c.id) : null,
    club: c.club_name || "",
    name: c.course_name || c.club_name,
    location: courseLocation(c),
    tees: allTees,
    holes: courseHoles,
  };
}
