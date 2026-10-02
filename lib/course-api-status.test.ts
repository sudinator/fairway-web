function assert(v: unknown, msg = "assertion failed"): asserts v { if (!v) throw new Error(msg); }
function assertEqual(a: unknown, b: unknown) { if (a !== b) throw new Error(`expected ${String(a)} === ${String(b)}`); }

import { describeCourseApiFreshness, loadCourseApiStatus, type CourseApiStatusRow } from "./course-api-status";

const now = new Date("2026-10-01T15:00:00Z");
const row = (p: Partial<CourseApiStatusRow>): CourseApiStatusRow => ({ provider_id: "x", last_success_at: null, last_checked_at: null, last_status: null, last_http_status: null, note: null, ...p });

// No row at all.
let r = describeCourseApiFreshness(null, now);
assertEqual(r.text, "Not yet verified against GolfCourseAPI.");
assertEqual(r.attention, false);
assertEqual(r.verifiedAt, null);

// THE CASE THAT WAS WRONG IN PRODUCTION: a claim placeholder with no success. It must not read as
// refreshed, and its claim time must not appear as a verification date.
r = describeCourseApiFreshness(row({ last_status: "claimed", last_checked_at: "2026-09-30T18:27:00Z", note: "claimed, awaiting result" }), now);
assertEqual(r.text, "Not yet verified against GolfCourseAPI.");
assertEqual(r.verifiedAt, null);
assert(!r.text.includes("Sep 30"), "a claim time leaked into the display");

// A failed attempt with no prior success says so, with the provider's status.
r = describeCourseApiFreshness(row({ last_status: "error", last_checked_at: "2026-09-28T18:00:00Z", last_http_status: 429 }), now);
assert(r.text.startsWith("Not yet verified"), r.text);
assert(r.text.includes("2 days ago") && r.text.includes("HTTP 429"), r.text);
assertEqual(r.attention, true);

// Success is dated from last_success_at, never last_checked_at.
r = describeCourseApiFreshness(row({ last_status: "ok", last_success_at: "2026-09-09T12:00:00Z", last_checked_at: "2026-09-09T12:00:00Z", last_http_status: 200 }), now);
assert(r.text.includes("Sep 9") && r.text.includes("22 days ago"), r.text);
assertEqual(r.attention, false);
assertEqual(r.verifiedAt, "2026-09-09T12:00:00Z");

// A failure AFTER a success keeps the success date and flags the failure.
r = describeCourseApiFreshness(row({ last_status: "error", last_success_at: "2026-09-09T12:00:00Z", last_checked_at: "2026-10-01T13:00:00Z", last_http_status: 404 }), now);
assert(r.text.includes("Sep 9") && r.text.includes("failed (HTTP 404)"), r.text);
assert(!r.text.includes("Oct 1"), "a failed attempt was shown as the verification date");
assertEqual(r.attention, true);

// Drift is a successful fetch with changed content.
r = describeCourseApiFreshness(row({ last_status: "drift", last_success_at: "2026-10-01T13:00:00Z", last_checked_at: "2026-10-01T13:00:00Z", last_http_status: 200 }), now);
assert(r.text.includes("today") && r.text.includes("listing has changed"), r.text);
assertEqual(r.attention, true);

// Loader: dedupes, drops blanks, never throws.
(async () => {
  const calls: unknown[] = [];
  const ok = { rpc: async (_n: string, a: Record<string, unknown>) => { calls.push(a); return { data: [row({ provider_id: "a", last_status: "ok" })], error: null }; } };
  const m = await loadCourseApiStatus(ok, ["a", "a", null, undefined, ""]);
  assertEqual((calls[0] as { p_provider_ids: string[] }).p_provider_ids.join(","), "a");
  assertEqual(m.get("a")?.last_status, "ok");
  const empty = await loadCourseApiStatus(ok, [null, ""]);
  assertEqual(empty.size, 0); assertEqual(calls.length, 1);
  const broken = { rpc: async () => { throw new Error("network"); } };
  assertEqual((await loadCourseApiStatus(broken, ["a"])).size, 0);
  const denied = { rpc: async () => ({ data: null, error: { message: "permission denied" } }) };
  assertEqual((await loadCourseApiStatus(denied, ["a"])).size, 0);
  console.log("course-api-status tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
