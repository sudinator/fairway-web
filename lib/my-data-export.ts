/**
 * "Email me my data" (212.133, owner, Nov 26 2026): a member's own rounds, holes and games as CSV files, emailed to the
 * address on their account so they can do what they like with them outside the app. Pure: the server loads the rows
 * (lib/my-data-export-server) and this turns them into files. Excel-friendly: a UTF-8 byte-order mark so accented names
 * open correctly, dates as YYYY-MM-DD, figures unformatted. Only the member's own data: nothing about other members
 * beyond opponents' and partners' names in match results, nothing from Money.
 */
import { type Round, type Hole, strokesOf, parOf, puttsOf, pensOf, ptsOf, roundDifferential, adjustedGross, played, dedupeHoles, strokesReceived, isGIR } from "@/lib/golf";
import { chBasis, courseHandicapOf } from "@/lib/game-shape";
import type { TeamRound } from "@/lib/team-rounds";
import { gameResultFor } from "@/lib/game-list-summary";
import { matchOutcomes, recordMatchLine, memberRecord } from "@/lib/match-outcomes";
import type { Game, Player } from "@/lib/game-types";
import type { AltShotScoreRow } from "@/lib/alt-shot-side-scores";

export type ExportFile = { filename: string; content: string };
const BOM = "﻿";
export function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(header: string[], rows: unknown[][]): string {
  return BOM + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
const day = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : "");
const FORMAT: Record<string, string> = { stableford: "Stableford", stroke: "Stroke play", match: "Match play", fourball: "Best ball", trifecta: "Trifecta", skins: "Skins", alt_shot: "Alternate shot", scramble: "Scramble" };

/** The round with strokes received per hole, as every screen computes them (manage.tsx roundCh → chBasis). */
function withRecv(r: Round): Round {
  const holes = dedupeHoles(r.holes || []).slice().sort((a, b) => a.hole_number - b.hole_number);
  const ch = chBasis({ handicap_index: r.handicap_index, slope: r.slope, rating: r.rating, course_handicap: r.course_handicap, course_handicap_source: r.course_handicap_source }, r.course_par, holes.length || 18);
  return { ...r, holes: holes.map((h) => ({ ...h, recv: strokesReceived(h.stroke_index, ch, holes) })) };
}

export function roundsCsv(rounds: Round[], gamesById: Map<string, Game>): ExportFile {
  const header = ["round_id", "date", "course", "tee", "rating", "slope", "par", "holes_played", "gross", "to_par", "course_handicap", "net", "stableford_points", "differential", "adjusted_gross", "putts", "penalties", "greens_in_regulation", "fairways_hit", "source", "game_code", "club"];
  const rows = rounds.map((raw) => {
    const r = withRecv(raw), hs = played(r);
    // ONE handicap rule for the whole export (the reads guards): the round's basis through chBasis, as every screen and
    // holes.csv's received strokes — not the stored column
    const gross = strokesOf(r), par = parOf(r);
    const ch = courseHandicapOf({ handicap_index: r.handicap_index, slope: r.slope, rating: r.rating, course_handicap: r.course_handicap, course_handicap_source: r.course_handicap_source }, r.course_par, hs.length || 18);
    const gir = hs.filter((h) => h.putts != null && isGIR(h)).length;
    const fw = hs.filter((h) => h.fairway === "hit").length;
    const game = r.game_id ? gamesById.get(r.game_id) : undefined;
    return [r.id, day(r.played_at), r.course, r.tee_name, r.rating, r.slope, r.course_par, hs.length, gross, gross - par, ch, ch == null ? "" : gross - ch, hs.length ? ptsOf(r) : "", roundDifferential(r), adjustedGross(r), hs.length ? puttsOf(r) : "", hs.length ? pensOf(r) : "", hs.some((h) => h.putts != null) ? gir : "", hs.some((h) => h.fairway) ? fw : "", game ? "club game" : "personal round", game?.code ?? "", r.group_name ?? ""];
  });
  return { filename: "rounds.csv", content: toCsv(header, rows) };
}

export function holesCsv(rounds: Round[]): ExportFile {
  const header = ["round_id", "date", "course", "hole", "par", "stroke_index", "yardage", "strokes", "to_par", "strokes_received", "net_to_par", "putts", "fairway", "penalties", "greenside_bunker"];
  const rows: unknown[][] = [];
  for (const raw of rounds) {
    const r = withRecv(raw);
    for (const h of r.holes as Hole[]) {
      if (h.strokes == null || h.strokes <= 0) continue;
      rows.push([r.id, day(r.played_at), r.course, h.hole_number, h.par, h.stroke_index, h.yardage ?? "", h.strokes, h.strokes - h.par, h.recv ?? 0, h.strokes - (h.recv ?? 0) - h.par, h.putts, h.fairway ?? "", h.penalties ?? 0, h.sand ? "yes" : ""]);
    }
  }
  return { filename: "holes.csv", content: toCsv(header, rows) };
}

const SHARED_BALL = new Set(["scramble", "alt_shot"]);
export function gamesCsv(userId: string, games: Game[], players: Player[], altShot: AltShotScoreRow[] = [], teamRounds: TeamRound[] = []): ExportFile {
  const header = ["game_id", "code", "name", "date", "course", "format", "players", "status", "your_result", "your_gross", "your_team", "matches"];
  const playedAt = (g: Game) => String((g as { played_at?: string | null }).played_at || "");
  const rows = [...games].sort((a, b) => playedAt(b).localeCompare(playedAt(a))).map((g) => {
    const ps = players.filter((p) => p.game_id === g.id), me = ps.find((p) => p.user_id === userId), ended = g.status === "ended";
    const team = teamRounds.find((t) => t.gameId === g.id) ?? null;
    // a shared-ball format (scramble, alternate shot) has a TEAM result and no personal score (APP_RULES: one ball per side)
    const shared = SHARED_BALL.has(g.game_type);
    const res = !ended ? null : shared ? team?.result ?? null : gameResultFor(g, ps, userId).result;
    const gross = shared || !me?.scores?.length ? "" : (me.scores as (number | null)[]).reduce<number>((t, v) => t + (v || 0), 0);
    // match results only for ended games — as the Profile's head-to-head counts them
    const rec = ended ? memberRecord(matchOutcomes(g, ps, altShot.filter((x) => x.game_id === g.id)), userId) : { headToHead: [], partners: [] };
    const matches = [...rec.headToHead.flatMap((r) => r.matches.map((m) => `${recordMatchLine(m).split(" · ")[0]} v ${r.name}`)), ...rec.partners.flatMap((r) => r.matches.map((m) => `${recordMatchLine(m).split(" · ")[0]} with ${r.name} v ${m.against.join(" & ")}`))];
    return [g.id, g.code, g.name, day(playedAt(g)), g.course, FORMAT[g.game_type] || g.game_type, ps.length, g.status, res ?? (me?.no_show ? "no-show" : ""), gross, team?.team ?? "", [...new Set(matches)].join("; ")];
  });
  return { filename: "games.csv", content: toCsv(header, rows) };
}

export function buildMyDataFiles(userId: string, rounds: Round[], games: Game[], players: Player[], altShot: AltShotScoreRow[] = [], teamRounds: TeamRound[] = []): ExportFile[] {
  const gamesById = new Map(games.map((g) => [g.id, g]));
  return [roundsCsv(rounds, gamesById), holesCsv(rounds), gamesCsv(userId, games, players, altShot, teamRounds)];
}
