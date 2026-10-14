import type { FreshnessDiff } from "@/lib/course-diff";
import type { Course } from "@/lib/courses";

// 206.0 (review findings 1, 6): the browser no longer fetches, compares or records provider data.
// It asks the server (/api/courses/freshness), which does all three with its own key and records
// through a service-role-only function. The result says what actually happened.
export type FreshnessResult = {
  hasChanges: boolean;
  diff: FreshnessDiff | null;
  apiCourse: Course | null;
  status: string; // none | pending | dismissed | applied
  /** ok: compared and saved · incomplete: provider data missing tees/pars/SI/ratings — nothing to
   *  apply · provider_error: provider not reached · not_saved: compared but not recorded · failed: no answer */
  checkState: "ok" | "incomplete" | "provider_error" | "not_saved" | "failed";
  /** The recorded check's revision — what an admin approves (apply_course_freshness). */
  revision: number | null;
  saved: boolean;
  problems?: string[];
  error?: string;
};

const FAILED: FreshnessResult = { hasChanges: false, diff: null, apiCourse: null, status: "none", checkState: "failed", revision: null, saved: false };

// Daily-throttled freshness check for ONE saved library course (the server caches for 24h unless
// `force`). Never throws: a failure returns checkState "failed", so it never blocks starting a round.
export async function checkCourseFreshness(
  _supabase: unknown,
  opts: { courseId: string; externalId?: string; stored?: Course; force?: boolean },
): Promise<FreshnessResult> {
  try {
    const res = await fetch("/api/courses/freshness", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId: opts.courseId, force: !!opts.force }),
    });
    const j = await res.json().catch(() => null);
    if (!j || typeof j !== "object") return FAILED;
    if (!res.ok && !("checkState" in j)) return { ...FAILED, error: (j as any).error || `HTTP ${res.status}` };
    const d = (j.diff || null) as FreshnessDiff | null;
    return {
      hasChanges: !!j.hasChanges, diff: j.hasChanges ? d : null, apiCourse: (j.apiCourse as Course) || null,
      status: j.status || "none", checkState: j.checkState || "failed", revision: j.revision ?? null, saved: !!j.saved,
      problems: j.problems, error: j.error,
    };
  } catch {
    return FAILED;
  }
}
