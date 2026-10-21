// A scramble game's results (211.1) — teams, the leaderboard or the matches — from the game, its players and the
// team scores. ONE implementation for the game screen, the recap and the emails. Pure.
import type { Game, Player } from "@/lib/game-types";
import type { AltShotScoreRow } from "@/lib/alt-shot-side-scores";
import { canonicalAltShotGross } from "@/lib/alt-shot-side-scores";
import { pkey, scrambleTeamHandicapFor } from "@/lib/game-shape";
import { scrambleLeaderboard, scrambleMatch, scrambleCard, type LeaderboardRow, type ScrambleMatch } from "@/lib/scramble";
import { scrambleTeamsOf, type ScrambleGroup } from "@/lib/scramble-teams";

export type ScrambleTeamResult = { key: string; name: string; groupId: string; side: "a" | "b"; memberNames: string[]; handicap: number; scores: (number | null)[] };
export type ScrambleResults = {
  mode: "field" | "match"; gross: boolean;
  teams: ScrambleTeamResult[];
  board: LeaderboardRow[];
  matches: { groupId: string; name: string; a: ScrambleTeamResult; b: ScrambleTeamResult; status: ScrambleMatch; line: string }[];
};

export function scrambleResults(game: Game, players: Player[], rows: AltShotScoreRow[]): ScrambleResults {
  const holes = Array.isArray(game.holes_meta) ? game.holes_meta : [];
  const gross = game.scramble_handicap === "gross";
  const mode = game.scramble_mode === "match" ? "match" : "field";
  const groups = (Array.isArray(game.foursomes) ? game.foursomes : []) as unknown as ScrambleGroup[];
  const byKey = new Map(players.map((p) => [pkey(p), p]));
  const teams: ScrambleTeamResult[] = scrambleTeamsOf(groups).map((t) => ({
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
export function scrambleRowValue(r: { gross: number; handicap: number; net: number; toPar: number }, gross: boolean): string {
  return gross ? `${r.gross} (${toParText(r.toPar)})` : `net ${r.net} (${r.gross} − ${r.handicap})`;
}
