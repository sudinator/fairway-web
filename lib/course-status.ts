// Admin → Courses: what one course row says (207.1). Pure; tested against the proposal's acceptance
// scenarios. Answers: what data are we using · is anything wrong · what should I do next. A failure and
// a pending review are BOTH shown — neither hides the other.
export type CourseStatusInput = {
  provider_id: string | null; corrected: boolean;
  last_verified_at: string | null; last_check_at: string | null; last_check_status: string | null; last_check_note: string | null;
  freshness_checked_at: string | null; freshness_status: string | null; freshness_changes: number | null;
  pending_requests: number | null;
  last_compared_at: string | null; freshness_check_state: string | null;
  decision_reason: string | null; decided_at: string | null;
  current_version: number | null; current_version_at: string | null; current_version_source: string | null; current_version_by: string | null;
};
export type CourseStatus = {
  headline: string;
  tone: "action" | "problem" | "quiet" | "ok";
  lines: { text: string; tone?: "action" | "problem" }[];
  review: boolean; failed: boolean; notChecked: boolean;
};

const SOURCE: Record<string, string> = {
  initial: "starting snapshot", created: "course created", manual_edit: "edited by hand", member_correction: "member correction approved",
  provider_update: "provider update applied", restore: "restored from history",
};

export function courseStatus(r: CourseStatusInput, fmt: (iso: string) => string): CourseStatus {
  const lines: CourseStatus["lines"] = [];
  const changes = r.freshness_changes || 0;
  const providerPending = r.freshness_status === "pending" && r.freshness_check_state !== "incomplete" && changes > 0;
  const memberPending = (r.pending_requests || 0) > 0;
  const lastFailed = r.last_check_status === "error";
  const lastIncomplete = r.last_check_status === "incomplete" || r.freshness_check_state === "incomplete";
  const drift = r.last_check_status === "drift";
  const notChecked = !!r.provider_id && !r.last_compared_at && !r.last_verified_at && !r.last_check_at;

  // 1. What data are we using.
  if (r.current_version_at) {
    const src = SOURCE[r.current_version_source || ""] || "changed";
    lines.push({ text: r.current_version_source === "initial"
      ? "Current data: from before history began (earlier changes unrecorded)"
      : `Current data: ${src} ${fmt(r.current_version_at)}${r.current_version_by ? ` by ${r.current_version_by}` : ""}` });
  }
  if (!r.provider_id) {
    lines.push({ text: "Custom course — not linked to GolfCourseAPI, so it is never checked." });
  } else {
    // 2. Last genuine verification, then the latest attempt — kept apart.
    lines.push({ text: r.last_compared_at ? `Last compared with the provider: ${fmt(r.last_compared_at)}` : "Never compared with the provider" });
    if (lastFailed) lines.push({ text: `Latest check failed${r.last_check_at ? ` (${fmt(r.last_check_at)})` : ""} — stored data retained${r.last_check_note ? `: ${r.last_check_note}` : ""}`, tone: "problem" });
    else if (lastIncomplete) lines.push({ text: `Latest check: provider data incomplete${r.last_check_at ? ` (${fmt(r.last_check_at)})` : ""} — stored data retained, nothing to apply`, tone: "problem" });
    else if (drift) lines.push({ text: `Latest check: the provider's course details changed${r.last_check_note ? ` — ${r.last_check_note}` : ""}`, tone: "problem" });
    else if (r.last_check_at) lines.push({ text: `Latest check: ${fmt(r.last_check_at)} — OK` });
    // 3. The review state.
    if (providerPending) lines.push({ text: `Provider changes awaiting review · ${changes} change${changes === 1 ? "" : "s"}`, tone: "action" });
    else if (r.freshness_status === "dismissed") lines.push({ text: `Provider changes kept as-is${r.decided_at ? ` (${fmt(r.decided_at)})` : ""}${r.decision_reason ? ` — "${r.decision_reason}"` : ""}` });
    else if (r.freshness_status === "applied") lines.push({ text: "Provider update applied" });
    else if (r.freshness_status === "none") lines.push({ text: "Stored data matches the provider" });
  }
  if (memberPending) lines.push({ text: `${r.pending_requests} member correction${r.pending_requests === 1 ? "" : "s"} awaiting approval`, tone: "action" });

  const review = providerPending || memberPending;
  const failed = lastFailed || lastIncomplete || drift;
  const headline = review ? (providerPending && memberPending ? "Review required — provider changes and member corrections"
                             : providerPending ? "Provider changes awaiting review" : "Member corrections awaiting approval")
    : lastFailed ? "Latest check failed — stored data retained"
    : lastIncomplete ? "Provider data incomplete — stored data retained"
    : drift ? "Provider course details changed"
    : !r.provider_id ? "Custom course"
    : notChecked ? "Not checked yet"
    : "Up to date";
  const tone = review ? "action" : failed ? "problem" : (notChecked || !r.provider_id) ? "quiet" : "ok";
  return { headline, tone, lines, review, failed, notChecked };
}
