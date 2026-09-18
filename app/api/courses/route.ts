import { NextResponse } from "next/server";
import { createRouteClient } from "@/lib/supabase-route";
import { BoundedTtlCache } from "@/lib/ttl-cache";
import { normalizeCourseProviderId } from "@/lib/course-provider-id";

const COURSE_TIMEOUT_MS = 8000;
const MIN_QUERY_LEN = 3;
// Tiny in-process cache for identical searches (cuts repeated upstream calls; best-effort, per instance).
const SEARCH_CACHE_MS = 60_000;
const searchCache = new BoundedTtlCache<{ courses: Array<{ id: string; club: string; name: string; location: string }> }>(300, SEARCH_CACHE_MS);

// This runs on the server (not the browser), so the API key stays secret.
// It talks to golfcourseapi.com — a free database of ~30,000 courses.
//
// Two modes:
//   /api/courses?q=bethpage        -> search, returns a list of matches
//   /api/courses?id=5wng1nrq       -> full detail for one course (tees + holes)

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
  let isAdmin = false;
  try {
    const { data: admin } = await supabase.rpc("is_admin");
    isAdmin = !!admin;
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

  // ---- RAW DIAGNOSTIC (admin only) ----
  // Returns the provider's response UNTOUCHED, with its status and headers. Six releases were spent
  // inferring what the provider does from the shape of our failures; one raw response answers every
  // assumption at once — the envelope, the field names, the id type, the location shape, the tees
  // grouping. Admin-gated because it exposes upstream detail, and it never echoes the API key.
  if (new URL(request.url).searchParams.get("raw") === "1") {
    if (!isAdmin) return NextResponse.json({ error: "Admins only." }, { status: 403 });
    const target = id
      ? `${BASE}/courses/${encodeURIComponent(normalizeCourseProviderId(id) || id)}`
      : `${BASE}/search?search_query=${encodeURIComponent((q || "").trim())}`;
    try {
      const res = await fetch(target, { headers, signal: AbortSignal.timeout(COURSE_TIMEOUT_MS) });
      const text = await res.text();
      return NextResponse.json({
        requested: target,
        status: res.status,
        content_type: res.headers.get("content-type"),
        retry_after: res.headers.get("retry-after"),
        body_head: text.slice(0, 4000),
      });
    } catch (e: any) {
      return NextResponse.json({ requested: target, threw: e?.name ?? "Error", message: e?.message ?? String(e) });
    }
  }

  try {
    // ---- Detail mode ----
    if (id) {
      const providerId = normalizeCourseProviderId(id);
      if (!providerId) return NextResponse.json({ error: "Invalid course id." }, { status: 400 });
      const res = await fetch(`${BASE}/courses/${encodeURIComponent(providerId)}`, { headers, signal: AbortSignal.timeout(COURSE_TIMEOUT_MS) });
      if (!res.ok) throw Object.assign(new Error(`Course lookup failed (${res.status})`), { upstream: res.status });
      const data = await res.json();
      const course = normalizeCourse(data.course || data);
      // A successful lookup IS a verification of this course, so record it. The contract monitor
      // skips anything checked within seven days, which means ordinary app traffic REDUCES what the
      // monitor has to do rather than competing with it for the provider's 35 requests a day (0156).
      // Best-effort: a failure here must never break a course lookup the user asked for.
      void supabase
        .rpc("record_course_api_check", {
          p_provider_id: providerId,
          p_status: "ok",
          p_club_name: course?.club ?? null,
          p_course_name: course?.name ?? null,
          p_location: course?.location ?? null,
        })
        .then(({ error }) => { if (error) console.error("record_course_api_check:", error.message); });
      return NextResponse.json({ course });
    }

    // ---- Search mode ----
    const query = (q || "").trim();
    if (query.length) {
      if (query.length < MIN_QUERY_LEN) return NextResponse.json({ courses: [] });
      const cacheKey = query.toLowerCase();
      const hit = searchCache.get(cacheKey);
      if (hit) return NextResponse.json(hit);

      const res = await fetch(`${BASE}/search?search_query=${encodeURIComponent(query)}`, { headers, signal: AbortSignal.timeout(COURSE_TIMEOUT_MS) });
      if (!res.ok) throw Object.assign(new Error(`Search failed (${res.status})`), { upstream: res.status });
      const data = await res.json();
      const courses = (data.courses || []).slice(0, 15).flatMap((c: any) => {
        const providerId = normalizeCourseProviderId(c.id);
        if (!providerId) return [];
        return [{
          id: providerId,
          club: c.club_name,
          name: c.course_name || c.club_name,
          location: courseLocation(c),
        }];
      });
      const payload = { courses };
      searchCache.set(cacheKey, payload);
      return NextResponse.json(payload);
    }

    return NextResponse.json({ courses: [] });
  } catch (e: any) {
    const aborted = e?.name === "TimeoutError" || e?.name === "AbortError";
    console.error("courses upstream failure:", e?.message);
    if (aborted) {
      return NextResponse.json({ error: "Course service timed out." }, { status: 504 });
    }
    // Say WHAT the provider returned. The status was already known here and was being thrown away:
    // a rejected key (401), a rate limit (429) and an outage (503) all surfaced as the same
    // "Course service error", and the app then guessed "likely a stale/wrong id" — which, when all
    // 19 lookups fail at once, is the one explanation that cannot be true.
    const upstream = typeof e?.upstream === "number" ? e.upstream : null;
    const reason =
      upstream === 401 || upstream === 403
        ? "The course provider rejected our API key. Regenerate it at golfcourseapi.com and update GOLF_API_KEY."
        : upstream === 429
          ? "The course provider is rate limiting. Try again shortly."
          : upstream && upstream >= 500
            ? "The course provider is down. Try again later."
            : "Course service error";
    return NextResponse.json(
      { error: reason, upstream_status: upstream },
      { status: upstream === 429 ? 429 : 502 },
    );
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
