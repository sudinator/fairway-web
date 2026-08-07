import { buildFreshnessDiff, type FreshnessDiff } from "@/lib/course-diff";
import type { Course } from "@/lib/courses";

const DAY_MS = 24 * 60 * 60 * 1000;

export type FreshnessResult = {
  hasChanges: boolean;
  diff: FreshnessDiff | null;
  apiCourse: Course | null;
  status: string; // none | pending | dismissed | applied
};

const NONE: FreshnessResult = { hasChanges: false, diff: null, apiCourse: null, status: "none" };

// Daily-throttled upstream freshness check for ONE saved library course. Reads the cached result
// first; only if it's stale (>24h) or absent does it hit the API, diff, and record the result
// (which also flags admins on a newly-detected change). Best-effort: any failure returns NONE, so
// this never blocks starting a round.
export async function checkCourseFreshness(
  supabase: any,
  opts: { courseId: string; externalId: string; stored: Course; groupId: string },
): Promise<FreshnessResult> {
  const { courseId, externalId, stored, groupId } = opts;
  try {
    const { data: row } = await supabase
      .from("course_freshness")
      .select("checked_at, api_data, diff, has_changes, status")
      .eq("course_id", courseId)
      .maybeSingle();

    const cached = row?.checked_at && Date.now() - new Date(row.checked_at).getTime() < DAY_MS;
    if (cached) {
      return { hasChanges: !!row.has_changes, diff: row.diff || null, apiCourse: row.api_data || null, status: row.status || "none" };
    }

    const res = await fetch(`/api/courses?id=${encodeURIComponent(externalId)}`);
    if (!res.ok) return NONE;
    const data = await res.json();
    const apiCourse: Course | null = data.course || null;
    if (!apiCourse) return NONE;

    const diff = buildFreshnessDiff(stored, apiCourse);
    await supabase.rpc("record_course_freshness", {
      p_course_id: courseId, p_group_id: groupId, p_api_data: apiCourse, p_diff: diff, p_has_changes: diff.hasChanges,
    }).then(() => {}, () => {});

    return { hasChanges: diff.hasChanges, diff: diff.hasChanges ? diff : null, apiCourse, status: diff.hasChanges ? "pending" : "none" };
  } catch {
    return NONE;
  }
}
