/**
 * RENDERED CHECK (207.0): the History list. Real CourseHistory, network intercepted: three versions
 * (starting snapshot, provider update 125→132, restore). Newest first, labelled by source, the
 * provider change summarised by the shared comparison, Restore offered only on older versions and
 * only when allowed.
 */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { act } from "react";
import { CourseHistory } from "@/components/course-history";

const course = (slope: number) => ({ id: "c", name: "History CC", location: "", tees: [{ name: "Blue", rating: 70, slope, par: 72, yardages: [] }], holes: [] });
const rows = [
  { version: 3, data: course(125), source: "restore", actor: "a1", reason: "Provider slope was wrong", ref: "version 1", created_at: "2026-10-14T12:00:00Z", name: "History CC" },
  { version: 2, data: course(132), source: "provider_update", actor: "a1", reason: "Provider update approved", ref: "revision 4", created_at: "2026-10-12T12:00:00Z", name: "History CC" },
  { version: 1, data: course(125), source: "initial", actor: null, reason: "Starting snapshot — earlier history unavailable", ref: null, created_at: "2026-10-01T12:00:00Z", name: "History CC" },
];
(globalThis as any).fetch = async (input: any) => {
  const url = String(input?.url ?? input);
  const body = url.includes("/course_versions") ? rows : url.includes("/profiles") ? [{ id: "a1", display_name: "Amit Sud" }] : [];
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 80)); });
(async () => {
  const s = renderScreen(<CourseHistory courseId="c" clubs="Livingston Early Morning Golfers" canRestore />);
  await settle();
  const t = s.el.textContent || "";
  ok(t.indexOf("Restored") < t.indexOf("Provider update applied") && t.indexOf("Provider update applied") < t.indexOf("Starting snapshot"), "newest first, labelled by source");
  ok(t.includes("Amit Sud") && t.includes("in use") && t.includes("Earlier history unavailable"), "who, which is in use, and the starting snapshot's caveat");
  s.click("Provider update applied");
  await settle();
  ok(/125[\s\S]{0,40}132/.test(s.el.textContent || ""), "the provider change is summarised (slope 125 → 132)");
  ok((s.el.textContent || "").includes("Restore this version"), "an older version offers Restore");
  s.click("Restored");
  await settle();
  const inUse = s.el.querySelector('[data-version="3"]')?.textContent || "";
  ok(!inUse.includes("Restore this version"), "the version in use offers no Restore");
  s.unmount();
  const s2 = renderScreen(<CourseHistory courseId="c" clubs="" canRestore={false} />);
  await settle();
  s2.click("Provider update applied");
  await settle();
  ok(!(s2.el.textContent || "").includes("Restore this version"), "no Restore when not allowed");
  s2.unmount();
  report("course history");
})().catch((e) => { console.error(e); process.exit(1); });
