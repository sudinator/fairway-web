// MESSY DATA (210.5): the real-world cases every statistics feature must survive. Statistics code is tested
// through these in lib/messy-data.test.ts — add a case here when real data surprises us.
import type { Game, Player } from "@/lib/game-types";

const holesN = (n: number) => Array.from({ length: n }, (_, i) => ({ n: i + 1, par: i % 6 === 2 ? 3 : i % 6 === 5 ? 5 : 4, si: ((i * 7) % n) + 1 }));
const fill = (n: number, v: unknown): unknown[] => Array(n).fill(v);
const partial = (played: number, v: number, total = 18): unknown[] => [...fill(played, v), ...fill(total - played, null)];
let seq = 0;
const P = (gameId: string, user: string | null, name: string, scores: unknown[], extra: Partial<Player> & Record<string, unknown> = {}): Player =>
  ({ id: `${gameId}-${++seq}`, game_id: gameId, user_id: user, display_name: name, scores, course_handicap: 10, course_handicap_source: "manual",
     handicap_index: 10, rating: 72, slope: 113, tee_name: "Blue", no_show: false, team: null, putts: [], fairways: [], ...extra } as unknown as Player);
const G = (id: string, gameType: string, date: string, n: number, extra: Record<string, unknown> = {}): Game =>
  ({ id, code: "123456", name: id, course: "Messy Links", course_par: holesN(n).reduce((s, h) => s + h.par, 0), holes_meta: holesN(n), game_type: gameType,
     allowance_pct: 100, status: "ended", played_at: date, teams: null, pairings: [], foursomes: [], created_by: "org", ...extra } as unknown as Game);

export type MessyGame = { game: Game; players: Player[]; note: string };
export const MESSY_USERS = { full: "u-full", empty: "u-empty", single: "u-single", fourteen: "u-14", noIndex: "u-noidx", noShow: "u-noshow", derived: "u-derived", a1: "u-a1", a2: "u-a2", b1: "u-b1", b2: "u-b2",
  t1: "u-t1", t2: "u-t2", t3: "u-t3", t4: "u-t4" };
const U = MESSY_USERS;

export function messyGames(): MessyGame[] {
  const g1 = G("m-stroke", "stroke", "2026-08-01", 18);
  const g2 = G("m-nine", "stroke", "2026-08-08", 9);
  const g3 = G("m-alt", "alt_shot", "2026-08-15", 18, { teams: [{ key: "A", name: "Red" }, { key: "B", name: "Blue" }], foursomes: [{ id: "f1", a: [U.a1, U.a2], b: [U.b1, U.b2] }] });
  const g4 = G("m-singles", "match", "2026-08-22", 18, { pairings: [{ a: U.full, b: U.empty }, { a: U.fourteen, b: "guest-x" }] });
  const g5 = G("m-fourball", "fourball", "2026-08-29", 18, { team_score_mode: "best_ball", foursomes: [{ id: "f2", a: [U.full, U.noShow], b: [U.derived, U.single] }] });
  // 210.7 — the formats BNN's groups actually play (production profile, Oct 19): match, skins, Stableford, Trifecta.
  const g6 = G("m-stableford", "stableford", "2026-09-05", 18);
  const g7 = G("m-skins", "skins", "2026-09-12", 18, { skins_mode: "carryover" });
  const g8 = G("m-trifecta", "trifecta", "2026-09-19", 18, { teams: [{ key: "A", name: "Red" }, { key: "B", name: "Blue" }],
    foursomes: [{ id: "t1", name: "Group 1", a: [U.t1, U.t2], b: [U.t3, U.t4], swap: false }] });
  return [
    { note: "Stableford: a full card, a shortened card (its points must not rank it), a one-score card, a blow-up hole, a guest", game: g6, players: [
        P(g6.id, U.full, "Full Card", fill(18, 5)),
        P(g6.id, U.fourteen, "Fourteen Holes", partial(14, 3)),
        P(g6.id, U.single, "Single Score", [4]),
        P(g6.id, U.derived, "Derived Dee", [12, ...fill(17, 4)], { handicap_index: 13.4, course_handicap: null, course_handicap_source: "derived", slope: 127, rating: 71.3 }),
        P(g6.id, null, "Guest Gus", fill(18, 4), { is_guest: true }) ] },
    { note: "skins (carryover): every hole tied (all carry), an empty card, a shortened card, a guest", game: g7, players: [
        P(g7.id, U.full, "Full Card", fill(18, 5)), P(g7.id, U.noIndex, "No Index", fill(18, 5), { handicap_index: null }),
        P(g7.id, U.empty, "Empty Card", []), P(g7.id, U.fourteen, "Fourteen Holes", partial(14, 4)),
        P(g7.id, null, "Guest Gus", fill(18, 5), { is_guest: true }) ] },
    { note: "Trifecta: one foursome, a shortened player and an empty card inside it", game: g8, players: [
        P(g8.id, U.t1, "Tri One", fill(18, 4), { team: "A" }), P(g8.id, U.t2, "Tri Two", partial(12, 5), { team: "A" }),
        P(g8.id, U.t3, "Tri Three", fill(18, 5), { team: "B" }), P(g8.id, U.t4, "Tri Four", [], { team: "B" }) ] },
    { note: "stroke play: a full card, an empty card, a single score, 14 holes, no index, a no-show, a guest, a derived (fractional) course handicap, string scores",
      game: g1, players: [
        P(g1.id, U.full, "Full Card", fill(18, 5), { handicap_index: 12 }),
        P(g1.id, U.empty, "Empty Card", []),
        P(g1.id, U.single, "Single Score", [4]),
        P(g1.id, U.fourteen, "Fourteen Holes", partial(14, 3)),
        P(g1.id, U.noIndex, "No Index", fill(18, 6), { handicap_index: null, course_handicap: null, course_handicap_source: "derived" }),
        P(g1.id, U.noShow, "No Show", fill(18, 4), { no_show: true }),
        P(g1.id, null, "Guest Gus", fill(18, 4), { is_guest: true }),
        P(g1.id, U.derived, "Derived Dee", fill(18, 5), { handicap_index: 13.4, course_handicap: null, course_handicap_source: "derived", slope: 127, rating: 71.3 }),
        P(g1.id, "u-strings", "String Scores", fill(18, "5")),
      ] },
    { note: "a 9-hole game: a full nine and a five-hole card", game: g2, players: [
        P(g2.id, U.full, "Full Card", fill(9, 5), { handicap_index: 11 }), P(g2.id, U.single, "Single Score", partial(5, 4, 9)) ] },
    { note: "alternate shot: pair scores (very low) must never become individual awards", game: g3, players: [
        P(g3.id, U.a1, "Alt A1", fill(18, 2), { team: "A" }), P(g3.id, U.a2, "Alt A2", fill(18, 2), { team: "A" }),
        P(g3.id, U.b1, "Alt B1", fill(18, 3), { team: "B" }), P(g3.id, U.b2, "Alt B2", fill(18, 3), { team: "B" }) ] },
    { note: "singles: against an empty card, and a 14-hole player against a guest", game: g4, players: [
        P(g4.id, U.full, "Full Card", fill(18, 5)), P(g4.id, U.empty, "Empty Card", []),
        P(g4.id, U.fourteen, "Fourteen Holes", partial(14, 4)), { ...P(g4.id, null, "Guest X", fill(18, 5), { is_guest: true }), id: "guest-x" } as Player ] },
    { note: "four-ball: a no-show partner, a single-score partner", game: g5, players: [
        P(g5.id, U.full, "Full Card", fill(18, 5)), P(g5.id, U.noShow, "No Show", [], { no_show: true }),
        P(g5.id, U.derived, "Derived Dee", fill(18, 5), { handicap_index: 13.4, course_handicap: null, course_handicap_source: "derived", slope: 127, rating: 71.3 }),
        P(g5.id, U.single, "Single Score", [4]) ] },
  ];
}
