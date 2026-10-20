"use client";
// The club report (210.0, owner-approved mock) — shown in the admin preview and on the club page.
import React from "react";
import { C } from "@/lib/golf";
import { completedRoundsNote, basis, rivalryWaiting, waitingNote, type ClubReport } from "@/lib/club-report";

const day = (d: string) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function ClubReportView({ r }: { r: ClubReport }) {
  const tiles: { l: string; w: string; v: string; b?: string | null }[] = [];
  if (r.bestGross) tiles.push({ l: "Best gross", w: r.bestGross.name, v: `${r.bestGross.score} · ${r.bestGross.course}` });
  if (r.bestNet) tiles.push({ l: "Best net", w: r.bestNet.name, v: `net ${r.bestNet.score} · ${day(r.bestNet.date)}` });
  if (r.standouts.count) tiles.push({ l: "Standout rounds", w: `${r.standouts.count} this period`, v: r.standouts.best ? `best: ${r.standouts.best.name}, ${r.standouts.best.better.toFixed(1)} better than the field` : "" });
  if (r.mostNetBirdies) tiles.push({ l: "Most net birdies", w: r.mostNetBirdies.name, v: String(r.mostNetBirdies.count), b: basis.netBirdies(r) });
  if (r.mostImproved) tiles.push({ l: "Most improved", w: r.mostImproved.name, v: `index ${r.mostImproved.from.toFixed(1)} → ${r.mostImproved.to.toFixed(1)}`, b: basis.improved(r) });
  if (r.mostRounds) tiles.push({ l: "Most rounds", w: r.mostRounds.name, v: String(r.mostRounds.count) });
  const box: React.CSSProperties = { background: C.greenLight, borderRadius: 12, padding: "13px 16px", marginTop: 10 };
  const th: React.CSSProperties = { color: C.sage, fontSize: 11, fontWeight: 800, letterSpacing: 1, marginBottom: 4 };
  const line: React.CSSProperties = { color: C.cream, fontSize: 13, lineHeight: 1.5, marginTop: 4 };
  return (
    <div data-club-report>
      <div style={{ color: C.gold, fontSize: 11, fontWeight: 800, letterSpacing: 2 }}>{r.club.toUpperCase()} · {r.period.label.toUpperCase()}</div>
      <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 20, fontWeight: 800, marginTop: 4 }}>
        {r.games} game{r.games === 1 ? "" : "s"} · {r.rounds} round{r.rounds === 1 ? "" : "s"} · {r.members} member{r.members === 1 ? "" : "s"} played
      </div>
      {!r.games ? <div style={{ ...box, color: C.sage, fontSize: 13 }}>No finished games in this period.</div> : null}
      {tiles.length ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }} data-report-tiles>
          {tiles.map((t) => (
            <div key={t.l} style={{ background: C.greenLight, borderRadius: 10, padding: "8px 12px" }}>
              <div style={{ color: C.sage, fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase" }}>{t.l}</div>
              <div style={{ color: C.cream, fontWeight: 800, fontSize: 14 }}>{t.w}</div>
              {t.v ? <div style={{ color: C.gold, fontSize: 12, fontWeight: 700 }}>{t.v}</div> : null}
              {t.b ? <div style={{ color: C.sage, fontSize: 11, marginTop: 2 }}>{t.b}</div> : null}
            </div>
          ))}
        </div>
      ) : null}
      {waitingNote(r) ? <div data-report-waiting style={{ color: C.sage, fontSize: 12, marginTop: 8, lineHeight: 1.45 }}>{waitingNote(r)}</div> : null}
      {r.games ? <div data-report-completed-only style={{ color: C.sage, fontSize: 12, marginTop: 8, lineHeight: 1.45 }}>{completedRoundsNote(r)}</div> : null}
      {r.toughestCourse || r.nemesisHole || r.mostBirdiedHole ? (
        <div style={box} data-report-courses><div style={th}>THE COURSES</div>
          {r.toughestCourse ? <div style={line}>Toughest for the club: <b>{r.toughestCourse.course}</b> (field {r.toughestCourse.fieldGap >= 0 ? "+" : ""}{r.toughestCourse.fieldGap.toFixed(1)} over handicaps){basis.toughest(r) ? <span style={{ color: C.sage }}> · {basis.toughest(r)}</span> : null}</div> : null}
          {r.nemesisHole ? <div style={line}>The club&apos;s nemesis hole: <b>{r.nemesisHole.course} {r.nemesisHole.hole}</b> (par {r.nemesisHole.par}) — {r.nemesisHole.vsPar >= 0 ? "+" : ""}{r.nemesisHole.vsPar.toFixed(1)} a round{basis.hole(r.nemesisHole) ? <span style={{ color: C.sage }}> · {basis.hole(r.nemesisHole)}</span> : null}</div> : null}
          {r.mostBirdiedHole ? <div style={line}>Most birdied: <b>{r.mostBirdiedHole.course} {r.mostBirdiedHole.hole}</b> — {r.mostBirdiedHole.birdies} birdie{r.mostBirdiedHole.birdies === 1 ? "" : "s"}{basis.hole(r.mostBirdiedHole) ? <span style={{ color: C.sage }}> · {basis.hole(r.mostBirdiedHole)}</span> : null}</div> : null}
        </div>
      ) : null}
      {r.closestRivalry || r.longestStreak || rivalryWaiting(r) ? (
        <div style={box} data-report-rivalries><div style={th}>RIVALRIES & ATTENDANCE</div>
          {r.closestRivalry ? <div style={line}>Closest rivalry: <b>{r.closestRivalry.a} v {r.closestRivalry.b}</b> — {r.closestRivalry.aWins}–{r.closestRivalry.bWins}{r.closestRivalry.halved ? `, ${r.closestRivalry.halved} halved` : ""}{basis.rivalry(r) ? <span style={{ color: C.sage }}> · {basis.rivalry(r)}</span> : null}</div> : null}
          {rivalryWaiting(r) ? <div style={{ ...line, color: C.sage }} data-report-waiting-rivalry>{rivalryWaiting(r)}</div> : null}
          {r.longestStreak ? <div style={line}>Longest streak: <b>{r.longestStreak.name}</b> — {r.longestStreak.weeks} weeks in a row</div> : null}
        </div>
      ) : null}
    </div>
  );
}
