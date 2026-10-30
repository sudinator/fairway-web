/**
 * 212.71 mock-ups (owner, Oct 29: "lets see mock ups of what changes you are suggesting compare them to what exists
 * currently so we can iterate"). A realistic Stableford: 8 players, 18 holes, three sixes, stats entered, two side
 * contests. Rendered four ways by the design gallery: the CURRENT app recap and share image (the real RecapBody), and
 * the PROPOSED app recap (the real body plus the new sections) and one-screen share image.
 */
import * as React from "react";
import { C } from "@/lib/golf";
import type { Game, Player } from "@/lib/game-types";
import { RecapBody, type RecapContest } from "@/components/game/recap-body";
import { buildRecap } from "@/lib/game-recap";
import { segRanges, segValues, segLeadersFor } from "@/lib/segments";

const PAR = [4, 5, 3, 4, 4, 3, 4, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4], SI = [7, 3, 17, 1, 11, 15, 5, 9, 13, 8, 2, 18, 4, 12, 6, 16, 10, 14];
const holes = PAR.map((p, i) => ({ n: i + 1, par: p, si: SI[i], yards: 340 + (i * 23) % 120 }));
const NAMES = ["Raj Mehta", "Nihar Shah", "Karan Patel", "Sam Lee", "Amit Sud", "Vikram Rao", "Probir Das", "Harsh Parikh"];
const CH = [4, 10, 15, 22, 6, 11, 17, 25];
// gross scores relative to par per hole, per player — a believable spread
const REL = [
  [0, -1, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, -1, 0, 0, 0, 0, 1], [1, 0, 1, 1, 0, 1, 0, 2, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0],
  [1, 2, 0, 1, 1, 1, 0, 1, 2, 1, 0, 1, 1, 0, 1, 1, 0, 1], [2, 1, 1, 2, 1, 2, 1, 1, 1, 2, 1, 1, 2, 1, 1, 2, 1, 2],
  [0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0], [1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 0, 0, 1],
  [0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0], [2, 2, 1, 2, 2, 1, 2, 2, 1, 2, 2, 1, 2, 1, 2, 1, 2, 2],   // Probir Das (17): a standout round, 7+ better than his index
];
const PUTTS = [[2,2,1,2,2,2,2,2,1,2,2,2,2,2,1,2,2,2],[2,2,2,2,1,2,2,3,2,2,2,2,2,2,2,2,2,2],[2,3,2,2,2,2,1,2,3,2,2,2,2,2,2,2,2,2],[3,2,2,3,2,2,2,2,2,3,2,2,3,2,2,2,2,3],
  [1,2,2,2,2,1,2,2,2,2,2,1,2,2,2,2,2,2],[2,2,2,1,2,2,2,2,2,2,2,2,2,1,2,2,2,2],[2,2,2,3,1,2,2,2,2,2,3,2,2,2,2,2,3,2],[3,3,2,3,3,2,3,3,2,3,3,2,3,2,3,2,3,3]];
const FW = [[1,1,0,1,1,0,1,1,1,1,1,0,1,1,1,0,1,1],[1,0,0,1,1,0,1,0,1,1,1,0,1,0,1,0,1,1],[1,1,0,0,1,0,1,1,0,1,1,0,1,1,0,0,1,0],[0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0],
  [1,1,0,1,1,0,1,1,1,1,1,0,1,1,1,0,1,1],[1,1,0,1,0,0,1,1,1,1,1,0,1,1,1,0,1,1],[1,0,0,1,1,0,1,1,1,0,1,0,1,1,1,0,0,1],[0,0,0,1,0,0,0,1,0,0,1,0,0,0,0,0,1,0]];
export const players: Player[] = NAMES.map((n, i) => ({ id: `u${i}`, user_id: `u${i}`, display_name: n, course_handicap: CH[i], course_handicap_source: "manual", handicap_index: CH[i] * 0.9,
  scores: REL[i].map((r, h) => PAR[h] + r), putts: PUTTS[i], fairways: FW[i].map((f, h) => (PAR[h] === 3 ? null : !!f)), sand: REL[i].map((_, h) => (h % 7 === 3 ? 1 : 0)), penalties: REL[i].map(() => 0),
  rating: 72.3, slope: 133, tee_name: "Blue", no_show: false, tee_group: Math.floor(i / 4) + 1, team: null, is_guest: false }) as unknown as Player);
export const game = { id: "g", code: "494730", name: "Sunday Stableford", course: "Oak Hollow", holes_meta: holes, course_par: 72, played_at: "2026-10-25", created_by: "u4", status: "ended",
  game_type: "stableford", stroke_basis: "net", allowance_pct: 95, teams: null, pairings: [], foursomes: null, leg_config: { scheme: "sixes", metric: "pts", points: {} }, flight_mode: "off", group_id: "club" } as unknown as Game;
export const contests: RecapContest[] = [{ label: "Closest to the pin", hole: 12, name: "Amit Sud", value: "4 ft 3 in" }, { label: "Long drive", hole: 16, name: "Raj Mehta", value: "281 yds" }];

// ── the new pieces, computed from the same data the engines use ──
const ranges = segRanges("sixes", 18);
const segs = segLeadersFor(players.map((p) => ({ p, seg: segValues(p, game, ranges) })), game, ranges);
const stat = (f: (p: Player) => number, best: "low" | "high") => { const rows = players.map((p) => ({ p, v: f(p) })); const v = best === "low" ? Math.min(...rows.map((r) => r.v)) : Math.max(...rows.map((r) => r.v)); return { v, who: rows.filter((r) => r.v === v).map((r) => r.p.display_name) }; };
const putts = stat((p) => (p.putts as number[]).reduce((a, b) => a + b, 0), "low");
const fairways = stat((p) => (p.fairways as (boolean | null)[]).filter((x) => x === true).length, "high");
const streakOf = (p: Player) => { let best = 0, run = 0; (p.scores as number[]).forEach((s, h) => { run = s <= PAR[h] ? run + 1 : 0; best = Math.max(best, run); }); return best; };
const streak = stat(streakOf, "high");
const bounce = players.filter((p) => (p.scores as number[]).some((s, h) => h > 0 && s === PAR[h] - 1 && (p.scores as number[])[h - 1] >= PAR[h - 1] + 2)).map((p) => p.display_name);

const S = {
  th: { color: C.gold, fontSize: 11, fontWeight: 800, letterSpacing: 1.2, marginBottom: 4 } as React.CSSProperties,
  box: { background: C.greenMid, borderRadius: 10, padding: "8px 12px" } as React.CSSProperties,
  row: { display: "flex", alignItems: "flex-start", gap: 8, paddingTop: 4, paddingBottom: 4, borderTop: `1px solid ${C.green}`, fontSize: 13, color: C.cream, lineHeight: 1.3 } as React.CSSProperties,
  tile: { background: C.greenMid, borderRadius: 10, padding: "8px 12px", display: "flex", flexDirection: "column" } as React.CSSProperties,
  tl: { color: C.sage, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 } as React.CSSProperties,
  tw: { fontSize: 13.5, color: C.cream, fontWeight: 800 } as React.CSSProperties,
  tv: { color: C.gold, fontSize: 12, fontWeight: 700 } as React.CSSProperties,
};
const Tile = ({ label, who, what }: { label: string; who: string; what: string }) => <div style={S.tile}><span style={S.tl}>{label}</span><b style={S.tw}>{who}</b><span style={S.tv}>{what}</span></div>;
const andList = (xs: string[]) => xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

/** PROPOSED — the sections added below the current body (app and email). Money: never. */
export function ProposedSections() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
      <div style={S.box} data-mock-segments>
        <div style={S.th}>SEGMENTS · THREE SIXES · STABLEFORD POINTS</div>
        {segs.map((s) => (
          <div key={s.label} style={S.row}><span style={{ color: C.gold, fontWeight: 800, minWidth: 64 }}>{s.label}</span><span style={{ flex: 1 }}>{andList(s.who)}{s.who.length > 1 ? " tied" : ""}</span><span style={{ fontFamily: "Georgia, serif", fontWeight: 800, fontSize: 16 }}>{s.val} pts</span></div>
        ))}
        <div style={{ color: C.sage, fontSize: 12, marginTop: 4 }}>{segs.every((s) => s.who.length === 1 && s.who[0] === segs[0].who[0]) ? `${segs[0].who[0]} swept all three.` : "Three different segments, three winners — points only, no money."}</div>
      </div>
      <div style={S.box} data-mock-contests>
        <div style={S.th}>SIDE CONTESTS</div>
        {contests.map((c) => <div key={c.label} style={S.row}><span style={{ flex: 1 }}>{c.label} · hole {c.hole}</span><b>{c.name}</b><span style={{ color: C.gold, fontWeight: 700 }}>{c.value}</span></div>)}
      </div>
      <div>
        <div style={S.th}>STATS · 8 OF 8 ENTERED</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <Tile label="Fewest putts" who={andList(putts.who)} what={`${putts.v} putts`} />
          <Tile label="Most fairways hit" who={andList(fairways.who)} what={`${fairways.v} of 14`} />
          <Tile label="Longest run of par or better" who={andList(streak.who)} what={`${streak.v} holes in a row`} />
          <Tile label="Bounce-back birdie" who={bounce.length ? andList(bounce) : "—"} what={bounce.length ? "birdie straight after a double" : "none today"} />
        </div>
      </div>
    </div>
  );
}

/** PROPOSED — the one-screen share image: headline, the result, and the day's four strongest moments (by priority). */
export function ProposedShare({ recap }: { recap: ReturnType<typeof buildRecap> }) {
  const lb = recap.sections.leaderboard;
  return (
    <div style={{ background: C.green, color: C.cream, padding: 16, display: "flex", flexDirection: "column", gap: 10, fontFamily: "system-ui, sans-serif" }}>
      <div><div style={{ color: C.gold, fontSize: 11, letterSpacing: 2, fontWeight: 800 }}>SUNDAY STABLEFORD · OAK HOLLOW · OCT 25</div>
        <div style={{ fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 800, marginTop: 4 }}>{recap.headline}</div></div>
      {lb ? <div style={S.box}><div style={S.th}>TOP 3 · {lb.basis.toUpperCase()}</div>
        {lb.rows.slice(0, 3).map((r) => <div key={r.item.name} style={S.row}><span style={{ color: C.gold, fontWeight: 800, minWidth: 24 }}>{r.pos}</span><span style={{ flex: 1 }}>{r.item.name}</span><span style={{ fontFamily: "Georgia, serif", fontWeight: 800, fontSize: 16 }}>{r.item.score} pts</span></div>)}
      </div> : null}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <Tile label="Segments · three sixes" who={segs.every((s) => s.who[0] === segs[0].who[0]) ? segs[0].who[0] : segs.map((s) => `${s.label.replace("Holes ", "")}: ${s.who.map((w) => w.split(" ")[0]).join(" & ")}`).join(" · ")} what={segs.every((s) => s.who[0] === segs[0].who[0]) ? "swept all three" : `${segs.map((s) => s.val).join(" · ")} pts`} />
        <Tile label="Closest to the pin · 12" who="Amit Sud" what="4 ft 3 in" />
        <Tile label="Fewest putts" who={andList(putts.who)} what={`${putts.v} putts`} />
        <Tile label="Longest run of par or better" who={andList(streak.who)} what={`${streak.v} holes`} />
      </div>
      <div style={{ color: C.sage, fontSize: 11 }}>Full recap in the app · Birdie Num Num</div>
    </div>
  );
}

/** v2 (owner, Oct 29: "i like 31 … flex Net birdies to top 3 if we need space (or eliminate it entirely)"): the current share
 *  layout with Segments and Side contests as boxes after the tiles, four stats / streak tiles in the grid, net birdies top 3. */
const statTiles = [
  { label: "Fewest putts", who: andList(putts.who), what: `${putts.v} putts` },
  { label: "Most fairways", who: andList(fairways.who), what: `${fairways.v} of 14` },
  { label: "Longest par streak", who: andList(streak.who), what: `${streak.v} holes` },
  ...(bounce.length ? [{ label: "Bounce-back birdie", who: andList(bounce), what: "birdie straight after a double" }] : []),
];
const SegmentsBox = () => (
  <div style={S.box} data-mock-segments>
    <div style={S.th}>SEGMENTS · THREE SIXES</div>
    {segs.map((s) => <div key={s.label} style={S.row}><span style={{ color: C.gold, fontWeight: 800, minWidth: 64 }}>{s.label.replace("Holes ", "")}</span><span style={{ flex: 1 }}>{andList(s.who)}{s.who.length > 1 ? " tied" : ""}</span><span style={{ fontFamily: "Georgia, serif", fontWeight: 800, fontSize: 16 }}>{s.val} pts</span></div>)}
  </div>
);
const ContestsBox = () => (
  <div style={S.box} data-mock-contests>
    <div style={S.th}>SIDE CONTESTS</div>
    {contests.map((c) => <div key={c.label} style={S.row}><span style={{ flex: 1 }}>{c.label} · hole {c.hole}</span><b>{c.name}</b><span style={{ color: C.gold, fontWeight: 700 }}>{c.value}</span></div>)}
  </div>
);

// v3: the compact forms — segments as a two-line entry in the notes style, contests as today's line, two stat tiles
const SegmentsLine = () => (
  <div style={{ color: C.sage, fontSize: 12.5, lineHeight: 1.4 }} data-mock-segments-line>
    <b style={{ color: C.cream }}>Sixes</b> · {segs.every((x) => x.who.length === 1 && x.who[0] === segs[0].who[0])
      ? <><b style={{ color: C.cream }}>{segs[0].who[0]}</b> swept all three ({segs.map((x) => x.val).join(" · ")} pts)</>
      : <>{segs.map((s, i) => <span key={s.label}>{i ? " · " : ""}{s.label.replace("Holes ", "")} <b style={{ color: C.cream }}>{s.who.map((w) => w.split(" ")[0]).join(" & ")}</b> {s.val}</span>)} pts</>}
  </div>
);
const ContestsLine = () => (
  <div style={{ color: C.sage, fontSize: 12.5, lineHeight: 1.4 }} data-mock-contests-line>
    {contests.map((c, i) => <span key={c.label}>{i ? " · " : ""}{c.label} #{c.hole} <b style={{ color: C.cream }}>{c.name}</b> {c.value}</span>)}
  </div>
);
const twoTiles = statTiles.filter((t) => t.label === "Fewest putts" || t.label.startsWith("Longest par"));

/** The stat tiles are DYNAMIC: only stats the field actually entered, only when they stand out, two at most on the share
 *  (priority: fewest putts if 30 or fewer, longest par streak if 5+, most fairways if 10+, a bounce-back birdie). */
const standoutStatTiles = (max: number) => [
  ...(putts.v <= 30 ? [statTiles[0]] : []),
  ...(streak.v >= 5 ? [statTiles.find((t) => t.label === "Longest par streak")!] : []),
  ...(fairways.v >= 10 ? [statTiles.find((t) => t.label === "Most fairways")!] : []),
  ...(bounce.length ? statTiles.filter((t) => t.label === "Bounce-back birdie") : []),
].slice(0, max);

export function mockups() {
  const recap = buildRecap(game, players, []);
  return {
    "40-recap-share-v6-standouts": <RecapBody game={game} recap={recap} mode="share" contests={[]} netBirdiesTop={3} extraTiles={standoutStatTiles(2)} afterTiles={<><SegmentsLine /><ContestsLine /></>} />,
    "39-recap-share-v5-tiles-tight": <RecapBody game={game} recap={recap} mode="share" contests={[]} netBirdiesTop={3} extraTiles={twoTiles} afterTiles={<><SegmentsLine /><ContestsLine /></>} />,
    "30-recap-current-app": <RecapBody game={game} recap={recap} mode="app" contests={contests} />,
    "31-recap-current-share": <RecapBody game={game} recap={recap} mode="share" contests={contests} />,
  };
}

// ── 212.71: every format's share card from the same field (owner: "go through every format and ensure that the card
// captures the key data"). Teams A = first four, B = last four; 2 v 2 groups; 1 v 1 matchups across the teams.
const teams = [{ key: "A", name: "Reds" }, { key: "B", name: "Blues" }];
const teamed = players.map((p, i) => ({ ...p, team: i < 4 ? "A" : "B", tee_group: i % 4 < 2 ? 1 : 2 }) as Player);
const foursomes = [{ id: "group-1", name: "Group 1", a: ["u0", "u1"], b: ["u4", "u5"] }, { id: "group-2", name: "Group 2", a: ["u2", "u3"], b: ["u6", "u7"] }];
const pairings = [{ a: "u0", b: "u4" }, { a: "u1", b: "u5" }, { a: "u2", b: "u6" }, { a: "u3", b: "u7" }];
const g = (extra: Record<string, unknown>) => ({ ...game, teams: null, pairings: [], foursomes: null, leg_config: null, ...extra }) as unknown as Game;
const altRows = foursomes.flatMap((f) => (["a", "b"] as const).flatMap((side) => REL[Number(f[side][0].slice(1))].map((r, h) => ({ game_id: "g", foursome_id: f.id, side, hole_index: h, strokes: PAR[h] + r }))));
export const formatGames: Record<string, { game: Game; players: Player[]; alt?: unknown[] }> = {
  "stroke": { game: g({ game_type: "stroke", stroke_basis: "net", leg_config: { scheme: "nines", metric: "net", points: {} } }), players },
  "match": { game: g({ game_type: "match", pairings }), players },
  "team-match": { game: g({ game_type: "match", teams, pairings }), players: teamed },
  "fourball": { game: g({ game_type: "fourball", teams, foursomes, team_score_mode: "best_ball", allowance_pct: 85 }), players: teamed },
  "trifecta": { game: g({ game_type: "trifecta", teams, foursomes: foursomes.map((f, i) => ({ ...f, swap: i === 1 })), team_score_mode: "best_ball", allowance_pct: 85 }), players: teamed },
  "alt-shot": { game: g({ game_type: "alt_shot", teams, foursomes, allowance_pct: 50 }), players: teamed, alt: altRows },
  "skins": { game: g({ game_type: "skins", skins_mode: "carryover" }), players },
  "team-skins-11": { game: g({ game_type: "skins", skins_mode: "carryover", teams, pairings }), players: teamed },
  "team-skins-2v2": { game: g({ game_type: "skins", skins_mode: "carryover", teams, foursomes, team_score_mode: "best_ball" }), players: teamed },
};
export function formatMockups() {
  const out: Record<string, React.ReactElement> = {};
  for (const [k, v] of Object.entries(formatGames)) {
    const recap = buildRecap(v.game, v.players, (v.alt ?? []) as never);
    out[`41-share-${k}`] = <RecapBody game={v.game} recap={recap} mode="share" contests={contests} netBirdiesTop={3} />;
  }
  // a Ryder Cup session: four-ball, Eagles v Hawks, the Cup standing after it
  const cupGame = g({ game_type: "fourball", name: "Eagles v Hawks · Four-ball", teams: [{ key: "A", name: "Eagles" }, { key: "B", name: "Hawks" }], foursomes, team_score_mode: "best_ball", allowance_pct: 85 });
  const cupRecap = buildRecap(cupGame, teamed, []);
  out["41-share-cup-session"] = <RecapBody game={cupGame} recap={cupRecap} mode="share" contests={[]} netBirdiesTop={3}
    cup={{ name: "Eagles v Hawks 2026", aName: "Eagles", bName: "Hawks", aColour: "#4A90D9", bColour: "#C9A227", a: "3½", b: "2½", sessionNo: 2, sessionCount: 5, final: false, detail: "8 points left · Eagles need 3½ more to win, Hawks need 4½" }} />;
  return out;
}
