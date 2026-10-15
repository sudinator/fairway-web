// The completed-game recap (207.2): one headline per format, built ONLY on the shared result functions
// (lib/game-results, lib/player-scoring) — so the Results screen, the recap and the completion
// notification cannot disagree. Unfinished matches are never described as settled.
import { matchStatus } from "@/lib/golf";
import { pkey, chBasis, shapeOf } from "@/lib/game-shape";
import * as PS from "@/lib/player-scoring";
import { singlesTeamStandings, foursomeTeamStandings, trifectaResults, skinsTotals, playerLookup, fmtPoints } from "@/lib/game-results";
import type { AltShotScoreRow } from "@/lib/alt-shot-side-scores";
import type { Game, Player } from "@/lib/game-types";

export type Recap = {
  headline: string;               // e.g. "Red beat Blue 3–1"
  endedEarly: boolean;            // matches or scorecards unfinished when the game ended
  notes: string[];                // e.g. "2 matches unfinished — not counted"
  personal: Record<string, string>; // per player key: their own line ("Your team won", "you won 3 & 2 vs Karan")
  signature: string;              // the OUTCOME, stable — a re-end announces only if this changes
};

const pts = fmtPoints;
const ordinal = (n: number) => n + (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");

function teamLine(teams: { key: string; name: string }[], a: number, b: number) {
  const [ta, tb] = teams;
  if (a === b) return { headline: `${ta.name} and ${tb.name} tied ${pts(a)}–${pts(b)}`, winner: null as string | null };
  return a > b ? { headline: `${ta.name} beat ${tb.name} ${pts(a)}–${pts(b)}`, winner: ta.key } : { headline: `${tb.name} beat ${ta.name} ${pts(b)}–${pts(a)}`, winner: tb.key };
}

export function buildRecap(game: Game, players: Player[], altShotScores: AltShotScoreRow[] = []): Recap {
  const shape = shapeOf(game);
  const teams = (Array.isArray(game.teams) && game.teams.length === 2 ? game.teams : null) as { key: string; name: string }[] | null;
  const holes = game.holes_meta?.length ?? 18;
  const live = players.filter((p) => !p.no_show);
  const personal: Record<string, string> = {};
  const notes: string[] = [];
  const teamPersonal = (winner: string | null) => live.forEach((p) => {
    if (!p.team) return;
    const name = teams?.find((t) => t.key === p.team)?.name ?? "Your team";
    personal[pkey(p)] = winner == null ? `${name} tied` : winner === p.team ? `${name} won` : `${name} lost`;
  });

  // Team formats: decided points only — an unfinished match is never counted as settled.
  if (teams && (game.game_type === "match" || game.game_type === "fourball" || game.game_type === "alt_shot") && shape.usesTeams) {
    const st = game.game_type === "match" ? singlesTeamStandings(game, players) : foursomeTeamStandings(game, players, altShotScores);
    const a = st.decidedPts[teams[0].key] ?? 0, b = st.decidedPts[teams[1].key] ?? 0;
    const t = teamLine(teams, a, b);
    if (st.out > 0) notes.push(`${st.out} match${st.out === 1 ? "" : "es"} unfinished — not counted`);
    teamPersonal(t.winner);
    return { headline: t.headline, endedEarly: st.out > 0, notes, personal, signature: `team:${a}:${b}:${st.out}` };
  }
  if (teams && game.game_type === "trifecta") {
    const r = trifectaResults(game, players, [teams[0].key, teams[1].key]);
    const o = r.outlook;
    const t = teamLine(teams, o.decidedA, o.decidedB);
    if (o.open > 0) notes.push(`${pts(o.open)} point${o.open === 1 ? "" : "s"} from unfinished contests — not counted`);
    teamPersonal(t.winner);
    return { headline: t.headline, endedEarly: o.open > 0, notes, personal, signature: `trifecta:${o.decidedA}:${o.decidedB}:${o.open}` };
  }
  // Individual singles: each player's own match; no invented overall winner.
  if (game.game_type === "match") {
    const playerOf = playerLookup(players);
    let unfinished = 0; const sig: string[] = [];
    (game.pairings || []).forEach((pr) => {
      const pa = playerOf(pr.a), pb = playerOf(pr.b); if (!pa || !pb) return;
      const s = matchStatus(game.holes_meta, pa.scores || [], pb.scores || [], chBasis(pa, game.course_par, holes), chBasis(pb, game.course_par, holes), game.allowance_pct ?? 100);
      if (!s.result) { unfinished++; personal[pkey(pa)] = `your match with ${pb.display_name} was unfinished`; personal[pkey(pb)] = `your match with ${pa.display_name} was unfinished`; sig.push(`${pr.a}-${pr.b}:open`); return; }
      sig.push(`${pr.a}-${pr.b}:${s.lead}:${s.result}`);
      if (s.lead === 0) { personal[pkey(pa)] = `you halved with ${pb.display_name}`; personal[pkey(pb)] = `you halved with ${pa.display_name}`; return; }
      const [w, l] = s.lead > 0 ? [pa, pb] : [pb, pa];
      personal[pkey(w)] = `you beat ${l.display_name} ${s.result}`; personal[pkey(l)] = `${w.display_name} beat you ${s.result}`;
    });
    if (unfinished) notes.push(`${unfinished} match${unfinished === 1 ? "" : "es"} unfinished`);
    const n = (game.pairings || []).length;
    return { headline: `${n} singles match${n === 1 ? "" : "es"} played`, endedEarly: unfinished > 0, notes, personal, signature: `singles:${sig.join(",")}` };
  }
  if (game.game_type === "skins") {
    const s = skinsTotals(game, players);
    if (s.byTeam && teams) {
      const t = teamLine(teams, s.byTeam[teams[0].key] ?? 0, s.byTeam[teams[1].key] ?? 0);
      teamPersonal(t.winner);
      return { headline: `Skins: ${t.headline}`, endedEarly: false, notes, personal, signature: `skins-team:${s.byTeam.A}:${s.byTeam.B}` };
    }
    const ranked = live.map((p) => ({ p, n: s.byPlayer[pkey(p)] || 0 })).sort((x, y) => y.n - x.n);
    live.forEach((p) => { const n = s.byPlayer[pkey(p)] || 0; personal[pkey(p)] = `you won ${n} skin${n === 1 ? "" : "s"}`; });
    const top = ranked[0];
    const tied = ranked.filter((r) => r.n === top?.n);
    const headline = !top || top.n === 0 ? "No skins won" : tied.length > 1 ? `Skins: ${tied.map((r) => r.p.display_name).join(" and ")} tied with ${top.n}` : `Skins: ${top.p.display_name} won ${top.n}`;
    if (s.carry > 0) notes.push(`${s.carry} skin${s.carry === 1 ? "" : "s"} carried with no winner`);
    return { headline, endedEarly: false, notes, personal, signature: `skins:${ranked.map((r) => `${pkey(r.p)}=${r.n}`).join(",")}` };
  }
  // Stroke play / Stableford: the game's own ranking (lib/player-scoring), finishers only.
  const isStroke = game.game_type === "stroke";
  const finished = live.filter((p) => PS.playerThru(p) >= holes);
  const unfinished = live.filter((p) => PS.playerThru(p) > 0 && PS.playerThru(p) < holes);
  const board = PS.sortLeaderboard(finished, game);
  const score = (p: Player) => isStroke ? `${PS.strokeTotal(p, game)} ${game.stroke_basis === "gross" ? "gross" : "net"}` : `${PS.playerPoints(p, game)} points`;
  board.forEach((p) => {
    const pos = PS.posWithin(p, board, game);
    personal[pkey(p)] = `you finished ${ordinal(pos)} of ${board.length} with ${score(p)}`;
  });
  unfinished.forEach((p) => { personal[pkey(p)] = `your card was unfinished (thru ${PS.playerThru(p)})`; });
  if (unfinished.length) notes.push(`${unfinished.length} card${unfinished.length === 1 ? "" : "s"} unfinished — not ranked`);
  const top = board[0];
  const leaders = top ? board.filter((p) => PS.rankVal(p, game) === PS.rankVal(top, game) && (isStroke || PS.playerPoints(p, game) === PS.playerPoints(top, game))) : [];
  const headline = !top ? "No completed scorecards" : leaders.length > 1 ? `${leaders.map((p) => p.display_name).join(" and ")} tied with ${score(top)}` : `${top.display_name} won with ${score(top)}`;
  return { headline, endedEarly: unfinished.length > 0, notes, personal, signature: `${game.game_type}:${board.map((p) => `${pkey(p)}=${isStroke ? PS.strokeTotal(p, game) : PS.playerPoints(p, game)}`).join(",")}:${unfinished.length}` };
}
