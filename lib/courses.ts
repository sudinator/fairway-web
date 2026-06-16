// A small starter set of well-known courses so the app is useful immediately,
// plus helpers to build a standard course when someone enters their own.
// Stroke index follows the common allocation (odd holes front nine, even back).
//
// NOTE: ratings/slopes here are representative published values; players should
// confirm against the physical scorecard, which is the authoritative source.

// Par and stroke index belong to the HOLE (same across all tees).
// Only rating and slope differ by tee — that's what changes the course handicap.
export type CourseTee = { name: string; rating: number; slope: number; par: number };
export type CourseHole = { n: number; par: number; si: number | null };
export type Course = {
  id: string;
  externalId?: string | null; // golfcourseapi canonical course id — anchors dedup
  club?: string;              // facility name (e.g., "Neshanic Valley Golf Course")
  name: string;               // layout/course name (e.g., "Meadow/Lake")
  location: string;
  corrected?: boolean;        // locally corrected (pars/SI/rating verified by a member)
  tees: CourseTee[];
  holes: CourseHole[];
};

// Display label: "Facility — Layout" when we have a distinct facility, else just
// the name. Keeps multi-layout facilities (e.g. Neshanic Valley) unambiguous.
export function courseLabel(c: { club?: string | null; name: string }): string {
  const club = (c.club || "").trim();
  const name = (c.name || "").trim();
  if (club && name && club.toLowerCase() !== name.toLowerCase() && !name.toLowerCase().includes(club.toLowerCase())) {
    return `${club} — ${name}`;
  }
  return name || club;
}

// Standard 18-hole par-72 layout with conventional stroke-index allocation.
function standardHoles(pars: number[]): CourseHole[] {
  // Allocate stroke index 1..18: hardest holes get lowest SI. We use a simple
  // conventional spread (odds on the front, evens on the back) as a sensible default.
  const frontOdd = [1, 3, 5, 7, 9, 11, 13, 15, 17];
  const backEven = [2, 4, 6, 8, 10, 12, 14, 16, 18];
  return pars.map((par, i) => ({
    n: i + 1,
    par,
    si: i < 9 ? frontOdd[i] : backEven[i - 9],
  }));
}

const P72 = [4, 4, 5, 3, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4];

// NOTE: The old STARTER_COURSES list (Bethpage/Pebble/Torrey/St Andrews/Sawgrass)
// was removed. The app never surfaced it — courses come from golfcourseapi search
// and from buildCustomCourse — and its representative pars/ratings were a source
// of subtle handicap errors. Do not re-introduce a hardcoded course list.

// Build a generic course when a user types one we don't have.
export function buildCustomCourse(name: string, location: string, par: number, rating: number, slope: number): Course {
  // Distribute pars to hit the requested total around a par-72 shape. We loop
  // (rather than a single pass) so low pars (par-3/executive courses) and high
  // pars are both reachable, bounded by par 3 and par 5 per hole.
  const base = [...P72];
  let total = base.reduce((s, p) => s + p, 0);
  let guard = 0;
  while (total > par && guard < 18 * 5) {
    let moved = false;
    for (let i = 0; i < 18 && total > par; i++) { if (base[i] > 3) { base[i]--; total--; moved = true; } }
    if (!moved) break; // every hole already at par 3 — can't go lower
    guard++;
  }
  guard = 0;
  while (total < par && guard < 18 * 5) {
    let moved = false;
    for (let i = 0; i < 18 && total < par; i++) { if (base[i] < 5) { base[i]++; total++; moved = true; } }
    if (!moved) break; // every hole already at par 5 — can't go higher
    guard++;
  }
  return {
    id: "custom-" + Date.now().toString(36),
    name,
    location,
    tees: [{ name: "Default", rating, slope, par: total }],
    holes: standardHoles(base),
  };
}

// Group ↔ course is many-to-many via the group_courses link table.
// Returns the favorite_courses rows linked to a given group (one shared record per course).
export async function loadCoursesForGroup(supabase: any, groupId: string): Promise<any[]> {
  const { data: links } = await supabase.from("group_courses").select("course_id").eq("group_id", groupId);
  const ids = (links || []).map((l: any) => l.course_id).filter(Boolean);
  if (!ids.length) return [];

  const { data } = await supabase.from("favorite_courses").select("*").in("id", ids);
  const rows = (data || []).filter((f: any) => !f.deleted);

  // Group-specific course corrections override the global course record inside
  // that group only. This lets one group fix tees/pars/stroke indexes immediately
  // without changing what every other group sees until an app admin approves it.
  const { data: overrides } = await supabase
    .from("group_course_overrides")
    .select("course_id, name, location, data, updated_at")
    .eq("group_id", groupId)
    .in("course_id", ids);
  const byCourse = Object.fromEntries((overrides || []).map((o: any) => [o.course_id, o]));

  return rows.map((f: any) => {
    const o = byCourse[f.id];
    if (!o) return f;
    return {
      ...f,
      name: o.name || f.name,
      location: o.location ?? f.location,
      data: o.data || f.data,
      group_override: true,
      group_override_updated_at: o.updated_at,
    };
  });
}

// Ensure a course (by id) is linked to a group. Safe to call repeatedly.
export async function linkCourseToGroup(supabase: any, groupId: string, courseId: string, addedBy: string | null): Promise<void> {
  await supabase.from("group_courses").upsert(
    { group_id: groupId, course_id: courseId, added_by: addedBy },
    { onConflict: "group_id,course_id", ignoreDuplicates: true }
  );
}
