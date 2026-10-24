// Format-specific sections of the game recap (207.2): the second line under the headline, the results
// table each format needs, and that format's highlight tiles. Built ONLY on the engines and the shared
// results library. Ordering rules agreed with the owner: team formats group results by winning team
// (the day's winner first), then largest margin; formats without teams by largest margin; halves and
// splits last; equal margins keep tee order.
import { matchStatus, fourballStatus, altShotStatus, computeTrifecta, computeSkins, computeHeadToHeadSkins, computeTeamBestBallSkins, type SkinPlayer } from "@/lib/golf";
import { fmtSkins } from "@/lib/skins-format";
import { pkey, chBasis, shapeOf, skinsTieOf } from "@/lib/game-shape";
import * as PS from "@/lib/player-scoring";
import { membersOf, altShotInputsFor, playerLookup } from "@/lib/game-results";
import { rankTies, type Ranked, type Highlights } from "@/lib/game-highlights";
import type { AltShotScoreRow } from "@/lib/alt-shot-side-scores";
import type { Game, Player } from "@/lib/game-types";
import { isFullCard } from "@/lib/round-rules";
import { scrambleResults } from "@/lib/scramble-game";

export type MatchRow = { winners: string[]; losers: string[]; result: string; team: string | null; halved: boolean; lead: number; thru: number };
export type SkinRow = { name: string; holes: { n: number; value: number }[]; skins: number };
export type SkinMatchRow = { a: string[]; b: string[]; aSkins: number; bSkins: number; winnerTeam: string | null };
export type Tile = { label: string; who: string; what: string };
export type RecapSections = {
  sub: string | null;
  matches?: { title: string; rows: MatchRow[] };
  skins?: SkinRow[];
  skinMatches?: { title: string; rows: SkinMatchRow[] };
  leaderboard?: { basis: "net" | "gross" | "points"; rows: Ranked<{ name: string; score: number; gross: number }> };
  flights?: { name: string; players: number; rows: Ranked<{ name: string; score: number }> }[];
  pairs?: { gross: Ranked<{ names: string[]; score: number }>; net: Ranked<{ names: string[]; score: number }> };
  individualStats: boolean;      // false for alternate shot (one ball per pair) and scramble (one per team)
  /** 211.1: a scramble's final leaderboard, or its matches. */
  scramble?: { mode: "field" | "match"; gross: boolean; rows: { pos: string; name: string; members: string; gross: number; handicap: number; net: number; toPar: number; thru: number; holes?: number }[]; matches: { name: string; line: string; a: string; b: string }[] };
  tiles: Tile[];
};

const other = (t: string) => (t === "A" ? "B" : "A");
const byMargin = (a: { lead: number; thru: number }, b: { lead: number; thru: number }) => Math.abs(b.lead) - Math.abs(a.lead) || a.thru - b.thru;
/** Team results: the day's winner first, then the other side, then halves; largest margin first in each. */
export function orderTeamRows<T extends { team: string | null; halved: boolean; lead: number; thru: number }>(rows: T[], dayWinner: string): T[] {
  const s = (t: string | null) => rows.filter((r) => !r.halved && r.team === t).sort(byMargin);
  return [...s(dayWinner), ...s(other(dayWinner)), ...rows.filter((r) => r.halved)];
}
export function orderByMargin<T extends { halved: boolean; lead: number; thru: number }>(rows: T[]): T[] {
  return [...rows.filter((r) => !r.halved).sort(byMargin), ...rows.filter((r) => r.halved)];
}
const toRow = (aNames: string[], bNames: string[], teamA: string | null, lead: number, thru: number, result: string): MatchRow =>
  lead === 0 ? { winners: aNames, losers: bNames, result: "AS", team: null, halved: true, lead, thru }
  : lead > 0 ? { winners: aNames, losers: bNames, result, team: teamA, halved: false, lead, thru }
  : { winners: bNames, losers: aNames, result, team: teamA ? other(teamA) : null, halved: false, lead, thru };
/** Comeback: the largest deficit a match winner (or halver) overturned, replaying the engine hole by hole. */
function comeback(game: Game, statusAt: (k: number) => number, final: number, aNames: string[], bNames: string[]) {
  const n = game.holes_meta?.length ?? 18; let minA = 0, maxA = 0;
  for (let k = 1; k <= n; k++) { const l = statusAt(k); minA = Math.min(minA, l); maxA = Math.max(maxA, l); }
  // Either side may have come back to a halve; the larger deficit is the story.
  const a = final >= 0 && minA <= -2 ? { who: aNames, down: -minA, vs: bNames, halved: final === 0 } : null;
  const b = final <= 0 && maxA >= 2 ? { who: bNames, down: maxA, vs: aNames, halved: final === 0 } : null;
  return a && b ? (a.down >= b.down ? a : b) : a ?? b;
}
const truncate = (players: Player[], k: number) => players.map((p) => ({ ...p, scores: (p.scores || []).map((x, i) => (i < k ? x : null)) })) as Player[];
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : w.endsWith("h") ? "es" : "s"}`;
/** "6 of 10 singles went to the 18th" — or "none of the 4 singles…" when none did. */
const toLast = (k: number, of: number, what: string, holes: number) => k === 0 ? `none of the ${of} ${what} went to the ${holes}th` : `${k} of ${of} ${what} went to the ${holes}th`;
/** "A", "A and B", "A, B and C". */
export const andList = (xs: string[]) => xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

export function buildRecapSections(game: Game, players: Player[], altShotScores: AltShotScoreRow[], h: Highlights, teamResult: { winner: string | null } | null): RecapSections {
  const shape = shapeOf(game);
  const holes = game.holes_meta?.length ?? 18;
  const playerOf = playerLookup(players);
  const nm = (k: string) => playerOf(k)?.display_name ?? "?";
  const teamName = (k: string | null) => (Array.isArray(game.teams) ? game.teams.find((t: any) => t.key === k)?.name : null) ?? k ?? "";
  const ch = (p: Player) => chBasis(p, game.course_par, holes);
  const tiles: Tile[] = [];
  const common = () => {
    if (h.bestNetHole) tiles.push({ label: "Best net hole", who: h.bestNetHole.name, what: `${h.bestNetHole.grossVsPar <= -2 ? "eagle" : h.bestNetHole.grossVsPar === -1 ? "birdie" : h.bestNetHole.grossVsPar === 0 ? "par" : "bogey"} on ${h.bestNetHole.n} · net ${h.bestNetHole.netVsPar <= -2 ? "eagle" : "birdie"}` });
    if (h.mostParsOrBetter) tiles.push({ label: "Most pars or better", who: h.mostParsOrBetter.names.join(" · "), what: String(h.mostParsOrBetter.count) });
  };
  const out: RecapSections = { sub: null, individualStats: true, tiles };
  if (game.game_type === "scramble") {
    // 211.1: team scores only — no individual stats; the same results as the game screen.
    const r = scrambleResults(game, players, altShotScores);
    out.individualStats = false;
    out.scramble = { mode: r.mode, gross: r.gross, matches: r.matches.map((m) => ({ name: m.name, line: m.line, a: `${m.a.name}: ${m.a.memberNames.join(" & ")}`, b: `${m.b.name}: ${m.b.memberNames.join(" & ")}` })),
      rows: r.board.filter((b) => b.thru > 0).map((b) => ({ pos: b.pos, name: b.name, members: (r.teams.find((x) => x.key === b.key)?.memberNames || []).join(", "),
        gross: b.gross, handicap: b.handicap, net: b.net, toPar: r.gross ? b.grossToPar : b.netToPar, thru: b.thru, holes: Array.isArray(game.holes_meta) ? game.holes_meta.length : 18 })) };
    out.sub = r.mode === "match" ? `Team v team scramble · ${r.matches.length} match${r.matches.length === 1 ? "" : "es"}` : `${r.teams.length} teams · ${r.gross ? "gross" : "net, USGA scramble allowance"}`;
    return out;
  }
  const dayWinner = teamResult?.winner ?? "A";
  let best: { who: string[]; down: number; vs: string[]; halved: boolean } | null = null;
  const consider = (c: typeof best) => { if (c && (!best || c.down > best.down)) best = c; };

  // ---- Singles match play (with or without teams) ----
  if (game.game_type === "match") {
    const rows: MatchRow[] = [];
    (game.pairings || []).forEach((pr) => {
      const pa = playerOf(pr.a), pb = playerOf(pr.b); if (!pa || !pb) return;
      const st = matchStatus(game.holes_meta, pa.scores || [], pb.scores || [], ch(pa), ch(pb), game.allowance_pct ?? 100);
      if (!st.result) return;
      rows.push(toRow([pa.display_name], [pb.display_name], shape.usesTeams ? pa.team ?? null : null, st.lead, st.thru, st.result));
      consider(comeback(game, (k) => matchStatus(game.holes_meta, (pa.scores || []).map((x, i) => (i < k ? x : null)), (pb.scores || []).map((x, i) => (i < k ? x : null)), ch(pa), ch(pb), game.allowance_pct ?? 100).lead, st.lead, [pa.display_name], [pb.display_name]));
    });
    const to18 = rows.filter((r) => r.thru === holes).length, halves = rows.filter((r) => r.halved).length;
    out.matches = { title: shape.usesTeams ? "THE SINGLES" : "THE RESULTS", rows: shape.usesTeams ? orderTeamRows(rows, dayWinner) : orderByMargin(rows) };
    out.sub = `${toLast(to18, rows.length, "singles", holes)}${!shape.usesTeams && halves ? ` · ${halves === 1 ? "one" : halves} halved` : ""}`;
    out.sub = out.sub.charAt(0).toUpperCase() + out.sub.slice(1);
    const big = orderByMargin(rows)[0];
    if (big && !big.halved) { const ties = rows.filter((r) => !r.halved && r.lead !== 0 && Math.abs(r.lead) === Math.abs(big.lead) && r.thru === big.thru); tiles.push({ label: ties.length > 1 ? "Biggest wins" : "Biggest win", who: ties.map((r) => r.winners.join(" & ")).join(" · "), what: big.result + (ties.length > 1 ? " each" : "") }); }
    if (shape.usesTeams && teamResult?.winner) {
      const lose = rows.filter((r) => !r.halved && r.team === other(teamResult.winner!));
      if (lose.length === 1) tiles.push({ label: `${teamName(other(teamResult.winner))}'s only win`, who: lose[0].winners.join(" & "), what: `${lose[0].result} over ${lose[0].losers.join(" & ")}` });
    }
  }
  // ---- Four-ball / alternate shot (with or without teams) ----
  if (game.game_type === "fourball" || game.game_type === "alt_shot") {
    const isAlt = game.game_type === "alt_shot";
    const rows: MatchRow[] = [];
    const pairScores: { names: string[]; gross: number; net: number }[] = [];
    (game.foursomes || []).forEach((f: any) => {
      if (!f.a?.length || !f.b?.length) return;
      const teamA = shape.usesTeams ? playerOf(f.a[0])?.team ?? null : null;
      const aN = f.a.map(nm), bN = f.b.map(nm);
      if (isAlt) {
        const alt = altShotInputsFor(game, players, altShotScores, f); if (!alt) return;
        const st = altShotStatus(game.holes_meta, alt.a as never, alt.b as never);
        if (!st.thru) return;
        const res = (st as any).result || (Math.abs(st.lead) > holes - st.thru ? `${Math.abs(st.lead)} & ${holes - st.thru}` : `${Math.abs(st.lead)} UP`);
        rows.push(toRow(aN, bN, teamA, st.lead, st.thru, res));
        const g = (x: (number | null)[]) => isFullCard(x, x.length) ? (x as number[]).reduce((s, v) => s + v, 0) : null;
        const ag = g(alt.a.gross as never), bg = g(alt.b.gross as never);
        if (ag != null) pairScores.push({ names: aN, gross: ag, net: ag - Math.round(alt.a.chs[0] as number) });
        if (bg != null) pairScores.push({ names: bN, gross: bg, net: bg - Math.round(alt.b.chs[0] as number) });
      } else {
        const mode = game.team_score_mode === "aggregate" ? "aggregate" : "best_ball";
        const st = fourballStatus(game.holes_meta, membersOf(game, players, f), f.a, f.b, game.allowance_pct ?? 100, mode);
        const decided = st.thru === holes || Math.abs(st.lead) > holes - st.thru;
        if (!decided) return;
        const res = st.thru < holes ? `${Math.abs(st.lead)} & ${holes - st.thru}` : st.lead === 0 ? "AS" : `${Math.abs(st.lead)} UP`;
        rows.push(toRow(aN, bN, teamA, st.lead, st.thru, res));
        consider(comeback(game, (k) => fourballStatus(game.holes_meta, membersOf(game, truncate(players, k), f), f.a, f.b, game.allowance_pct ?? 100, mode).lead, st.lead, aN, bN));
      }
    });
    const label = isAlt ? "alternate-shot" : "four-ball";
    out.matches = { title: shape.usesTeams ? "THE MATCHES" : "THE RESULTS", rows: shape.usesTeams ? orderTeamRows(rows, dayWinner) : orderByMargin(rows) };
    const to18 = rows.filter((r) => r.thru === holes).length;
    if (shape.usesTeams && teamResult?.winner) { const w = rows.filter((r) => r.team === teamResult.winner).length; out.sub = w === rows.length ? `${teamName(teamResult.winner)} swept all ${rows.length} ${label} matches` : `${teamName(teamResult.winner)} won ${w} of the ${rows.length} ${label} matches`; }
    else if (shape.usesTeams) { const a = rows.filter((r) => r.team === "A").length, b = rows.filter((r) => r.team === "B").length, hv = rows.filter((r) => r.halved).length;
      out.sub = `${teamName("A")} won ${a}, ${teamName("B")} won ${b}${hv ? `, ${hv} halved` : ""} — the ${label} matches were shared`; }
    else out.sub = `Pair against pair · ${to18 === 0 ? "none" : to18 === 1 ? "one" : to18} went to the ${holes}th`;
    const big = orderByMargin(rows)[0]; if (big && !big.halved) tiles.push({ label: "Biggest win", who: big.winners.join(" & "), what: big.result });
    const dist = rows.filter((r) => r.thru === holes && !r.halved); if (dist.length === 1) tiles.push({ label: "Went the distance", who: dist[0].winners.join(" & "), what: `${dist[0].result} on ${holes}` });
    if (isAlt) {
      out.individualStats = false;
      const gross = [...pairScores].sort((a, b) => a.gross - b.gross), net = [...pairScores].sort((a, b) => a.net - b.net);
      out.pairs = { gross: rankTies(gross.map((p) => ({ names: p.names, score: p.gross })), (x) => x.score, 3), net: rankTies(net.map((p) => ({ names: p.names, score: p.net })), (x) => x.score, 3) };
    }
  }
  // ---- Trifecta (team): the singles count; tiles from the singles ----
  if (game.game_type === "trifecta") {
    let singles = 0, to18 = 0;
    (game.foursomes || []).forEach((f: any) => {
      if (!f.a?.length || !f.b?.length) return;
      const mode = game.team_score_mode === "aggregate" ? "aggregate" : "best_ball";
      const r = computeTrifecta(game.holes_meta, membersOf(game, players, f), f.a, f.b, game.allowance_pct ?? 100, mode, !!f.swap);
      (r.contests as any[]).forEach((c, ci) => {
        if (c.kind !== "single" || !c.settled) return;
        singles++; if (c.thru === holes) to18++;
        const aN = c.aIds.map(nm), bN = c.bIds.map(nm);
        consider(comeback(game, (k) => (computeTrifecta(game.holes_meta, membersOf(game, truncate(players, k), f), f.a, f.b, game.allowance_pct ?? 100, mode, !!f.swap).contests as any[])[ci].lead, c.lead, aN, bN));
      });
    });
    out.sub = toLast(to18, singles, "singles", holes); out.sub = out.sub.charAt(0).toUpperCase() + out.sub.slice(1);
  }
  // ---- Skins ----
  if (game.game_type === "skins") {
    const sp = (k: string): SkinPlayer | null => { const p = playerOf(k); return p ? { id: k, name: p.display_name, gross: p.scores || [], ch: ch(p), noShow: !!p.no_show } : null; };
    if (shape.skinsStyle === "team_2v2" || (shape.skinsStyle === "team_11" && (game.pairings || []).length)) {
      const rows: SkinMatchRow[] = [];
      if (shape.skinsStyle === "team_2v2") (game.foursomes || []).forEach((f: any) => {
        if (!f.a?.length || !f.b?.length) return;
        const r = computeTeamBestBallSkins(game.holes_meta, membersOf(game, players, f), f.a, f.b, game.allowance_pct ?? 100, game.team_score_mode === "aggregate" ? "aggregate" : "best_ball", skinsTieOf(game));
        const ta = playerOf(f.a[0])?.team ?? "A"; const a = r.skinsBySide.a || 0, b = r.skinsBySide.b || 0;
        rows.push({ a: f.a.map(nm), b: f.b.map(nm), aSkins: a, bSkins: b, winnerTeam: a === b ? null : a > b ? ta : other(ta) });
      });
      else (game.pairings || []).forEach((pr) => {
        const pa = sp(pr.a), pb = sp(pr.b); if (!pa || !pb) return;
        const r = computeHeadToHeadSkins(game.holes_meta, pa, pb, game.allowance_pct ?? 100, skinsTieOf(game));
        const ta = playerOf(pr.a)?.team ?? "A"; const a = r.skinsBySide[pr.a] || 0, b = r.skinsBySide[pr.b] || 0;
        rows.push({ a: [pa.name], b: [pb.name], aSkins: a, bSkins: b, winnerTeam: a === b ? null : a > b ? ta : other(ta) });
      });
      const won = (t: string) => rows.filter((r) => r.winnerTeam === t).length, split = rows.filter((r) => !r.winnerTeam).length;
      const mg = (r: SkinMatchRow) => -Math.abs(r.aSkins - r.bSkins);
      const ord = [...rows.filter((r) => r.winnerTeam === dayWinner).sort((x, y) => mg(x) - mg(y)), ...rows.filter((r) => r.winnerTeam === other(dayWinner)).sort((x, y) => mg(x) - mg(y)), ...rows.filter((r) => !r.winnerTeam)];
      out.skinMatches = { title: shape.skinsStyle === "team_2v2" ? "THE GROUPS · SKINS" : "THE HEAD-TO-HEADS · SKINS", rows: ord };
      out.sub = shape.skinsStyle === "team_2v2" ? `Groups: ${teamName("A")} ${won("A")} · ${teamName("B")} ${won("B")}${split ? ` · ${split} split` : ""}`
        : `${teamName(dayWinner)} won ${won(dayWinner)} of ${rows.length} head-to-heads · ${teamName(other(dayWinner))} ${won(other(dayWinner))}${split ? ` · ${split} split` : ""}`;
      const top = ord[0]; if (top && top.winnerTeam) { const w = top.aSkins > top.bSkins; tiles.push({ label: shape.skinsStyle === "team_2v2" ? "Biggest group win" : "Most skins in a match", who: (w ? top.a : top.b).join(" & "), what: `${fmtSkins(Math.max(top.aSkins, top.bSkins))}–${fmtSkins(Math.min(top.aSkins, top.bSkins))}` }); }
    } else {
      const r = computeSkins(game.holes_meta, players.map((p) => ({ id: pkey(p), name: p.display_name, gross: p.scores || [], ch: ch(p) })), game.allowance_pct ?? 100, game.skins_mode === "split" ? "split" : "carryover");
      const byWinner = new Map<string, SkinRow>();
      // 212.37: with ties halved a tied hole has no single winner — it is SHARED (splitIds), each taking an equal part.
      // Only outright winners were credited, so the body said "Raj 1 skin" under a headline of "Raj won 6⅔ skins".
      const credit = (id: string, n: number, value: number) => { const row = byWinner.get(id) || { name: nm(id), holes: [], skins: 0 }; row.holes.push({ n, value }); row.skins += value; byWinner.set(id, row); };
      (r.holes as any[]).forEach((hh) => {
        if (hh.winnerId) credit(hh.winnerId, hh.hole, hh.value);
        else if (Array.isArray(hh.splitIds) && hh.splitIds.length) hh.splitIds.forEach((id: string) => credit(id, hh.hole, hh.value / hh.splitIds.length));
      });
      out.skins = Array.from(byWinner.values()).sort((a, b) => b.skins - a.skins || a.name.localeCompare(b.name));
      const pot = (r.holes as any[]).filter((x) => x.winnerId).sort((a, b) => b.value - a.value)[0];
      // longest run of carried holes
      // (212.37: a shared hole is settled, not carried — and halved skins never carry)
      let run = 0, bestRun = 0, endAt = 0; (r.holes as any[]).forEach((x) => { run = x.winnerId || (x.splitIds && x.splitIds.length) ? 0 : run + 1; if (run > bestRun) { bestRun = run; endAt = x.hole; } });
      if (pot && pot.value >= 3) out.sub = `A ${pot.value}-skin pot on ${pot.hole}${pot.carriedIn >= 2 ? ` after ${plural(pot.carriedIn, "straight hole")} carried` : ""}`;
      if (pot && pot.value >= 2) tiles.push({ label: "Biggest pot", who: nm(pot.winnerId), what: `${pot.value} skins on #${pot.hole}` });
      if (bestRun >= 3) tiles.push({ label: "Longest carry", who: `Holes ${endAt - bestRun + 1}–${endAt}`, what: `${bestRun} holes in a row` });
    }
  }
  // ---- Stroke play / Stableford: leaderboard by the game's own basis; flights ----
  if (game.game_type === "stroke" || game.game_type === "stableford") {
    const isStroke = game.game_type === "stroke";
    const basis: "net" | "gross" | "points" = isStroke ? (game.stroke_basis === "gross" ? "gross" : "net") : "points";
    const fin = players.filter((p) => !p.no_show && PS.playerThru(p) >= holes);
    const score = (p: Player) => (isStroke ? PS.strokeTotal(p, game) : PS.playerPoints(p, game));
    const gross = (p: Player): number => (p.scores || []).reduce<number>((s, x) => s + (Number(x) || 0), 0);
    const board = PS.sortLeaderboard(fin, game);
    out.leaderboard = { basis, rows: rankTies(board.map((p) => ({ name: p.display_name, score: score(p), gross: gross(p) })), (x) => x.score, 5) };
    const flightDefs: { key: string; name: string; hi: number | null }[] = Array.isArray((game as any).flights) ? (game as any).flights : [];
    if ((game as any).flight_mode === "oneoff" && flightDefs.length) {
      out.flights = flightDefs.map((b) => { const inF = board.filter((p) => (p as any).flight === b.key); return { name: b.name, players: inF.length, rows: rankTies(inF.map((p) => ({ name: p.display_name, score: score(p) })), (x) => x.score, 3) }; }).filter((f) => f.players > 0);
    }
    const lb = out.leaderboard!.rows;
    if (lb.length >= 2 && !out.flights) { const gap = Math.abs(lb[1].item.score - lb[0].item.score); out.sub = gap === 0 ? "Tied at the top" : isStroke ? `${gap === 1 ? "one shot" : `${gap} shots`} clear` : `${gap === 1 ? "one point" : `${gap} points`} clear`; }
    if (out.flights && lb[0]) out.sub = `${lb[0].item.name}'s ${lb[0].item.score} ${isStroke ? "" : "points "}was the best in the field`.replace("  ", " ");
    if (h.topGross[0] && basis !== "gross") tiles.push({ label: "Best gross", who: h.topGross.filter((r) => r.pos === h.topGross[0].pos).map((r) => r.item.name).join(" · "), what: String(h.topGross[0].item.score) });
  }
  if (best && (best as { down: number }).down >= 2) { const b = best as { who: string[]; down: number; vs: string[]; halved: boolean }; tiles.push({ label: "Comeback", who: b.who.join(" & "), what: b.halved ? `halved from ${b.down} down` : `won from ${b.down} down` }); }
  if (out.individualStats) common();
  if (h.bestGroup && tiles.length < 4) tiles.push({ label: "Best group", who: `Group ${h.bestGroup.group}`, what: `net ${h.bestGroup.avgNet.toFixed(1)} avg` });
  out.tiles = tiles.slice(0, 4);
  return out;
}
