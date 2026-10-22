"use client";
// The game recap's content (207.2) — ONE component for the in-app recap and the share image, so they
// can never drift apart. mode "share": the 9:16 image for the group (no personal line, no money, top-5
// net birdies). mode "app": everything, plus the viewer's own day and the full net-birdie list.
// Every number comes from lib/game-recap (highlights + format sections). Names wrap; nothing truncates.
import { shortenedNote } from "@/lib/round-rules";
import type { CupLine } from "@/lib/cup-standing";
import React from "react";
import { C } from "@/lib/golf";
import { teamAccent, teamColour } from "@/lib/game-colors";
import { fmtMatchDate } from "@/lib/lineup-meta";
import type { Recap } from "@/lib/game-recap";
import type { Game } from "@/lib/game-types";

export type RecapContest = { label: string; hole: number; name: string; value: string };
const FORMAT: Record<string, string> = { match: "Singles", fourball: "Four-ball", alt_shot: "Alternate shot", scramble: "Scramble", trifecta: "Trifecta", stableford: "Stableford", stroke: "Stroke play", skins: "Skins" };
const SCR_COLS = "24px minmax(0, 1fr) 44px 44px 48px";   // 212.15: the scramble leaderboard's columns
const S = {
  eye: { color: C.gold, fontSize: 11, letterSpacing: 2, fontWeight: 800 } as React.CSSProperties,
  th: { color: C.gold, fontSize: 11, fontWeight: 800, letterSpacing: 1.2, marginBottom: 4 } as React.CSSProperties,
  box: { background: C.greenMid, borderRadius: 10, padding: "8px 12px" } as React.CSSProperties,
  row: { display: "flex", alignItems: "flex-start", gap: 8, paddingTop: 4, paddingBottom: 4, borderTop: `1px solid ${C.green}`, fontSize: 13, color: C.cream, lineHeight: 1.3 } as React.CSSProperties,
  pos: { color: C.gold, fontWeight: 800, minWidth: 24 } as React.CSSProperties,
  name: { flex: 1, minWidth: 0, overflowWrap: "anywhere" } as React.CSSProperties,
  num: { fontFamily: "Georgia, serif", fontWeight: 800, fontSize: 16, whiteSpace: "nowrap" } as React.CSSProperties,
  line: { color: C.sage, fontSize: 12.5, lineHeight: 1.4 } as React.CSSProperties,
};
const teamColor = (game: Game, key: string | null) => {
  const teams = Array.isArray(game.teams) ? game.teams : [];
  const i = teams.findIndex((t: any) => t.key === key);
  return i >= 0 ? teamColour(teams[i], i) : C.sage;
};
const Dot = ({ color }: { color: string }) => <span aria-hidden style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: color, marginRight: 6, marginTop: 4, flexShrink: 0 }} />;

export function RecapBody({ game, recap, mode, contests = [], myLine, myScore, money, cup }: {
  game: Game; recap: Recap; mode: "share" | "app"; contests?: RecapContest[];
  myLine?: string | null; myScore?: string | null; money?: string | null;
  /** 209.5: a Cup session — the Cup's standing after it (lib/cup-standing; numbers made there, shown here). */
  cup?: CupLine | null;
}) {
  const { highlights: h, sections: s } = recap;
  const share = mode === "share";
  const live = (game as any).players_count as number | undefined; // set by the caller
  const meta = [(game as any).played_at ? fmtMatchDate(String((game as any).played_at).slice(0, 10)) : null, FORMAT[game.game_type] || game.game_type, cup ? (cup.sessionCount ? `Session ${cup.sessionNo} of ${cup.sessionCount}` : `Session ${cup.sessionNo}`) : null, live ? `${live} players` : null].filter(Boolean).join(" · ");
  const head = recap.headline.match(/^(.*?)([\d½]+–[\d½]+|net \d+|\d+ skins?|\d+ points)$/);
  const nbRows = share ? h.netBirdies.top : h.netBirdies.all.map((r, i) => ({ pos: String(i + 1), item: r }));
  return (
    <div data-recap-body={mode} style={{ display: "flex", flexDirection: "column", gap: 10, color: C.cream }}>
      <div>
        <div style={S.eye}>{recap.endedEarly ? "FINAL · ENDED EARLY" : "FINAL"} · {(game.name || game.course || "").toUpperCase()}</div>
        <div style={{ color: C.sage, fontSize: 12, marginTop: 2 }}>{meta}</div>
      </div>
      <div data-recap-headline style={{ fontFamily: "Georgia, serif", fontSize: 26, fontWeight: 800, lineHeight: 1.15 }}>
        {head ? <>{head[1]}<span style={{ color: C.gold }}>{head[2]}</span></> : recap.headline}
      </div>
      {s.sub ? <div style={{ color: C.sage, fontSize: 13, marginTop: -4 }}>{s.sub}</div> : null}
      {recap.notes.map((n, i) => <div key={i} style={{ color: C.gold, fontSize: 12.5 }}>{n}</div>)}
      {cup ? (
        <div data-recap-cup style={{ ...S.box, border: `1px solid ${C.gold}` }}>
          <div style={S.th}>{cup.name.toUpperCase()} · {cup.final ? "FINAL" : "AFTER THIS SESSION"}</div>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 20, fontWeight: 800, marginTop: 2 }}>
            <span style={{ color: cup.aColour }}>{cup.aName} {cup.a}</span> – <span style={{ color: cup.bColour }}>{cup.bName} {cup.b}</span>
          </div>
          <div style={{ color: C.sage, fontSize: 12.5, marginTop: 3 }}>{cup.detail}</div>
        </div>
      ) : null}

      {!share && (myLine || myScore) ? (
        <div data-recap-you style={S.box}>
          <div style={S.th}>YOUR DAY</div>
          {myLine ? <div style={{ fontSize: 14 }}>{myLine.charAt(0).toUpperCase() + myLine.slice(1)}.</div> : null}
          {myScore ? <div style={{ ...S.line, marginTop: 2 }}>{myScore}</div> : null}
        </div>
      ) : null}

      {/* The format's own section */}
      {s.matches && s.matches.rows.length ? (
        <div style={S.box} data-recap-matches>
          <div style={S.th}>{s.matches.title}</div>
          {s.matches.rows.map((r, i) => (
            <div key={i} style={S.row}>
              {r.team ? <Dot color={teamColor(game, r.team)} /> : null}
              <span style={S.name}>{r.halved ? <>{r.winners.join(" & ")} halved with {r.losers.join(" & ")}</> : <><b>{r.winners.join(" & ")}</b> beat {r.losers.join(" & ")}</>}</span>
              <span style={{ color: C.gold, fontWeight: 800, whiteSpace: "nowrap" }}>{r.result}</span>
            </div>
          ))}
        </div>
      ) : null}
      {s.skins && s.skins.length ? (
        <div style={S.box} data-recap-skins>
          <div style={S.th}>SKINS WON · {game.holes_meta?.length ?? 18} IN PLAY</div>
          {s.skins.map((r) => (
            <div key={r.name} style={S.row}>
              <span style={S.name}>{r.name}<span style={{ color: C.sage, fontSize: 12 }}> · {r.holes.map((x) => `#${x.n}${x.value > 1 ? ` (${x.value})` : ""}`).join(", ")}</span></span>
              <span style={S.num}>{r.skins}</span>
            </div>
          ))}
        </div>
      ) : null}
      {s.skinMatches && s.skinMatches.rows.length ? (
        <div style={S.box} data-recap-skin-matches>
          <div style={S.th}>{s.skinMatches.title}</div>
          {s.skinMatches.rows.map((r, i) => {
            const aWin = r.aSkins > r.bSkins;
            return (
              <div key={i} style={S.row}>
                {r.winnerTeam ? <Dot color={teamColor(game, r.winnerTeam)} /> : null}
                <span style={S.name}>{r.winnerTeam ? <><b>{(aWin ? r.a : r.b).join(" & ")}</b> beat {(aWin ? r.b : r.a).join(" & ")}</> : <>{r.a.join(" & ")} and {r.b.join(" & ")} split</>}</span>
                <span style={S.num}>{Math.max(r.aSkins, r.bSkins)}–{Math.min(r.aSkins, r.bSkins)}</span>
              </div>
            );
          })}
        </div>
      ) : null}
      {s.scramble ? (
        <div style={S.box} data-recap-scramble>
          <div style={S.th}>{s.scramble.mode === "match" ? "SCRAMBLE · TEAM V TEAM" : `SCRAMBLE · ${s.scramble.gross ? "GROSS" : "NET"}`}</div>
          {s.scramble.mode === "match"
            ? s.scramble.matches.map((m, i) => <div key={i} style={S.row}><span style={S.name}>{m}</span></div>)
            : (
              // 212.15 (owner): a leaderboard table — net (the ranking) biggest, gross and ± in their own short
              // columns, and the members on a full-width line, so names don't wrap into a sliver
              <div data-recap-scramble-board>
                <div style={{ display: "grid", gridTemplateColumns: SCR_COLS, gap: 6, color: C.sage, fontSize: 11, fontWeight: 700, paddingBottom: 4 }}>
                  <span>Pos</span><span>Team</span>
                  {s.scramble.gross ? <span style={{ textAlign: "right", gridColumn: "span 2" }}>Gross</span> : <><span style={{ textAlign: "right" }}>Net</span><span style={{ textAlign: "right" }}>Gross</span></>}
                  <span style={{ textAlign: "right" }}>±</span>
                </div>
                {s.scramble.rows.map((r, i) => {
                  const pm = r.toPar === 0 ? "E" : r.toPar > 0 ? `+${r.toPar}` : String(r.toPar);
                  const thru = r.holes != null && r.thru < r.holes ? r.thru : null;
                  return (
                    <div key={i} data-recap-scramble-row style={{ borderTop: `1px solid ${C.borderGreen}`, paddingTop: 8, paddingBottom: 8 }}>
                      <div style={{ display: "grid", gridTemplateColumns: SCR_COLS, gap: 6, alignItems: "baseline" }}>
                        <span style={{ color: C.gold, fontSize: 15, fontWeight: 800 }}>{r.pos}</span>
                        <span style={{ color: C.cream, fontSize: 15, fontWeight: 800, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                        {s.scramble!.gross
                          ? <span style={{ textAlign: "right", gridColumn: "span 2", color: C.cream, fontSize: 20, fontWeight: 800 }}>{r.gross}</span>
                          : <><span style={{ textAlign: "right", color: C.cream, fontSize: 20, fontWeight: 800 }}>{r.net}</span><span style={{ textAlign: "right", color: C.sage, fontSize: 14 }}>{r.gross}</span></>}
                        <span style={{ textAlign: "right", color: C.cream, fontSize: 14, fontWeight: 700 }}>{pm}{thru != null ? <span style={{ display: "block", color: C.sage, fontSize: 11, fontWeight: 500 }}>thru {thru}</span> : null}</span>
                      </div>
                      <div style={{ color: C.sage, fontSize: 12, marginTop: 2, marginLeft: 30, lineHeight: 1.4 }}>{r.members.split(", ").join(" · ")}</div>
                    </div>
                  );
                })}
              </div>
            )}
        </div>
      ) : null}
      {s.leaderboard && !s.flights?.length ? (
        <div style={S.box} data-recap-leaderboard>
          <div style={S.th}>LEADERBOARD · {s.leaderboard.basis === "points" ? "POINTS" : s.leaderboard.basis.toUpperCase()}</div>
          {s.leaderboard.rows.map((r, i) => (
            <div key={i} style={S.row}><span style={S.pos}>{r.pos}</span><span style={S.name}>{r.item.name}</span>
              {s.leaderboard!.basis === "net" ? <span style={{ color: C.sage, fontSize: 12, whiteSpace: "nowrap" }}>{r.item.gross} gross</span> : null}
              <span style={S.num}>{r.item.score}</span></div>
          ))}
        </div>
      ) : null}
      {s.flights?.map((f) => (
        <div key={f.name} style={S.box} data-recap-flight>
          <div style={{ ...S.th, display: "flex", justifyContent: "space-between" }}><span>{f.name.toUpperCase()}</span><span>{f.players} players</span></div>
          {f.rows.map((r, i) => <div key={i} style={S.row}><span style={S.pos}>{r.pos}</span><span style={S.name}>{r.item.name}</span><span style={S.num}>{r.item.score}</span></div>)}
        </div>
      ))}
      {s.pairs ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {([["TOP 3 PAIRS · GROSS", s.pairs.gross], ["TOP 3 PAIRS · NET", s.pairs.net]] as const).map(([t, rows]) => (
            <div key={t} style={S.box}><div style={S.th}>{t}</div>
              {rows.map((r, i) => <div key={i} style={S.row}><span style={S.pos}>{r.pos}</span><span style={S.name}>{r.item.names.join(" & ")}</span><span style={S.num}>{r.item.score}</span></div>)}
            </div>
          ))}
        </div>
      ) : null}

      {/* 209.0 order (owner, Oct 2026): how the field played → highlights → standout rounds → top 3 → net birdies */}
      {s.individualStats ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, textAlign: "center" }} data-recap-scoring>
          {([["birdies", h.scoring.birdies], ["pars", h.scoring.pars], ["bogeys", h.scoring.bogeys], ["doubles+", h.scoring.doublesPlus]] as const).map(([l, v]) => (
            <div key={l} style={{ color: C.sage, fontSize: 11 }}><div style={{ ...S.num, fontSize: 20, color: C.cream }}>{v}</div>{l}</div>
          ))}
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }} data-recap-course>
        {s.individualStats && (h.fieldNet != null || h.frontBack) ? (
          <div style={S.line}>{h.fieldNet != null ? <>Field average <b style={{ color: C.cream }}>net {h.fieldNet.toFixed(1)}</b></> : null}{h.fieldNet != null && h.frontBack ? " · " : null}{h.frontBack ? (Math.abs(h.frontBack.front - h.frontBack.back) < 0.05 ? "even front and back" : `${h.frontBack.back < h.frontBack.front ? "back" : "front"} nine ${Math.abs(h.frontBack.front - h.frontBack.back).toFixed(1)} better`) : null}</div>
        ) : null}
        {h.toughest ? <div style={S.line}>Toughest: <b style={{ color: C.cream }}>Hole {h.toughest.n}</b> · par {h.toughest.par}{h.toughest.si ? `, stroke index ${h.toughest.si}` : ""} · field averaged <b style={{ color: C.cream }}>{h.toughest.avg.toFixed(1)} ({h.toughest.vsPar >= 0 ? "+" : ""}{h.toughest.vsPar.toFixed(1)})</b>{h.toughest.parsOrBetter === 0 ? " — nobody made par" : ""}</div> : null}
        {h.easiest && h.easiest.n !== h.toughest?.n ? <div style={S.line}>Easiest: <b style={{ color: C.cream }}>Hole {h.easiest.n}</b> · par {h.easiest.par}{h.easiest.si ? `, stroke index ${h.easiest.si}` : ""} · field averaged <b style={{ color: C.cream }}>{h.easiest.avg.toFixed(1)} ({h.easiest.vsPar >= 0 ? "+" : ""}{h.easiest.vsPar.toFixed(1)})</b>{h.easiest.birdies || h.easiest.pars ? ` — ${h.easiest.birdies} birdie${h.easiest.birdies === 1 ? "" : "s"}, ${h.easiest.pars} par${h.easiest.pars === 1 ? "" : "s"}` : ""}</div> : null}
        {s.individualStats && h.netEagleHole ? <div style={S.line}>Net eagles: <b style={{ color: C.cream }}>{h.netEagleHole.total}</b> — <b style={{ color: C.cream }}>{h.netEagleHole.count} on hole {h.netEagleHole.n}</b> (par {h.netEagleHole.par}{h.netEagleHole.si ? `, stroke index ${h.netEagleHole.si}` : ""})</div> : null}
        {contests.length ? <div style={S.line} data-recap-contests>{contests.map((c, i) => <span key={i}>{i ? " · " : ""}{c.label} #{c.hole} <b style={{ color: C.cream }}>{c.name}</b> {c.value}</span>)}</div> : null}
      </div>
      {s.tiles.length ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }} data-recap-tiles>
          {s.tiles.map((t) => (
            <div key={t.label} style={{ ...S.box, display: "flex", flexDirection: "column" }}>
              <span style={{ color: C.sage, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>{t.label}</span>
              <b style={{ fontSize: 13.5, overflowWrap: "anywhere" }}>{t.who}</b>
              <span style={{ color: C.gold, fontSize: 12, fontWeight: 700 }}>{t.what}</span>
            </div>
          ))}
        </div>
      ) : null}
      {s.individualStats && h.standouts && h.standouts.rows.length ? (
        <div data-recap-standouts style={{ ...S.box, border: `1px solid ${C.gold}` }}>
          <div style={S.th}>STANDOUT ROUNDS{h.standouts.basis === "field" && h.standouts.fieldGap != null ? <span style={{ color: C.sage, fontWeight: 500, letterSpacing: 0 }}> · best against their handicap, on a course that played {Math.abs(Math.round(h.standouts.fieldGap - 3))} shot{Math.abs(Math.round(h.standouts.fieldGap - 3)) === 1 ? "" : "s"} {h.standouts.fieldGap - 3 >= 0.5 ? "hard" : h.standouts.fieldGap - 3 <= -0.5 ? "easy" : "about normal"}</span> : <span style={{ color: C.sage, fontWeight: 500, letterSpacing: 0 }}> · best against their own handicap</span>}</div>
          {h.standouts.rows.map((r, i) => (
            <div key={r.name} style={S.row}><span style={S.name}>{r.name}{r.exceptional ? " · exceptional round" : ""}</span>
              <span style={{ color: C.gold, fontWeight: 800, whiteSpace: "nowrap" }}>{r.better.toFixed(1)} better{i === 0 && h.standouts!.basis === "field" ? " than the field" : h.standouts!.basis === "own" ? " than handicap" : ""}</span></div>
          ))}
          {h.standouts.basis === "field" && h.standouts.fieldGap != null ? (
            <div style={{ color: C.sage, fontSize: 11, marginTop: 4, lineHeight: 1.4 }}>The field averaged {h.standouts.fieldGap.toFixed(1)} over its handicaps (a normal day is about 3).</div>
          ) : null}
        </div>
      ) : null}
      {/* Shared sections */}
      {s.individualStats && !s.leaderboard && h.topGross.length ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }} data-recap-top3>
          {([["TOP 3 GROSS", h.topGross], ["TOP 3 NET", h.topNet]] as const).map(([t, rows]) => (
            <div key={t} style={S.box}><div style={S.th}>{t}</div>
              {rows.map((r, i) => <div key={i} style={S.row}><span style={S.pos}>{r.pos}</span><span style={S.name}>{r.item.name}</span><span style={S.num}>{r.item.score}</span></div>)}
            </div>
          ))}
        </div>
      ) : null}
      {/* 210.6 (owner): only completed rounds count toward exceptional play — said plainly, by name. */}
      {shortenedNote(h.shortened) ? <div data-recap-shortened style={{ color: C.sage, fontSize: 12, lineHeight: 1.45 }}>{shortenedNote(h.shortened)}</div> : null}
      {s.individualStats && h.netBirdies.players ? (
        <div style={S.box} data-recap-net-birdies>
          <div style={S.th}>NET BIRDIES &amp; EAGLES{share ? " · TOP 5" : ""}</div>
          <div style={{ ...S.row, borderTop: "none", color: C.sage, fontSize: 11 }}><span style={S.pos} /><span style={S.name} /><span style={{ width: 60, textAlign: "right" }}>Net birdies</span><span style={{ width: 60, textAlign: "right" }}>Net eagles</span></div>
          {nbRows.map((r, i) => (
            <div key={i} style={S.row}><span style={S.pos}>{r.pos}</span><span style={S.name}>{r.item.name}</span>
              <span style={{ ...S.num, width: 60, textAlign: "right" }}>{r.item.birdies}</span><span style={{ ...S.num, width: 60, textAlign: "right" }}>{r.item.eagles || "–"}</span></div>
          ))}
          <div style={{ color: C.gold, fontSize: 12, fontWeight: 700, marginTop: 4 }}>
            {h.netBirdies.birdies} net birdie{h.netBirdies.birdies === 1 ? "" : "s"} and {h.netBirdies.eagles} net eagle{h.netBirdies.eagles === 1 ? "" : "s"} by {h.netBirdies.players} player{h.netBirdies.players === 1 ? "" : "s"}{share && h.netBirdies.all.length > h.netBirdies.top.length ? " · full list in the game recap in Birdie Num Num" : ""}
          </div>
        </div>
      ) : null}
      {!share ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }} data-recap-app-extra>
        {!share && h.roundMinutes ? <div style={S.line}>Round length: <b style={{ color: C.cream }}>{Math.floor(h.roundMinutes / 60)} h {h.roundMinutes % 60} m</b>, first tee to last putt</div> : null}
        {!share && money ? <div style={{ ...S.line, color: money.includes("review") ? C.gold : C.sage }} data-recap-money>{money}</div> : null}
        </div>
      ) : null}
      <div style={{ color: C.sage, fontSize: 11, textAlign: "right", marginTop: share ? "auto" : 0 }}>{s.individualStats ? <>Net uses each player&apos;s full Course Handicap — you against the course. Match results use the game&apos;s allowance.<br /></> : null}⛳ Birdie Num Num</div>
    </div>
  );
}
