// POST /api/courses/freshness  { courseId, force? }  — 206.0 (review findings 1, 3, 6).
//
// The ONLY way a course freshness check is recorded from the app. The browser names the course;
// the SERVER reads the stored course, fetches the provider with its own key, validates completeness,
// compares, and records through record_course_freshness_checked (service role, member verified in
// the database). The browser never supplies provider content.
//
// The response says what actually happened — provider reached, comparison saved, review pending —
// rather than a blanket "ok" (finding 6).
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createRouteClient } from "@/lib/supabase-route";
import { fetchProviderCourse } from "@/lib/provider-course";
import { buildFreshnessDiff, validateProviderCourse } from "@/lib/course-diff";
import type { Course } from "@/lib/courses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const DAY_MS = 24 * 60 * 60 * 1000;

export type FreshnessOutcome = {
  providerReached: boolean;
  saved: boolean;
  checkState: "ok" | "incomplete" | "provider_error" | "not_saved";
  status: string;            // none | pending | dismissed | applied
  revision: number | null;
  hasChanges: boolean;
  diff: unknown;
  apiCourse: Course | null;
  problems?: string[];
  cached?: boolean;
  error?: string;
};

export async function POST(request: Request) {
  const supabase = await createRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  let body: { courseId?: string; force?: boolean } = {};
  try { body = await request.json(); } catch { /* empty body */ }
  const courseId = String(body.courseId || "");
  if (!/^[0-9a-f-]{36}$/i.test(courseId)) return NextResponse.json({ error: "courseId required." }, { status: 400 });

  // The member must be able to read the course (RLS) — the database re-checks club membership on record.
  const { data: course, error: cErr } = await supabase.from("favorite_courses").select("id, external_id, data").eq("id", courseId).maybeSingle();
  if (cErr) return NextResponse.json({ error: "Couldn't read the course." }, { status: 502 });
  if (!course) return NextResponse.json({ error: "Course not found." }, { status: 404 });
  const stored = (course.data || {}) as Course;
  const providerRaw = String(course.external_id || (stored as any).externalId || "");
  if (!providerRaw) return NextResponse.json({ error: "This course isn't linked to GolfCourseAPI." }, { status: 422 });

  // Daily cache: a recent complete check is returned as recorded (unless an admin forces a re-check).
  const { data: row } = await supabase.from("course_freshness").select("checked_at, api_data, diff, has_changes, status, revision, check_state").eq("course_id", courseId).maybeSingle();
  if (!body.force && row?.checked_at && Date.now() - new Date(row.checked_at).getTime() < DAY_MS) {
    const out: FreshnessOutcome = { providerReached: true, saved: true, checkState: row.check_state === "incomplete" ? "incomplete" : "ok", status: row.status || "none",
      revision: row.revision ?? null, hasChanges: !!row.has_changes, diff: row.diff ?? null, apiCourse: (row.api_data as Course) ?? null, cached: true };
    return NextResponse.json(out);
  }

  // Metered upstream: the same per-user cap as course lookups.
  const { data: isAdmin } = await supabase.rpc("is_admin");
  const { data: rl } = await supabase.rpc("bump_rate_limit", { p_bucket: "courses", p_limit: isAdmin ? 1000 : 120, p_window_seconds: 3600 });
  if (rl && (rl as any).allowed === false) return NextResponse.json({ error: "Too many course lookups in a short time — please try again shortly." }, { status: 429 });

  const provider = await fetchProviderCourse(providerRaw);
  // 207.1: every check leaves an attempt record (as the member — logged as 'app'). 206.0 fetched the
  // provider here without one, so in-app checks were missing from "last check" and the attempt log.
  const logAttempt = async (status: "ok" | "error" | "incomplete", http: number | null, note: string | null, c?: Course) => {
    const { error: lErr } = await supabase.rpc("record_course_api_check", {
      p_provider_id: providerRaw, p_status: status, p_club_name: c?.club ?? null, p_course_name: c?.name ?? null,
      p_location: c?.location ?? null, p_note: note, p_http_status: http,
    });
    if (lErr) console.error("record_course_api_check:", lErr.message);
  };
  if (!provider.ok) {
    await logAttempt("error", provider.status || null, provider.error);
    const out: FreshnessOutcome = { providerReached: false, saved: false, checkState: "provider_error", status: row?.status || "none", revision: row?.revision ?? null, hasChanges: false, diff: null, apiCourse: null, error: provider.error };
    return NextResponse.json(out, { status: 200 });
  }
  const problems = validateProviderCourse(provider.course);
  const complete = problems.length === 0;
  await logAttempt(complete ? "ok" : "incomplete", 200, complete ? null : `incomplete: ${problems.slice(0, 4).join("; ")}`, provider.course);
  const diff = complete ? buildFreshnessDiff(stored, provider.course) : { hasChanges: false, tees: [], incomplete: problems };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "Server isn't configured to record course checks." }, { status: 503 });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: rec, error: rErr } = await admin.rpc("record_course_freshness_checked", {
    p_course_id: courseId, p_actor: user.id, p_api_data: complete ? provider.course : null, p_diff: diff,
    p_has_changes: complete ? (diff as any).hasChanges : false, p_check_state: complete ? "ok" : "incomplete",
    // 0185: the course exactly as it was read; recording is refused if it changed during the check.
    p_base_data: course.data ?? null,
  });
  if (rErr) {
    const out: FreshnessOutcome = { providerReached: true, saved: false, checkState: "not_saved", status: row?.status || "none", revision: row?.revision ?? null,
      hasChanges: complete ? (diff as any).hasChanges : false, diff, apiCourse: complete ? provider.course : null, problems: complete ? undefined : problems,
      error: rErr.code === "42501" ? "Only members of this course's club can check it."
        : rErr.code === "40001" ? "The course was edited while it was being checked — run the check again."
        : "The check ran but couldn't be saved." };
    return NextResponse.json(out, { status: rErr.code === "42501" ? 403 : 200 });
  }
  const r = (rec || {}) as any;
  const out: FreshnessOutcome = { providerReached: true, saved: !!r.saved, checkState: complete ? "ok" : "incomplete", status: r.status || "none",
    revision: r.revision ?? null, hasChanges: !!r.has_changes, diff, apiCourse: complete ? provider.course : null, problems: complete ? undefined : problems };
  return NextResponse.json(out);
}
