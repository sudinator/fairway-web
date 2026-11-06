"use client";
import React, { useEffect, useMemo, useState } from "react";
import { C } from "@/lib/golf";
import { clubEngagementPeriod, type ClubEngagement as Engagement } from "@/lib/club-engagement";
import { btn, Eyebrow } from "@/components/ui";
export function ClubEngagement({ groupId, now, refreshKey, compact = false, onDetails }: { groupId: string; now: number; refreshKey?: unknown; compact?: boolean; onDetails?: () => void }) {
  const period = useMemo(() => clubEngagementPeriod(now), [now]);
  const [data, setData] = useState<{ groupId: string; periodKey: string; value: Engagement } | null>(null);
  const [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(true), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true; const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), 20_000); setLoading(true); setError(null);
    void (async () => {
      try {
        const response = await fetch(`/api/club-engagement?group_id=${encodeURIComponent(groupId)}`, { signal: controller.signal, cache: "no-store", credentials: "same-origin" });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error || "Couldn't load club engagement.");
        if (!body?.period?.key || ![body.rounds, body.members, body.totalMembers, body.courses, body.games, body.missingCourseRounds, body.standaloneRounds].every((v) => Number.isInteger(v) && v >= 0) || !Array.isArray(body.topCourses) || body.topCourses.length > 3 || !body.topCourses.every((c: any) => typeof c.name === "string" && Number.isInteger(c.rounds) && c.rounds >= 0 && Number.isInteger(c.members) && c.members >= 0)) throw new Error("Club engagement returned an incomplete response.");
        if (live) setData({ groupId, periodKey: period.key, value: body });
      } catch (e) { if (live) setError(e instanceof Error && e.name === "AbortError" ? "Club engagement took too long. Please retry." : e instanceof Error ? e.message : "Couldn't load club engagement."); }
      finally { window.clearTimeout(timeout); if (live) setLoading(false); }
    })();
    return () => { live = false; window.clearTimeout(timeout); controller.abort(); };
  }, [groupId, period.key, attempt, refreshKey]);
  const value = data?.groupId === groupId && data.periodKey === period.key ? data.value : null;
  return <section data-club-engagement style={{ background: C.greenLight, borderRadius: 12, padding: 16, marginTop: 16 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ flex: 1 }}><Eyebrow style={{ marginTop: 0 }}>CLUB PLAY · LAST 30 DAYS</Eyebrow></div><button type="button" style={{ ...btn(false), fontSize: 11 }} disabled={loading} onClick={() => setAttempt((a) => a + 1)}>{loading ? "Updating…" : "Refresh"}</button></div>
    {error && <div role="alert" style={{ color: C.cream, fontSize: 12, lineHeight: 1.5 }}>{error}{value ? " Showing the last loaded figures." : ""}</div>}
    {!value && !error && <div style={{ color: C.sage, fontSize: 13 }}>Loading club engagement…</div>}
    {value && <>
      <div style={{ color: C.cream, fontSize: 16, fontWeight: 700, marginTop: 8 }}>{value.rounds} round{value.rounds === 1 ? "" : "s"} played by {value.members} member{value.members === 1 ? "" : "s"}</div>
      <div style={{ color: C.sage, fontSize: 12, marginTop: 6 }}>{value.courses} course{value.courses === 1 ? "" : "s"} · {value.games} completed club game{value.games === 1 ? "" : "s"}{value.standaloneRounds > 0 ? ` · ${value.standaloneRounds} personal round${value.standaloneRounds === 1 ? "" : "s"}` : ""}{value.participationPct != null ? ` · ${value.participationPct}% of current members played` : ""}</div>
      {!compact && value.topCourses.length > 0 && <div style={{ marginTop: 14 }}><div style={{ color: C.gold, fontSize: 11, fontWeight: 800 }}>MOST PLAYED COURSES</div>{value.topCourses.map((course, i) => <div key={course.name} style={{ borderTop: `1px solid ${C.borderCard}`, padding: "8px 12px", marginTop: 6 }}><div style={{ color: C.cream, fontSize: 13, fontWeight: 700, overflowWrap: "anywhere" }}>{i + 1}. {course.name}</div><div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>{course.rounds} round{course.rounds === 1 ? "" : "s"} · {course.members} member{course.members === 1 ? "" : "s"}</div></div>)}</div>}
      {value.rounds === 0 && <div style={{ color: C.sage, fontSize: 12, marginTop: 10 }}>No qualifying club rounds in this period.</div>}
      {compact && onDetails && <button type="button" onClick={onDetails} style={{ ...btn(false), color: C.gold, fontSize: 12, marginTop: 10 }}>See courses & participation →</button>}
      {!compact && <div style={{ color: C.sage, fontSize: 11, lineHeight: 1.5, marginTop: 12 }}>Current members: finished club games and finalized personal rounds saved under this club. Posted game rounds count once. Scramble and Alternate Shot count participation for each player. Guests, unfinished and deleted rounds are excluded. Period uses US Eastern dates.{value.missingCourseRounds ? ` ${value.missingCourseRounds} rounds have no saved course name.` : ""}</div>}
    </>}
  </section>;
}
