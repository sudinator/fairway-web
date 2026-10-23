// A scramble game's results (211.1) — teams, the leaderboard or the matches — from the game, its players and the
// team scores. ONE implementation for the game screen, the recap and the emails. Pure.
import type { Game, Player } from "@/lib/game-types";
import type { AltShotScoreRow } from "@/lib/alt-shot-side-scores";
import { canonicalAltShotGross } from "@/lib/alt-shot-side-scores";
import { pkey, scrambleTeamHandicapFor, scrambleMethodOf } from "@/lib/game-shape";
import { scrambleLeaderboard, scrambleMatch, scrambleCard, type LeaderboardRow, type ScrambleMatch } from "@/lib/scramble";
import { scrambleTeamsOf, cupSideNames, type ScrambleGroup } from "@/lib/scramble-teams";

export type ScrambleTeamResult = { key: string; name: string; groupId: string; side: "a" | "b"; memberNames: string[]; handicap: number; scores: (number | null)[] };
export type ScrambleResults = {
  mode: "field" | "match"; gross: boolean;
  teams: ScrambleTeamResult[];
  board: LeaderboardRow[];
  matches: { groupId: string; name: string; a: ScrambleTeamResult; b: ScrambleTeamResult; status: ScrambleMatch; line: string }[];
};

export function scrambleResults(game: Game, players: Player[], rows: AltShotScoreRow[]): ScrambleResults {
  const holes = Array.isArray(game.holes_meta) ? game.holes_meta : [];
  const gross = scrambleMethodOf(game) === "gross";   // legacy games only — gross is no longer offered (211.9)
  const mode = game.scramble_mode === "match" ? "match" : "field";
  const groups = (Array.isArray(game.foursomes) ? game.foursomes : []) as unknown as ScrambleGroup[];
  const byKey = new Map(players.map((p) => [pkey(p), p]));
  const teams: ScrambleTeamResult[] = scrambleTeamsOf(groups, cupSideNames(game)).map((t) => ({
    key: `${t.groupId}:${t.side}`, name: t.name, groupId: t.groupId, side: t.side,
    memberNames: t.members.map((k) => byKey.get(k)?.display_name ?? "?"),
    handicap: scrambleTeamHandicapFor(game, players, t.members[0]) ?? 0,
    scores: canonicalAltShotGross(rows, t.groupId, t.side, holes.length, null),
  }));
  const board = scrambleLeaderboard(holes as never, teams.map((t) => ({ key: t.key, name: t.name, scores: t.scores, handicap: t.handicap })), gross ? "gross" : "net");
  const matches = mode !== "match" ? [] : groups.flatMap((g) => {
    const a = teams.find((t) => t.groupId === g.id && t.side === "a"), b = teams.find((t) => t.groupId === g.id && t.side === "b");
    if (!a || !b) return [];
    const status = scrambleMatch(holes as never, { scores: a.scores, handicap: a.handicap }, { scores: b.scores, handicap: b.handicap });
    const leader = status.lead > 0 ? a.name : b.name;
    const line = status.thru === 0 ? "Not started"
      : status.decided ? (status.lead === 0 ? "Halved" : `${leader} won ${status.result}`)
      : status.lead === 0 ? `All square thru ${status.thru}` : `${leader} ${Math.abs(status.lead)} UP thru ${status.thru}`;
    return [{ groupId: g.id, name: g.name, a, b, status, line }];
  });
  return { mode, gross, teams, board, matches };
}

/** One team's card (gross, strokes, net per hole) — for the recap and emails. */
export const scrambleTeamCard = (game: Game, t: ScrambleTeamResult) => scrambleCard((game.holes_meta || []) as never, t.scores, t.handicap);

const toParText = (n: number) => (n === 0 ? "E" : n > 0 ? `+${n}` : String(n));
/** The recap's wording for one scramble leaderboard row — the app's recap and the email read it word for word. */
export function scrambleRowValue(r: { gross: number; handicap: number; net: number; toPar: number; thru?: number; holes?: number }, gross: boolean): string {
  // 212.10: net TO PAR (comparable however many holes a team played) and the strokes actually TAKEN on the holes
  // played (gross − net) — not the 18-hole team handicap, which only all 18 holes use up.
  // 212.13 (owner): every round shows the scores themselves, net first, then gross and net to par —
  // "54 net (63 gross, -18)"; an unfinished round adds how far it got — "49 net (67 gross, -9 thru 15)"
  const thru = r.thru != null && r.holes != null && r.thru < r.holes ? ` thru ${r.thru}` : "";
  return gross ? `${r.gross} gross (${toParText(r.toPar)}${thru})` : `${r.net} net (${r.gross} gross, ${toParText(r.toPar)}${thru})`;
}
/** 212.10: "net −9" / "gross +2", with "(thru 15)" when the round wasn't finished — for headlines and personal lines. */
export function scrambleScoreText(toPar: number, thru: number, holes: number, gross: boolean, totals?: { net: number; gross: number }): string {
  // 212.13: reads like its row — "54 net (63 gross, -18)", "49 net (67 gross, -9 thru 15)"
  const t = thru < holes ? ` thru ${thru}` : "";
  if (totals) return gross ? `${totals.gross} gross (${toParText(toPar)}${t})` : `${totals.net} net (${totals.gross} gross, ${toParText(toPar)}${t})`;
  return `${gross ? "gross" : "net"} ${toParText(toPar)}${thru < holes ? ` (thru ${thru})` : ""}`;
}

/** 212.11: what's missing before a scramble ends — per TEAM (players' own cards are always empty in a scramble).
 *  scopeKeys: only teams with a player in this scope (empty = every team). */
export function scrambleFinishGaps(game: Game, rows: AltShotScoreRow[], scopeKeys: Set<string>): { name: string; noScores: boolean; missScores: number[]; missPutts: number[]; missFw: number[] }[] {
  const holes = Array.isArray(game.holes_meta) ? game.holes_meta : [];
  const gaps: { name: string; noScores: boolean; missScores: number[]; missPutts: number[]; missFw: number[] }[] = [];
  for (const t of scrambleTeamsOf((game.foursomes || []) as unknown as ScrambleGroup[], cupSideNames(game))) {
    if (scopeKeys.size && !t.members.some((k) => scopeKeys.has(k))) continue;
    const gross = canonicalAltShotGross(rows, t.groupId, t.side, holes.length, null);
    const entered = gross.filter((v) => v != null && v > 0).length;
    const missScores = holes.filter((_, i) => gross[i] == null || (gross[i] ?? 0) <= 0).map((h) => h.n);
    if (entered === 0 || missScores.length) gaps.push({ name: t.name, noScores: entered === 0, missScores: entered === 0 ? [] : missScores, missPutts: [], missFw: [] });
  }
  return gaps;
}
