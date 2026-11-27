/**
 * Games list — the richer row (212.126, owner, Nov 18): "we should add some more description like how many players,
 * once the game is FINAL, the person score and stableford points, differential, perhaps some summary stats".
 * Rules already decided: no money in any summary (game recap rule); shared-ball formats (scramble, alternate shot) show
 * the team result, no personal score or differential (shared-ball rule); the list only shows games the viewer plays in.
 * Everything is derived from what the app already computes: the viewer's posted round for the game (the Rounds tab's
 * figures) and the standings engine's per-game ranking — no new scoring arithmetic.
 */
import type { Game, Player } from "@/lib/game-types";
import { allocateStrokes, strokesOf, diffOf, toParStr, stablefordDisplay, roundDifferential, type Round } from "@/lib/golf";
import { gameTypeLabel } from "@/lib/game-create";
import * as PS from "@/lib/player-scoring";
import { matchOutcomes } from "@/lib/match-outcomes";
import { skinsTotals, singlesTeamStandings, foursomeTeamStandings, trifectaResults } from "@/lib/game-results";
import { pkey } from "@/lib/game-shape";
import { colosseumStandings, fmtHalf } from "@/lib/colosseum";
import type { TeamRound } from "@/lib/team-rounds";

const SHARED_BALL = new Set(["scramble", "alt_shot"]);
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;

/** A detail line; `value` (a match result) sits in the row's results column, level with its text. */
export type Line = { text: string; value?: string };
export type GameResult = { result: string | null; caption: string | null; lines: Line[] };
const NONE: GameResult = { result: null, caption: null, lines: [] };
const names = (side: { name: string; userId: string | null }[], skip?: string) => side.filter((x) => x.userId !== skip).map((x) => x.name).join(" & ");

/**
 * The viewer's result in an ENDED game (212.127, owner: "Won 3&2 or Lost 2up instead of Won / Lost"; trifecta "W-L-H
 * and the result underneath … what did I win and what did I lose?"):
 *  - Stableford / stroke play: the place among finishers ("2nd of 8", "T2nd of 8").
 *  - one match (best ball, match play, alternate shot): "Won 3&2" / "Lost 2 up" / "Halved", and a line with the opponents.
 *  - several matches (trifecta): caption "W-L-H" over "1-1-0", and one line per match: "Singles: Won 3&2 v Karan".
 *  - skins: the viewer's skins (a count of holes won — never money).
 */
export function gameResultFor(game: Game, players: Player[], userId: string): GameResult {
  if (game.status !== "ended") return NONE;
  const holes = game.holes_meta?.length ?? 18;
  const finishers = players.filter((p) => !p.no_show && PS.playerThru(p) >= holes);
  const meP = players.find((p) => p.user_id === userId);
  if (game.game_type === "stableford" || game.game_type === "stroke") {
    const me = finishers.find((p) => p.user_id === userId);
    if (!me) return meP ? { ...NONE, lines: [{ text: meP.no_show ? "Marked as a no-show" : "Your card wasn't completed, so there's no place" }] } : NONE;
    if (finishers.length < 2) return NONE;
    const pos = PS.posWithin(me, finishers, game);
    const tied = finishers.some((p) => p !== me && PS.posWithin(p, finishers, game) === pos);
    return { ...NONE, result: `${tied ? "T" : ""}${ordinal(pos)} of ${finishers.length}` };
  }
  if (game.game_type === "colosseum") {   // 212.136: place in the table and the record, from the same engine as the game screen
    if (!meP) return NONE;
    if (meP.no_show) return { ...NONE, lines: [{ text: "Marked as a no-show" }] };
    const st = colosseumStandings(game, players);
    const row = st.rows.find((r) => r.key === pkey(meP));
    if (!row || !row.played) return { ...NONE, lines: [{ text: "No match was played" }] };
    const tied = st.rows.some((r) => r !== row && r.rank === row.rank);
    return { result: `${tied ? "T" : ""}${ordinal(row.rank)} of ${st.rows.length}`, caption: null, lines: [{ text: `${row.won}-${row.lost}-${row.halved} W-L-H · ${fmtHalf(row.points)} pt${row.points === 1 ? "" : "s"}` }] };
  }
  if (game.game_type === "skins") {
    if (!meP) return NONE;
    const t = skinsTotals(game, players);
    const mine = t.byPlayer[pkey(meP)] || 0;
    const team = t.byTeam && (meP.team === "A" || meP.team === "B") ? t.byTeam[meP.team] : null;
    if (meP.no_show) return { ...NONE, lines: [{ text: "Marked as a no-show" }] };
    return { ...NONE, result: team != null ? `Team ${team} skin${team === 1 ? "" : "s"}` : `${mine} skin${mine === 1 ? "" : "s"}`, lines: team != null ? [{ text: "Your skins", value: String(mine) }] : [] };
  }
  if (game.game_type === "fourball" || game.game_type === "trifecta" || game.game_type === "match" || game.game_type === "alt_shot") {
    if (meP?.no_show) return { ...NONE, lines: [{ text: "Marked as a no-show" }] };
    const mine: { word: "Won" | "Lost" | "Halved"; text: string; line: string; kind: string }[] = [];
    for (const m of matchOutcomes(game, players)) {
      const side = m.a.some((x) => x.userId === userId) ? "a" : m.b.some((x) => x.userId === userId) ? "b" : null;
      if (!side) continue;
      const word = m.winner === "halved" ? "Halved" : m.winner === side ? "Won" : "Lost";
      const text = word === "Halved" ? "Halved" : `${word}${m.margin ? " " + m.margin : ""}`;
      const opp = names(m[side === "a" ? "b" : "a"]); const partner = names(m[side], userId);
      mine.push({ word, text, kind: m.kind, line: `v ${opp}${partner ? ` · with ${partner}` : ""}` });
    }
    const team = meP ? teamResultLine(game, players, meP) : null;
    if (!mine.length) {
      if (team) return { ...NONE, lines: [team] };
      return meP && game.game_type !== "alt_shot" ? { ...NONE, lines: [{ text: "No match was decided" }] } : NONE;
    }
    if (mine.length === 1) return { result: mine[0].text, caption: null, lines: [{ text: mine[0].line }, ...(team ? [team] : [])] };
    const c = (w: string) => mine.filter((x) => x.word === w).length;
    const label = (k: string) => (k === "singles" ? "Singles" : "Four-ball");
    return { result: `${c("Won")}-${c("Lost")}-${c("Halved")}`, caption: "W-L-H", lines: [...mine.map((x) => ({ text: `${label(x.kind)} ${x.line}`, value: x.text })), ...(team ? [team] : [])] };
  }
  return NONE;
}

/** The viewer's own line from their posted round: gross (to par) · Stableford · differential · net birdies. */
export function myRoundLine(r: Round): string | null {
  const scored = (r.holes || []).filter((h) => h.strokes != null && h.strokes > 0);
  if (!scored.length) return null;
  const parts = [`Gross ${strokesOf(r)} (${toParStr(diffOf(r))})`];
  const pts = stablefordDisplay(r); if (pts !== "—") parts.push(pts);
  const diff = roundDifferential(r); if (diff != null) parts.push(`Diff ${diff.toFixed(1)}`);
  const alloc = allocateStrokes(scored.map((h) => ({ hole_number: h.hole_number, stroke_index: h.stroke_index ?? null })), r.course_handicap == null ? null : Math.round(Number(r.course_handicap)));
  const nb = scored.filter((h) => h.par != null && (h.strokes || 0) - (alloc[h.hole_number] || 0) - (h.par || 0) <= -1).length;
  if (nb) parts.push(`${nb} net birdie${nb === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

const half = (n: number) => (Number.isInteger(n) ? String(n) : `${Math.floor(n) || ""}½`);
/** Two-team games (team match play, best ball, trifecta with two teams): how YOUR team did overall, from the same
 *  standings the game screen shows (lib/game-results). Local foursomes without two teams have no team total. */
export function teamResultLine(game: Game, players: Player[], me: Player): Line | null {
  const teams = game.teams || [];
  if (teams.length !== 2 || (me.team !== "A" && me.team !== "B")) return null;
  let pts: Record<string, number> | null = null;
  if (game.game_type === "match") pts = singlesTeamStandings(game, players).pts;
  else if (game.game_type === "fourball") pts = foursomeTeamStandings(game, players, []).pts;
  else if (game.game_type === "trifecta") pts = trifectaResults(game, players, [teams[0].key, teams[1].key] as [string, string]).pts;
  if (!pts) return null;
  const mineK = me.team, otherK = mineK === "A" ? "B" : "A";
  const a = pts[mineK] ?? 0, b = pts[otherK] ?? 0;
  if (!a && !b) return null;
  const myName = teams[mineK === "A" ? 0 : 1]?.name || "Your team";
  const word = a > b ? "Won" : a < b ? "Lost" : "Tied";
  return { text: `Team · ${myName}`, value: `${word} ${half(a)}–${half(b)}` };
}

/** Format names as members write them in a game's title. */
const FORMAT_WORDS: Record<string, string[]> = {
  stableford: ["stableford"], stroke: ["stroke play", "stroke", "medal"], match: ["match play", "match"], fourball: ["four-ball", "fourball", "four ball", "best ball", "bestball"],
  trifecta: ["trifecta"], skins: ["skins"], scramble: ["scramble"], alt_shot: ["alternate shot", "alt shot", "foursomes"], colosseum: ["colosseum"],
};
const COURSE_SUFFIX = /\s+(golf course|golf club|country club|golf links|gc|cc|g\.c\.|c\.c\.)$/i;
/** Does the title already say this? (212.127, owner: "if the title already has the game type, course name, date …
 *  including this again in the description is redundant. If it is a custom name … include them") */
export function titleMentions(name: string, what: "format" | "course" | "date", game: Game): boolean {
  const n = (name || "").toLowerCase();
  if (what === "format") return (FORMAT_WORDS[game.game_type] ?? [String(game.game_type)]).some((w) => n.includes(w));
  if (what === "course") {
    const c = (game.course || "").toLowerCase().trim(); if (!c) return true;
    const core = c.replace(COURSE_SUFFIX, "").trim();
    return n.includes(c) || (core.length >= 4 && n.includes(core));
  }
  const day = (game as { played_at?: string | null }).played_at || game.created_at; if (!day) return true;
  const d = new Date(String(day).slice(0, 10) + "T12:00:00");
  const mShort = d.toLocaleDateString("en-US", { month: "short" }).toLowerCase(), mLong = d.toLocaleDateString("en-US", { month: "long" }).toLowerCase(), dd = d.getDate(), mm = d.getMonth() + 1;
  return [`${mShort} ${dd}`, `${mLong} ${dd}`, `${mm}/${dd}`, `${mm}-${dd}`, `${dd} ${mShort}`].some((t) => n.includes(t));
}

export type GameRowSummary = { meta: string; result: string | null; caption: string | null; lines: Line[] };

/** Everything the row shows beyond its name: what the title doesn't already say, players, the headline result
 *  (with a caption for a record), and the detail lines — the matches, then your own line. */
export function gameRowSummary(game: Game, players: Player[], userId: string, myRound: Round | null, teamRound: TeamRound | null): GameRowSummary {
  const n = players.filter((p) => !p.no_show).length;
  const ended = game.status === "ended";
  const day = (game as { played_at?: string | null }).played_at || game.created_at;   // played_at is on the row, not yet on the Game type
  const date = day ? new Date(String(day).slice(0, 10) + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;
  const meta = [
    titleMentions(game.name, "format", game) ? null : gameTypeLabel(game.game_type as Parameters<typeof gameTypeLabel>[0]),
    n ? `${n} player${n === 1 ? "" : "s"}` : null,
    titleMentions(game.name, "course", game) ? null : game.course || null,
    ended && !titleMentions(game.name, "date", game) ? date : null,
  ].filter(Boolean).join(" · ");
  if (!ended) return { meta, result: null, caption: null, lines: [] };
  if (SHARED_BALL.has(game.game_type) && game.game_type !== "alt_shot") return { meta, result: teamRound?.result ?? null, caption: null, lines: teamRound ? [{ text: teamRound.team }] : [] };
  const r = gameResultFor(game, players, userId);
  const mine = !SHARED_BALL.has(game.game_type) && myRound ? myRoundLine(myRound) : null;
  const lines: Line[] = [...r.lines, ...(mine ? [{ text: mine }] : [])];
  if (game.game_type === "alt_shot" && !r.result && teamRound) return { meta, result: teamRound.result, caption: null, lines: [{ text: teamRound.team }] };
  return { meta, result: r.result, caption: r.caption, lines };
}
