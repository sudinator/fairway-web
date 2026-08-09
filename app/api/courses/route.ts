import { NextResponse } from "next/server";
import { createRouteClient } from "@/lib/supabase-route";
import { BoundedTtlCache } from "@/lib/ttl-cache";

const COURSE_TIMEOUT_MS = 8000;
const MIN_QUERY_LEN = 3;
// Tiny in-process cache for identical searches (cuts repeated upstream calls; best-effort, per instance).
const SEARCH_CACHE_MS = 60_000;
const searchCache = new BoundedTtlCache<{ courses: Array<{ id: unknown; club: string; name: string; location: string }> }>(300, SEARCH_CACHE_MS);

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

  // Require an authenticated caller so this proxied key can't be consumed anonymously.
  const supabase = await createRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  // Per-user volume cap on this metered upstream proxy. Global admins get headroom for the
  // explicit "Refresh all facilities" maintenance workflow; ordinary interactive use stays capped.
  // Identity is server-derived (auth.uid()) inside the RPC — a client can't limit as someone else.
  try {
    const { data: admin } = await supabase.rpc("is_admin");
    const limit = admin ? 1000 : 120;
    const { data: rl } = await supabase.rpc("bump_rate_limit", { p_bucket: "courses", p_limit: limit, p_window_seconds: 3600 });
    if (rl && (rl as any).allowed === false) {
      return NextResponse.json({ error: "Too many course lookups in a short time — please try again shortly." }, { status: 429 });
    }
  } catch { /* limiter unavailable -> fail open (don't block legitimate use on a limiter hiccup) */ }


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
      if (!/^\d{1,12}$/.test(id)) return NextResponse.json({ error: "Invalid course id." }, { status: 400 });
      const res = await fetch(`${BASE}/courses/${id}`, { headers, signal: AbortSignal.timeout(COURSE_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`Course lookup failed (${res.status})`);
      const data = await res.json();
      return NextResponse.json({ course: normalizeCourse(data.course || data) });
    }

    // ---- Search mode ----
    const query = (q || "").trim();
    if (query.length) {
      if (query.length < MIN_QUERY_LEN) return NextResponse.json({ courses: [] });
      const cacheKey = query.toLowerCase();
      const hit = searchCache.get(cacheKey);
      if (hit) return NextResponse.json(hit);

      const res = await fetch(`${BASE}/search?search_query=${encodeURIComponent(query)}`, { headers, signal: AbortSignal.timeout(COURSE_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      const data = await res.json();
      const courses = (data.courses || []).slice(0, 15).map((c: any) => ({
        id: c.id,
        club: c.club_name,
        name: c.course_name || c.club_name,
        location: courseLocation(c),
      }));
      const payload = { courses };
      searchCache.set(cacheKey, payload);
      return NextResponse.json(payload);
    }

    return NextResponse.json({ courses: [] });
  } catch (e: any) {
    const aborted = e?.name === "TimeoutError" || e?.name === "AbortError";
    console.error("courses upstream failure:", e?.message);
    return NextResponse.json({ error: aborted ? "Course service timed out." : "Course service error" }, { status: aborted ? 504 : 502 });
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
