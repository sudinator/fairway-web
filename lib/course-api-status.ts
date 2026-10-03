// The ONE place that turns a course_api_checks row into the sentence the course view shows.
//
// What a golfer needs to know is simple: when did BNN last get an answer from GolfCourseAPI for
// this course? That is last_success_at (0164). A claim or a failed attempt is NOT a refresh and
// must never be shown as one — the ledger carried 17 placeholders for four days that a date-of-last-
// touch display would have presented as "refreshed today".

export type CourseApiStatusRow = {
  provider_id: string;
  last_success_at: string | null;
  last_checked_at: string | null;
  last_status: string | null;
  last_http_status: number | null;
  note: string | null;
};

export type CourseApiFreshness = {
  /** The sentence to show. Always present for a course with a provider id. */
  text: string;
  /** True when the last attempt did not produce an answer (error) or is still a claim. */
  attention: boolean;
  /** ISO timestamp of the last successful answer, if any. */
  verifiedAt: string | null;
};

function fmtDate(iso: string, now: Date): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

// Calendar days in the viewer's local time zone, the same clock fmtDate uses. A rolling 24-hour
// window produced "Oct 1 (today)" on the morning of Oct 2 for a course verified at 22:17 the
// night before: the date and the word disagreed. Counting from local midnight keeps them aligned.
function ago(iso: string, now: Date): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(new Date(iso))) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${days} days ago`;
}

export function describeCourseApiFreshness(row: CourseApiStatusRow | null | undefined, now: Date = new Date()): CourseApiFreshness {
  if (!row || !row.last_success_at) {
    // Never answered. Say whether we have at least tried, and what came back.
    if (row?.last_status === "error") {
      const http = row.last_http_status ? ` (HTTP ${row.last_http_status})` : "";
      return { text: `Not yet verified against GolfCourseAPI — the last attempt ${ago(row.last_checked_at ?? now.toISOString(), now)} failed${http}.`, attention: true, verifiedAt: null };
    }
    return { text: "Not yet verified against GolfCourseAPI.", attention: false, verifiedAt: null };
  }
  const when = `${fmtDate(row.last_success_at, now)} (${ago(row.last_success_at, now)})`;
  if (row.last_status === "error") {
    const http = row.last_http_status ? ` (HTTP ${row.last_http_status})` : "";
    return { text: `Last verified against GolfCourseAPI ${when}. A later attempt failed${http}; the stored data is unchanged.`, attention: true, verifiedAt: row.last_success_at };
  }
  if (row.last_status === "drift") {
    return { text: `Last verified against GolfCourseAPI ${when}. The provider's listing has changed since this course was saved; an admin can review it.`, attention: true, verifiedAt: row.last_success_at };
  }
  return { text: `Last verified against GolfCourseAPI ${when}.`, attention: false, verifiedAt: row.last_success_at };
}

type Client = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

// Fetch status for a set of provider ids. Best-effort: any failure returns an empty map so the
// course view still renders; the sentence then reads "not yet verified", which is the honest
// fallback when the ledger cannot be read.
export async function loadCourseApiStatus(client: Client, providerIds: Array<string | null | undefined>): Promise<Map<string, CourseApiStatusRow>> {
  const ids = Array.from(new Set(providerIds.filter((x): x is string => typeof x === "string" && x.length > 0)));
  const out = new Map<string, CourseApiStatusRow>();
  if (!ids.length) return out;
  try {
    const { data, error } = await client.rpc("course_api_status", { p_provider_ids: ids });
    if (error || !Array.isArray(data)) return out;
    for (const r of data as CourseApiStatusRow[]) if (r?.provider_id) out.set(r.provider_id, r);
  } catch { /* fall through: empty map */ }
  return out;
}
