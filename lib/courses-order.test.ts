// Course library ordering — exercises loadCoursesForGroup itself.
//
// The query had no ORDER BY, so Postgres returned rows in whatever order it found them: not stable
// between loads. Nobody noticed for the life of the app because unordered output looks plausible,
// it just is not the same twice. The player list has sorted by display_name since it was written.
//
// This calls the REAL function through a stubbed Supabase. An earlier version of this test pinned
// a copy of the comparator instead, which passed whether or not loadCoursesForGroup used it —
// a test that cannot fail is decoration.

import { loadCoursesForGroup } from "./courses";

let passed = 0, failed = 0;
function eq<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; }
  failed++;
  console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
}

/** Minimal Supabase stand-in: enough of the builder chain for loadCoursesForGroup. */
function stubSupabase(courses: any[], overrides: any[] = []) {
  return {
    from(table: string) {
      const result =
        table === "group_courses" ? courses.map((c) => ({ course_id: c.id }))
        : table === "favorite_courses" ? courses
        : overrides;
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: () => Promise.resolve({ data: result, error: null }),
        then: (r: any) => Promise.resolve({ data: result, error: null }).then(r),
      };
      return chain;
    },
  };
}

(async () => {
  {
    const rows = await loadCoursesForGroup(stubSupabase([
      { id: "3", name: "Weequahic Golf Course" },
      { id: "1", name: "Berkshire Valley Golf Course" },
      { id: "2", name: "Francis Byrne Golf Course" },
    ]), "g1");
    eq(rows.map((r: any) => r.id), ["1", "2", "3"], "returns courses alphabetically by name");
  }

  {
    const rows = await loadCoursesForGroup(stubSupabase([
      { id: "a", name: "the 19th Hole" },
      { id: "b", name: "Augusta" },
      { id: "c", name: "The 18th" },
    ]), "g1");
    eq(rows.map((r: any) => r.name), ["Augusta", "The 18th", "the 19th Hole"],
       "case-insensitive, matching the player list collation");
  }

  {
    // A group override renames a course. The sort must reflect the NEW name, which only holds if
    // it runs after the override is merged — ordering in SQL alone would fail this.
    const rows = await loadCoursesForGroup(
      stubSupabase(
        [{ id: "a", name: "Zebra Links" }, { id: "b", name: "Apple Ridge" }],
        [{ course_id: "a", name: "Aardvark Links", location: null, data: null, updated_at: "2026-01-01" }],
      ),
      "g1",
    );
    eq(rows.map((r: any) => r.name), ["Aardvark Links", "Apple Ridge"],
       "sorts on the OVERRIDDEN name, not the stored one");
  }

  {
    const rows = await loadCoursesForGroup(stubSupabase([
      { id: "a", name: null }, { id: "b", name: "Alpha" },
    ]), "g1");
    eq(rows.length, 2, "a missing name does not throw");
  }

  console.log(`course ordering: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
