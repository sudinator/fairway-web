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
  name: string;
  location: string;
  tees: CourseTee[];
  holes: CourseHole[];
};

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

export const STARTER_COURSES: Course[] = [
  {
    id: "bethpage-black",
    name: "Bethpage State Park — Black Course",
    location: "Farmingdale, NY",
    tees: [
      { name: "Black", rating: 77.5, slope: 148, par: 71 },
      { name: "Blue", rating: 74.6, slope: 140, par: 71 },
      { name: "White", rating: 72.7, slope: 134, par: 71 },
    ],
    holes: standardHoles([4, 4, 4, 5, 4, 4, 3, 4, 4, 4, 4, 4, 4, 3, 4, 4, 3, 5]),
  },
  {
    id: "pebble-beach",
    name: "Pebble Beach Golf Links",
    location: "Pebble Beach, CA",
    tees: [
      { name: "Gold", rating: 74.8, slope: 144, par: 72 },
      { name: "Blue", rating: 72.7, slope: 135, par: 72 },
      { name: "White", rating: 71.0, slope: 130, par: 72 },
    ],
    holes: standardHoles([4, 5, 4, 4, 3, 5, 3, 4, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5]),
  },
  {
    id: "torrey-pines-south",
    name: "Torrey Pines — South Course",
    location: "La Jolla, CA",
    tees: [
      { name: "Black", rating: 78.0, slope: 144, par: 72 },
      { name: "Blue", rating: 74.6, slope: 136, par: 72 },
      { name: "White", rating: 72.1, slope: 129, par: 72 },
    ],
    holes: standardHoles(P72),
  },
  {
    id: "st-andrews-old",
    name: "St Andrews — Old Course",
    location: "St Andrews, Scotland",
    tees: [
      { name: "Championship", rating: 73.1, slope: 132, par: 72 },
      { name: "Medal", rating: 72.0, slope: 128, par: 72 },
    ],
    holes: standardHoles([4, 4, 4, 4, 5, 4, 4, 3, 4, 4, 3, 4, 4, 5, 4, 4, 4, 4]),
  },
  {
    id: "tpc-sawgrass",
    name: "TPC Sawgrass — THE PLAYERS Stadium",
    location: "Ponte Vedra Beach, FL",
    tees: [
      { name: "Tournament", rating: 76.8, slope: 155, par: 72 },
      { name: "Blue", rating: 74.0, slope: 142, par: 72 },
      { name: "White", rating: 71.6, slope: 135, par: 72 },
    ],
    holes: standardHoles([4, 5, 3, 4, 4, 4, 4, 3, 5, 4, 5, 4, 3, 4, 4, 3, 3, 4]),
  },
];

// Build a generic course when a user types one we don't have.
export function buildCustomCourse(name: string, location: string, par: number, rating: number, slope: number): Course {
  // Distribute pars to roughly hit the requested total around a par-72 shape.
  const base = [...P72];
  let total = base.reduce((s, p) => s + p, 0);
  let i = 0;
  while (total > par && i < 18) { if (base[i] > 3) { base[i]--; total--; } i++; }
  i = 0;
  while (total < par && i < 18) { if (base[i] < 5) { base[i]++; total++; } i++; }
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
  return (data || []).filter((f: any) => !f.deleted);
}

// Ensure a course (by id) is linked to a group. Safe to call repeatedly.
export async function linkCourseToGroup(supabase: any, groupId: string, courseId: string, addedBy: string | null): Promise<void> {
  await supabase.from("group_courses").upsert(
    { group_id: groupId, course_id: courseId, added_by: addedBy },
    { onConflict: "group_id,course_id", ignoreDuplicates: true }
  );
}
