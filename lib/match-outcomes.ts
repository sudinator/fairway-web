// Every finished match in a game, with the players by account (210.0 — head-to-head & partners).
// The same scoring functions and "decided" rules as the recap's match list (lib/game-recap-sections):
// matchStatus / fourballStatus / altShotStatus / computeTrifecta, course handicap through chBasis.
// lib/match-outcomes.test.ts checks the winners agree with the recap's on the same games.
import { matchStatus, fourballStatus, altShotStatus, computeTrifecta } from "@/lib/golf";
import { pkey, chBasis } from "@/lib/game-shape";
import { membersOf, altShotInputsFor, playerLookup } from "@/lib/game-results";
import type { AltShotScoreRow } from "@/lib/alt-shot-side-scores";
import type { Game, Player } from "@/lib/game-types";

export type Side = { key: string; userId: string | null; name: string }[];
/** kind "singles" = one against one (head-to-head); "pairs" = two against two (partners). winner "a" | "b" | "halved". */
export type MatchOutcome = { gameId: string; date: string; course: string; format: string; kind: "singles" | "pairs"; a: Side; b: Side; winner: "a" | "b" | "halved";
  /** 212.127: the margin as the scorecard states it, compact — "3&2", "2 up"; "" when halved */
  margin: string };
/** "3 & 2" → "3&2", "2 UP" → "2 up", "Halved" → "" (the scoring functions' wording, compacted for a list) */
export const compactMargin = (r: string | null | undefined) => !r || /halved/i.test(r) ? "" : r.replace(/\s*&\s*/, "&").replace(/\s*UP$/i, " up").trim();

export function matchOutcomes(game: Game, players: Player[], altShotScores: AltShotScoreRow[] = []): MatchOutcome[] {
  const out: MatchOutcome[] = [];
  const holes = game.holes_meta?.length ?? 18;
  const playerOf = playerLookup(players);
  const ch = (p: Player) => chBasis(p, game.course_par, holes);
  const side = (keys: string[]): Side => keys.map((k) => { const p = playerOf(k); return { key: k, userId: (p as { user_id?: string | null } | null)?.user_id ?? null, name: p?.display_name ?? "?" }; });
  const base = { gameId: game.id, date: String((game as { played_at?: string }).played_at || "").slice(0, 10), course: game.course || "", format: game.game_type };
  const add = (kind: "singles" | "pairs", a: string[], b: string[], lead: number, result?: string) =>
    out.push({ ...base, kind, a: side(a), b: side(b), winner: lead > 0 ? "a" : lead < 0 ? "b" : "halved", margin: lead === 0 ? "" : compactMargin(result) });

  if (game.game_type === "match") {
    for (const pr of game.pairings || []) {
      const pa = playerOf(pr.a), pb = playerOf(pr.b); if (!pa || !pb) continue;
      const st = matchStatus(game.holes_meta, pa.scores || [], pb.scores || [], ch(pa), ch(pb), game.allowance_pct ?? 100);
      if (!st.result) continue;                                  // as the recap: only matches with a result
      add("singles", [pkey(pa)], [pkey(pb)], st.lead, st.result);
    }
  } else if (game.game_type === "fourball" || game.game_type === "alt_shot") {
    for (const f of game.foursomes || []) {
      if (!f.a?.length || !f.b?.length) continue;
      if (game.game_type === "alt_shot") {
        const alt = altShotInputsFor(game, players, altShotScores, f); if (!alt) continue;
        const st = altShotStatus(game.holes_meta, alt.a as never, alt.b as never);
        if (!(st.thru === holes || Math.abs(st.lead) > holes - st.thru)) continue;
        add("pairs", f.a, f.b, st.lead, (st as { result?: string }).result);
      } else {
        const mode = game.team_score_mode === "aggregate" ? "aggregate" : "best_ball";
        const st = fourballStatus(game.holes_meta, membersOf(game, players, f), f.a, f.b, game.allowance_pct ?? 100, mode);
        if (!(st.thru === holes || Math.abs(st.lead) > holes - st.thru)) continue;   // the recap's decided rule
        add("pairs", f.a, f.b, st.lead, (st as { result?: string }).result);
      }
    }
  } else if (game.game_type === "trifecta") {
    for (const f of game.foursomes || []) {
      if (!f.a?.length || !f.b?.length) continue;
      const mode = game.team_score_mode === "aggregate" ? "aggregate" : "best_ball";
      const r = computeTrifecta(game.holes_meta, membersOf(game, players, f), f.a, f.b, game.allowance_pct ?? 100, mode, !!f.swap);
      for (const c of r.contests as { kind: "single" | "team"; aIds: string[]; bIds: string[]; lead: number; settled: boolean; result?: string }[]) {
        if (!c.settled) continue;
        add(c.kind === "single" ? "singles" : "pairs", c.aIds, c.bIds, c.lead, c.result);
      }
    }
  }
  return out;
}

/** 212.133 (owner): every record opens the games behind it — "Lost 4&3 · Nov 3 · Francis Byrne", newest first */
export type RecordMatch = { gameId: string; date: string; course: string; format: string; result: "won" | "lost" | "halved"; margin: string; with?: string[]; against: string[] };
export type H2HRow = { userId: string; name: string; won: number; lost: number; halved: number; matches: RecordMatch[] };
export type PartnerRow = { userId: string; name: string; played: number; won: number; halved: number; points: number; formats: string[]; matches: RecordMatch[] };
/** Best partner needs at least this many matches together (owner-approved, Oct 20 2026). */
export const BEST_PARTNER_MIN = 3;
const FORMAT_NAME: Record<string, string> = { fourball: "four-ball", alt_shot: "alternate shot", trifecta: "Trifecta" };
/** "four-ball and Trifecta" — the formats a partner record came from. */
export const formatsLabel = (formats: string[]) => { const n = formats.map((f) => FORMAT_NAME[f] || f); return n.length <= 1 ? n.join("") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`; };

/** One member's OWN record (owner rule: members see their own record only). Members only — guests have no account. */
export function memberRecord(outcomes: MatchOutcome[], userId: string): { headToHead: H2HRow[]; partners: PartnerRow[] } {
  const h2h = new Map<string, H2HRow>(), partners = new Map<string, PartnerRow>();
  for (const o of outcomes) {
    const mine = o.a.some((p) => p.userId === userId) ? "a" : o.b.some((p) => p.userId === userId) ? "b" : null;
    if (!mine) continue;
    const res = o.winner === "halved" ? "halved" : o.winner === mine ? "won" : "lost";
    const theirs = mine === "a" ? o.b : o.a, ours = mine === "a" ? o.a : o.b;
    const match: RecordMatch = { gameId: o.gameId, date: o.date, course: o.course, format: o.format, result: res, margin: o.margin, with: ours.filter((p) => p.userId !== userId).map((p) => p.name), against: theirs.map((p) => p.name) };
    if (o.kind === "singles") {
      for (const opp of theirs) {
        if (!opp.userId) continue;
        const r = h2h.get(opp.userId) || { userId: opp.userId, name: opp.name, won: 0, lost: 0, halved: 0, matches: [] };
        r[res]++; r.matches.push(match); h2h.set(opp.userId, r);
      }
    } else {
      for (const mate of ours) {
        if (!mate.userId || mate.userId === userId) continue;
        const r = partners.get(mate.userId) || { userId: mate.userId, name: mate.name, played: 0, won: 0, halved: 0, points: 0, formats: [], matches: [] };
        r.played++; r.matches.push(match); if (!r.formats.includes(o.format)) r.formats.push(o.format); if (res === "won") { r.won++; r.points += 1; } else if (res === "halved") { r.halved++; r.points += 0.5; }
        partners.set(mate.userId, r);
      }
    }
  }
  const newestFirst = (m: RecordMatch[]) => m.sort((x, y) => y.date.localeCompare(x.date) || x.gameId.localeCompare(y.gameId));
  h2h.forEach((r) => newestFirst(r.matches)); partners.forEach((r) => newestFirst(r.matches));
  return {
    headToHead: [...h2h.values()].sort((x, y) => (y.won + y.lost + y.halved) - (x.won + x.lost + x.halved) || y.won - x.won || x.name.localeCompare(y.name)),
    partners: rankPartnerRecords([...partners.values()]),
  };
}

/** Partnership success rate = wins + half of halved matches, divided by matches.
 * Three matches minimum; equal rates favour the larger sample. Match results never change. */
export function partnerRate(p: PartnerRow): number | null {
  return Number.isInteger(p.played) && p.played > 0 && Number.isFinite(p.points) && p.points >= 0 && p.points <= p.played ? p.points / p.played : null;
}
export function rankPartnerRecords(partners: PartnerRow[]): PartnerRow[] {
  const eligibleRate = (p: PartnerRow) => p.played >= BEST_PARTNER_MIN ? partnerRate(p) ?? -1 : -1;
  return [...partners].sort((a,b) => eligibleRate(b) - eligibleRate(a) || b.played - a.played || a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
}
export function bestPartnerRecord(partners: PartnerRow[]): PartnerRow | null {
  return rankPartnerRecords(partners).find(p => p.played >= BEST_PARTNER_MIN && partnerRate(p) != null) ?? null;
}

/** "Lost 4&3 · Nov 3 · Francis Byrne" — one match of a record, as the Profile lists it (the opponent/partner is the row). */
export function recordMatchLine(m: RecordMatch): string {
  const verb = m.result === "won" ? "Won" : m.result === "lost" ? "Lost" : "Halved";
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(m.date);
  const when = d ? new Date(+d[1], +d[2] - 1, +d[3]).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : m.date;
  return [`${verb}${m.margin ? ` ${m.margin}` : ""}`, when, m.course].filter(Boolean).join(" · ");
}
