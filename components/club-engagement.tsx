"use client";
import React, { useEffect, useMemo, useState } from "react";
import { C } from "@/lib/golf";
import { clubEngagementPeriod, type ClubEngagement as Engagement, type ClubEngagementRange } from "@/lib/club-engagement";
import { formatClubDateRange } from "@/lib/club-date-range";
import { btn, Eyebrow } from "@/components/ui";
export function ClubEngagement({ groupId, now, refreshKey, compact = false, onDetails }: { groupId: string; now: number; refreshKey?: unknown; compact?: boolean; onDetails?: () => void }) {
  const [range, setRange] = useState<ClubEngagementRange>("30");
  const period = useMemo(() => clubEngagementPeriod(now, range), [now, range]);
  const [data, setData] = useState<{ groupId: string; periodKey: string; value: Engagement } | null>(null);
  const [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(true), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true; const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), 20_000); setLoading(true); setError(null);
    void (async () => {
      try {
        const response = await fetch(`/api/club-engagement?group_id=${encodeURIComponent(groupId)}&period=${range}`, { signal: controller.signal, cache: "no-store", credentials: "same-origin" });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error || "Couldn't load club engagement.");
        if (typeof body?.period?.key !== "string" || !body.period.key.startsWith(`club-${range}:`) || ![body.rounds, body.members, body.totalMembers, body.courses, body.games, body.missingCourseRounds, body.standaloneRounds, body.repeatPlayers, body.holesPlayed, body.scoringHoles].every((v) => Number.isInteger(v) && v >= 0) || !body.scoring || ![body.scoring.eagle, body.scoring.birdie, body.scoring.par, body.scoring.bogey, body.scoring.double].every((v) => Number.isInteger(v) && v >= 0) || Object.values(body.scoring).reduce((a: number, b: any) => a + b, 0) !== body.scoringHoles || body.scoringHoles > body.holesPlayed || !Array.isArray(body.formats) || !body.formats.every((f: any) => typeof f.name === "string" && Number.isInteger(f.games) && f.games > 0) || !Array.isArray(body.topCourses) || body.topCourses.length > 3 || !body.topCourses.every((c: any) => typeof c.name === "string" && Number.isInteger(c.rounds) && c.rounds >= 0 && Number.isInteger(c.members) && c.members >= 0)) throw new Error("Club engagement returned an incomplete response.");
        if (live) setData({ groupId, periodKey: period.key, value: body });
      } catch (e) { if (live) setError(e instanceof Error && e.name === "AbortError" ? "Club engagement took too long. Please retry." : e instanceof Error ? e.message : "Couldn't load club engagement."); }
      finally { window.clearTimeout(timeout); if (live) setLoading(false); }
    })();
    return () => { live = false; window.clearTimeout(timeout); controller.abort(); };
  }, [groupId, period.key, range, attempt, refreshKey]);
  const value = data?.groupId === groupId && data.periodKey === period.key ? data.value : null;
  return <section data-club-engagement style={{ background: C.greenLight, borderRadius: 12, padding: 16, marginTop: 16 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ flex: 1 }}><Eyebrow style={{ marginTop: 0 }}>CLUB PLAY · {period.label.toUpperCase()}</Eyebrow></div><button type="button" style={{ ...btn(false), fontSize: 11 }} disabled={loading} onClick={() => setAttempt((a) => a + 1)}>{loading ? "Updating…" : "Refresh"}</button></div>
    <div role="group" aria-label="Club play period" style={{ display: "flex", gap: 8, marginTop: 10 }}>
      {([["30", "Last 30 days"], ["90", "Last 90 days"], ["year", "Year to date"]] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={range === key} onClick={() => setRange(key)} style={{ ...btn(range === key), flex: 1, minWidth: 0, padding: "8px 12px", fontSize: 11 }}>{label}</button>)}
    </div>
    <div style={{ color: C.sage, fontSize: 11, marginTop: 8 }}>{formatClubDateRange(period)}</div>
    {error && <div role="alert" style={{ color: C.cream, fontSize: 12, lineHeight: 1.5 }}>{error}{value ? " Showing the last loaded figures." : ""}</div>}
    {!value && !error && <div style={{ color: C.sage, fontSize: 13 }}>Loading club engagement…</div>}
    {value && <>
      <div style={{ color: C.cream, fontSize: 16, fontWeight: 700, marginTop: 8 }}>{value.rounds} round{value.rounds === 1 ? "" : "s"} played by {value.members} member{value.members === 1 ? "" : "s"}</div>
      <div style={{ color: C.sage, fontSize: 12, marginTop: 6 }}>{value.courses} course{value.courses === 1 ? "" : "s"} · {value.games} completed club game{value.games === 1 ? "" : "s"}{value.standaloneRounds > 0 ? ` · ${value.standaloneRounds} personal round${value.standaloneRounds === 1 ? "" : "s"}` : ""}{value.participationPct != null ? ` · ${value.participationPct}% of current members played` : ""}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        {[[value.repeatPlayers, "Repeat players · 2+ rounds"], [value.holesPlayed.toLocaleString("en-US"), "Holes recorded"]].map(([count, label]) => <div key={label} style={{ flex: 1, minWidth: 0, background: C.greenMid, padding: "13px 16px", borderRadius: 12 }}><div style={{ color: C.cream, fontSize: 24, fontFamily: "Georgia, serif", fontWeight: 800 }}>{count}</div><div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>{label}</div></div>)}
      </div>
      {!compact && value.topCourses.length > 0 && <div style={{ marginTop: 14 }}><div style={{ color: C.gold, fontSize: 11, fontWeight: 800 }}>MOST PLAYED COURSES</div>{value.topCourses.map((course, i) => <div key={course.name} style={{ borderTop: `1px solid ${C.borderCard}`, padding: "8px 12px", marginTop: 6 }}><div style={{ color: C.cream, fontSize: 13, fontWeight: 700, overflowWrap: "anywhere" }}>{i + 1}. {course.name}</div><div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>{course.rounds} round{course.rounds === 1 ? "" : "s"} · {course.members} member{course.members === 1 ? "" : "s"}</div></div>)}</div>}
      {!compact && value.formats.length > 0 && <div style={{ marginTop: 14 }}><Eyebrow>MOST-PLAYED FORMATS</Eyebrow>{value.formats.map((format) => <div key={format.name} style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 8, fontSize: 12 }}><span style={{ color: C.cream }}>{format.name}</span><span style={{ color: C.sage }}>{format.games} game{format.games === 1 ? "" : "s"}</span></div>)}</div>}
      {!compact && <div style={{ marginTop: 14 }}><Eyebrow>SCORING ACROSS THE CLUB</Eyebrow><div style={{ color: C.sage, fontSize: 11 }}>{value.scoringHoles.toLocaleString("en-US")} holes with a recorded score and par</div>{([["eagle", "Eagles"], ["birdie", "Birdies"], ["par", "Pars"], ["bogey", "Bogeys"], ["double", "Doubles+"]] as const).map(([key, label]) => <div key={key} style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 8, fontSize: 12 }}><span style={{ color: C.cream }}>{label}</span><span style={{ color: C.sage }}>{value.scoring[key].toLocaleString("en-US")} · {value.scoringHoles ? (100 * value.scoring[key] / value.scoringHoles).toFixed(1) : "0.0"}%</span></div>)}<div style={{ color: C.sage, fontSize: 11, lineHeight: 1.5, marginTop: 10 }}>Gross scores against par. Shared team-score holes count once. Eagles includes better; doubles+ includes worse.{value.holesPlayed > value.scoringHoles ? ` ${value.holesPlayed - value.scoringHoles} holes have no valid par and are excluded from this breakdown.` : ""} Formats count completed club games; personal rounds have no game format.</div></div>}
      {value.rounds === 0 && <div style={{ color: C.sage, fontSize: 12, marginTop: 10 }}>No qualifying club rounds in this period.</div>}
      {onDetails && <button type="button" onClick={onDetails} style={{ ...btn(false), color: C.gold, fontSize: 12, marginTop: 10 }}>{compact ? "See courses & participation →" : "Hide course details"}</button>}
      {!compact && <div style={{ color: C.sage, fontSize: 11, lineHeight: 1.5, marginTop: 12 }}>Current members: finished club games and finalized personal rounds saved under this club. Posted game rounds count once. Scramble and Alternate Shot count participation for each player. Guests, unfinished and deleted rounds are excluded. Period uses US Eastern dates.{value.missingCourseRounds ? ` ${value.missingCourseRounds} rounds have no saved course name.` : ""}</div>}
    </>}
  </section>;
}
