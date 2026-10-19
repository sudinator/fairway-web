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
export type MatchOutcome = { gameId: string; date: string; format: string; kind: "singles" | "pairs"; a: Side; b: Side; winner: "a" | "b" | "halved" };

export function matchOutcomes(game: Game, players: Player[], altShotScores: AltShotScoreRow[] = []): MatchOutcome[] {
  const out: MatchOutcome[] = [];
  const holes = game.holes_meta?.length ?? 18;
  const playerOf = playerLookup(players);
  const ch = (p: Player) => chBasis(p, game.course_par, holes);
  const side = (keys: string[]): Side => keys.map((k) => { const p = playerOf(k); return { key: k, userId: (p as { user_id?: string | null } | null)?.user_id ?? null, name: p?.display_name ?? "?" }; });
  const base = { gameId: game.id, date: String((game as { played_at?: string }).played_at || "").slice(0, 10), format: game.game_type };
  const add = (kind: "singles" | "pairs", a: string[], b: string[], lead: number) =>
    out.push({ ...base, kind, a: side(a), b: side(b), winner: lead > 0 ? "a" : lead < 0 ? "b" : "halved" });

  if (game.game_type === "match") {
    for (const pr of game.pairings || []) {
      const pa = playerOf(pr.a), pb = playerOf(pr.b); if (!pa || !pb) continue;
      const st = matchStatus(game.holes_meta, pa.scores || [], pb.scores || [], ch(pa), ch(pb), game.allowance_pct ?? 100);
      if (!st.result) continue;                                  // as the recap: only matches with a result
      add("singles", [pkey(pa)], [pkey(pb)], st.lead);
    }
  } else if (game.game_type === "fourball" || game.game_type === "alt_shot") {
    for (const f of game.foursomes || []) {
      if (!f.a?.length || !f.b?.length) continue;
      if (game.game_type === "alt_shot") {
        const alt = altShotInputsFor(game, players, altShotScores, f); if (!alt) continue;
        const st = altShotStatus(game.holes_meta, alt.a as never, alt.b as never);
        if (!(st.thru === holes || Math.abs(st.lead) > holes - st.thru)) continue;
        add("pairs", f.a, f.b, st.lead);
      } else {
        const mode = game.team_score_mode === "aggregate" ? "aggregate" : "best_ball";
        const st = fourballStatus(game.holes_meta, membersOf(game, players, f), f.a, f.b, game.allowance_pct ?? 100, mode);
        if (!(st.thru === holes || Math.abs(st.lead) > holes - st.thru)) continue;   // the recap's decided rule
        add("pairs", f.a, f.b, st.lead);
      }
    }
  } else if (game.game_type === "trifecta") {
    for (const f of game.foursomes || []) {
      if (!f.a?.length || !f.b?.length) continue;
      const mode = game.team_score_mode === "aggregate" ? "aggregate" : "best_ball";
      const r = computeTrifecta(game.holes_meta, membersOf(game, players, f), f.a, f.b, game.allowance_pct ?? 100, mode, !!f.swap);
      for (const c of r.contests as { kind: "single" | "team"; aIds: string[]; bIds: string[]; lead: number; settled: boolean }[]) {
        if (!c.settled) continue;
        add(c.kind === "single" ? "singles" : "pairs", c.aIds, c.bIds, c.lead);
      }
    }
  }
  return out;
}

export type H2HRow = { userId: string; name: string; won: number; lost: number; halved: number };
export type PartnerRow = { userId: string; name: string; played: number; won: number; halved: number; points: number };

/** One member's OWN record (owner rule: members see their own record only). Members only — guests have no account. */
export function memberRecord(outcomes: MatchOutcome[], userId: string): { headToHead: H2HRow[]; partners: PartnerRow[] } {
  const h2h = new Map<string, H2HRow>(), partners = new Map<string, PartnerRow>();
  for (const o of outcomes) {
    const mine = o.a.some((p) => p.userId === userId) ? "a" : o.b.some((p) => p.userId === userId) ? "b" : null;
    if (!mine) continue;
    const res = o.winner === "halved" ? "halved" : o.winner === mine ? "won" : "lost";
    const theirs = mine === "a" ? o.b : o.a, ours = mine === "a" ? o.a : o.b;
    if (o.kind === "singles") {
      for (const opp of theirs) {
        if (!opp.userId) continue;
        const r = h2h.get(opp.userId) || { userId: opp.userId, name: opp.name, won: 0, lost: 0, halved: 0 };
        r[res]++; h2h.set(opp.userId, r);
      }
    } else {
      for (const mate of ours) {
        if (!mate.userId || mate.userId === userId) continue;
        const r = partners.get(mate.userId) || { userId: mate.userId, name: mate.name, played: 0, won: 0, halved: 0, points: 0 };
        r.played++; if (res === "won") { r.won++; r.points += 1; } else if (res === "halved") { r.halved++; r.points += 0.5; }
        partners.set(mate.userId, r);
      }
    }
  }
  return {
    headToHead: [...h2h.values()].sort((x, y) => (y.won + y.lost + y.halved) - (x.won + x.lost + x.halved) || y.won - x.won || x.name.localeCompare(y.name)),
    partners: [...partners.values()].sort((x, y) => y.points - x.points || y.played - x.played || x.name.localeCompare(y.name)),
  };
}
