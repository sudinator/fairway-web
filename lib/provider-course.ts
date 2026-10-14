// SERVER ONLY. One way to fetch a course's full detail from GolfCourseAPI with the server's key
// (206.0). Used by /api/courses (detail mode) and /api/courses/freshness, so a freshness check is
// always made against exactly what a course lookup would show.
import { normalizeCourseProviderId } from "@/lib/course-provider-id";
import { normalizeCourse } from "@/lib/course-normalize";
import type { Course } from "@/lib/courses";

export const PROVIDER_BASE = "https://api.golfcourseapi.com/v1";
export const PROVIDER_TIMEOUT_MS = 8000;

export function providerHeaders(): Record<string, string> | null {
  const key = process.env.GOLF_API_KEY;
  return key ? { Authorization: `Key ${key}` } : null;
}

export type ProviderResult = { ok: true; course: Course; providerId: string } | { ok: false; status: number; error: string };

export async function fetchProviderCourse(rawId: string): Promise<ProviderResult> {
  const providerId = normalizeCourseProviderId(rawId);
  if (!providerId) return { ok: false, status: 400, error: "Invalid course id." };
  const headers = providerHeaders();
  if (!headers) return { ok: false, status: 503, error: "Course provider isn't configured (missing GOLF_API_KEY)." };
  try {
    const res = await fetch(`${PROVIDER_BASE}/courses/${encodeURIComponent(providerId)}`, { headers, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
    if (!res.ok) return { ok: false, status: res.status, error: `Course lookup failed (${res.status})` };
    const data = await res.json();
    return { ok: true, course: normalizeCourse(data.course || data) as Course, providerId };
  } catch (e) {
    return { ok: false, status: 504, error: e instanceof Error ? e.message : "Course provider unreachable" };
  }
}
