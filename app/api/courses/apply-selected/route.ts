// POST /api/courses/apply-selected — choose which provider changes to apply (209.1).
//   { courseId, revision, selected: string[] }         → apply only those; remember the rest as declined
//   { courseId, revision, selected: [], keep: true }    → keep current data; remember every change as declined
//                                                         (the client then dismisses the review as before)
// The item list is rebuilt HERE from the stored data with lib/course-merge — the same code the review
// screen uses — so the browser can only choose among changes actually on offer. The database function
// re-checks the actor (club admin / system admin), the revision, and that the course wasn't edited since.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createRouteClient } from "@/lib/supabase-route";
import { changeItems, declinedFor, mergeSelected, withoutDeclined } from "@/lib/course-merge";
import type { Course } from "@/lib/courses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(req: Request) {
  const supabase = await createRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  let body: { courseId?: string; revision?: number; selected?: string[]; keep?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request." }, { status: 400 }); }
  if (!body.courseId || !UUID.test(body.courseId) || typeof body.revision !== "number" || !Array.isArray(body.selected)) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Server isn't configured for course updates." }, { status: 503 });
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const [{ data: fc }, { data: cf }, { data: last }] = await Promise.all([
    admin.from("favorite_courses").select("data").eq("id", body.courseId).maybeSingle(),
    admin.from("course_freshness").select("api_data, revision, declined, status, provider_baseline").eq("course_id", body.courseId).maybeSingle(),
    admin.from("course_versions").select("data").eq("course_id", body.courseId).in("source", ["provider_update", "initial", "created"]).order("version", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!fc?.data || !cf?.api_data) return NextResponse.json({ error: "There's no provider update to review for this course." }, { status: 404 });
  if (cf.revision !== body.revision) return NextResponse.json({ error: "The course was re-checked since you reviewed it — review the latest changes." }, { status: 409 });
  const stored = fc.data as Course, api = cf.api_data as Course;
  // 210.3 (review point 1): compare against the provider's OWN data as last applied (same as the review screen).
  const baseline = ((cf as { provider_baseline?: unknown }).provider_baseline as Course | null) ?? ((last?.data as Course) ?? null);
  const items = withoutDeclined(changeItems(stored, api, baseline), (cf.declined as Record<string, unknown>) ?? {});

  if (body.keep) {
    const { error } = await admin.rpc("remember_course_declines_as", { p_actor: user.id, p_course_id: body.courseId, p_declined: declinedFor(items, []) });
    if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 502 });
    return NextResponse.json({ ok: true, declined: items.length });
  }
  let merged: Course;
  try { merged = mergeSelected(stored, api, body.selected, items); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid selection." }, { status: 400 }); }
  const { data, error } = await admin.rpc("apply_course_freshness_selected_as", {
    p_actor: user.id, p_course_id: body.courseId, p_revision: body.revision, p_merged: merged,
    p_applied: body.selected, p_declined: declinedFor(items, body.selected),
  });
  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "40001" ? 409 : error.code === "55000" || error.code === "22023" ? 409 : 502;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json({ ok: true, result: data });
}
