function ok(c: unknown, m: string) { if (!c) throw new Error(m); }
import { courseStatus, type CourseStatusInput } from "./course-status";
const fmt = (iso: string) => iso.slice(5, 10);
const base: CourseStatusInput = { provider_id: "p1", corrected: false, last_verified_at: "2026-10-08T00:00:00Z", last_check_at: "2026-10-08T00:00:00Z", last_check_status: "ok", last_check_note: null,
  freshness_checked_at: "2026-10-08T00:00:00Z", freshness_status: "none", freshness_changes: 0, pending_requests: 0, last_compared_at: "2026-10-08T00:00:00Z", freshness_check_state: "ok",
  decision_reason: null, decided_at: null, current_version: 1, current_version_at: "2026-10-01T00:00:00Z", current_version_source: "initial", current_version_by: null };
const txt = (s: ReturnType<typeof courseStatus>) => s.headline + " | " + s.lines.map((l) => l.text).join(" | ");
// Acceptance: after each of these, the row says what happened and what data remains in use.
{ const s = courseStatus(base, fmt); ok(s.headline === "Up to date" && /matches the provider/.test(txt(s)) && /Last compared with the provider: 10-08/.test(txt(s)), "successful check: up to date, compared 10-08"); }
{ const s = courseStatus({ ...base, last_check_at: "2026-10-14T00:00:00Z", last_check_status: "error", last_check_note: "HTTP 503" }, fmt);
  ok(s.failed && /failed/.test(s.headline) && /stored data retained: HTTP 503/.test(txt(s)) && /Last compared with the provider: 10-08/.test(txt(s)), "failed check: says so, keeps the last genuine comparison date"); }
{ const s = courseStatus({ ...base, last_check_at: "2026-10-14T00:00:00Z", last_check_status: "incomplete", freshness_check_state: "incomplete" }, fmt);
  ok(s.failed && /incomplete/.test(s.headline) && /nothing to apply/.test(txt(s)) && !s.review, "incomplete: a problem, nothing to review"); }
{ const s = courseStatus({ ...base, freshness_status: "applied", current_version: 2, current_version_at: "2026-10-14T00:00:00Z", current_version_source: "provider_update", current_version_by: "Amit Sud" }, fmt);
  ok(/Current data: provider update applied 10-14 by Amit Sud/.test(txt(s)) && /Provider update applied/.test(txt(s)) && s.headline === "Up to date", "approval: names the new current data, who and when"); }
{ const s = courseStatus({ ...base, freshness_status: "dismissed", decided_at: "2026-10-14T00:00:00Z", decision_reason: "provider slope is wrong" }, fmt);
  ok(/kept as-is \(10-14\) — "provider slope is wrong"/.test(txt(s)) && /from before history began/.test(txt(s)), "dismissal: kept, with reason; current data unchanged"); }
// A failure AND a pending review: both shown.
{ const s = courseStatus({ ...base, freshness_status: "pending", freshness_changes: 3, last_check_status: "error", last_check_at: "2026-10-14T00:00:00Z" }, fmt);
  ok(s.review && s.failed && /awaiting review · 3 changes/.test(txt(s)) && /Latest check failed/.test(txt(s)), "failure and pending review coexist"); }
// Never checked; custom course.
ok(courseStatus({ ...base, last_verified_at: null, last_check_at: null, last_check_status: null, last_compared_at: null, freshness_status: null }, fmt).notChecked, "not checked");
ok(courseStatus({ ...base, provider_id: null }, fmt).headline === "Custom course", "custom course");
console.log("course-status tests passed");
