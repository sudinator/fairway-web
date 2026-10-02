// The ONE normalisation of a GolfCourseAPI course payload into the app's Course shape. Used by
// the /api/courses route (what the app plays with) and by the daily monitor's freshness sync
// (what the upstream-change diff compares against). Two copies would eventually disagree on a
// field name and the diff would flag changes that are artefacts of the copy (0166).
export function locationString(loc: any): string {
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
export function courseLocation(c: any): string {
  const fromObj = locationString(c.location);
  if (fromObj) return fromObj;
  const flat = [c.city || c.club_city, c.state || c.club_state, c.country || c.club_country]
    .filter(Boolean).join(", ");
  return flat;
}

// golfcourseapi returns tees grouped by gender, each with rating/slope and a
// holes array (par + handicap). We flatten that into the shape our app uses.
export function normalizeCourse(c: any) {
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
