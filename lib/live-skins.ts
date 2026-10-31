/**
 * 212.36 (owner, Oct 24) — the public live scorecard scores skins with the APP's rules (lib/game-results skinsTotals),
 * not its own. It used to score every skins game as individual carry-over across the whole field: no "Halved", no 1:1
 * or 2 v 2 team skins. Its feed now carries games.skins_mode (migration 0218); this adapter hands the live data to the
 * app's rules unchanged.
 *
 * The one translation: the live feed always sends `foursomes` as a list ([] when the game has none), while the app
 * tells 1:1 team skins (no foursomes) from 2 v 2 (foursomes) by whether the list exists at all (lib/game-shape
 * shapeOf). So an EMPTY live list means "no foursomes".
 */
import { skinsTotals, membersOf } from "./game-results";
import { computeTeamBestBallSkins } from "./golf";
import { shapeOf, skinsTieOf } from "./game-shape";
import type { Game, Player } from "./game-types";

export type LiveSkinsGame = {
  game_type: string; skins_mode?: string | null; teams: { key: string; name: string }[] | null;
  holes_meta: { n: number; par: number; si: number | null }[]; allowance_pct: number | null;
  team_score_mode: "best_ball" | "aggregate" | null; course_par: number | null;
};
export type LiveSkinsPlayer = { id: string; display_name: string; ch: number; course_handicap_source?: string | null; team: string | null; no_show: boolean; scores: (number | null)[] };
export type LiveSkins = {
  style: "individual" | "team_11" | "team_2v2";
  byPlayer: Record<string, number>;          // keyed by live player id
  byTeam: Record<string, number> | null;     // team key → skins (team styles)
  stillInPlay: number;                       // skins not yet won (every contest's holes counted)
};

export function liveSkins(game: LiveSkinsGame, players: LiveSkinsPlayer[], pairings: { a: string | null; b: string | null }[],
  foursomes: { id: string; name: string; a: (string | null)[]; b: (string | null)[] }[]): LiveSkins {
  const ids = (xs: (string | null)[]) => xs.filter((x): x is string => !!x);
  const fs = (foursomes || []).map((f) => ({ id: f.id, name: f.name, a: ids(f.a || []), b: ids(f.b || []) }));
  const g = {
    ...game, teams: game.teams && game.teams.length ? game.teams : null,
    pairings: (pairings || []).filter((p) => p.a && p.b) as { a: string; b: string }[],
    foursomes: fs.length ? fs : null,
  } as unknown as Game;
  // live ids ARE the player keys (no user_id), and the feed's ch is the course handicap the app's chBasis would use
  const ps = players.map((p) => ({ id: p.id, user_id: null, display_name: p.display_name, team: p.team, no_show: p.no_show,
    scores: p.scores || [], course_handicap: p.ch, course_handicap_source: p.course_handicap_source ?? null, handicap_index: null })) as unknown as Player[];
  const style = (shapeOf(g as never).skinsStyle ?? "individual") as LiveSkins["style"];
  const t = skinsTotals(g, ps);
  const holes = g.holes_meta?.length || 18;
  const sum = (r: Record<string, number>) => Object.values(r).reduce((a, n) => a + n, 0);
  let byPlayer = t.byPlayer;
  if (style === "team_2v2") {
    // the app scores 2 v 2 skins by pair; on the live list each player shows the skins their pair has won
    byPlayer = {};
    for (const f of g.foursomes || []) {
      if (!f.a.length || !f.b.length) continue;
      const r = computeTeamBestBallSkins(g.holes_meta as never, membersOf(g, ps, f), f.a, f.b, g.allowance_pct ?? 100, g.team_score_mode === "aggregate" ? "aggregate" : "best_ball", skinsTieOf(g));
      f.a.forEach((k) => { byPlayer[k] = (byPlayer[k] || 0) + (r.skinsBySide.a || 0); });
      f.b.forEach((k) => { byPlayer[k] = (byPlayer[k] || 0) + (r.skinsBySide.b || 0); });
    }
  }
  const contests = style === "team_11" ? g.pairings.length : style === "team_2v2" ? (g.foursomes || []).filter((f) => f.a.length && f.b.length).length : 1;
  const won = t.byTeam && style !== "individual" ? sum(t.byTeam) : sum(t.byPlayer);
  return { style, byPlayer, byTeam: style === "individual" ? null : t.byTeam, stillInPlay: Math.max(0, holes * Math.max(1, contests) - won) };
}
