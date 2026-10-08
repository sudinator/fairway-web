// The line-up card's data (200.0). Pure; every figure comes from the engine functions the scorecard
// itself uses, so what a player reads before the round is what the round will apply:
//   chBasis         — course handicap for the holes being played (9 vs 18, manual vs derived)
//   applyAllowance  — Playing Handicap: CH × allowance, rounded (Rule 6.2a, .5 up)
//   matchAllowance  — strokes in a 1-v-1 (each side rounded first, then the difference)
//   trifectaSingles — which two singles a Trifecta foursome plays
//   altShotSides    — side handicaps and strokes in alternate shot
// The former card printed the course handicap in bold with no allowance applied, no slope or
// rating, and no opponent: a player on a 90% game read "15" and played off 14 without being told.
import { applyAllowance, applyAllowanceExact, matchAllowance, trifectaSingles } from "./golf";
import { chBasis, pkey, altShotSides } from "./game-shape";
import type { CourseTee } from "./courses";

export type LineupPlayer = {
  id: string; user_id: string | null; display_name: string;
  handicap_index?: number | null; course_handicap?: number | null; course_handicap_source?: "derived" | "manual" | null;
  slope?: number | null; rating?: number | null;
  tee_name?: string | null; team?: string | null; tee_group?: number | null; no_show?: boolean | null;
};
export type LineupGame = {
  name?: string | null; course?: string | null; game_type: string; allowance_pct?: number | null; played_at?: string | null;
  course_par?: number | null; holes_meta?: { n: number }[] | null;
  teams?: { key: string; name: string }[] | null;
  pairings?: { a: string; b: string }[] | null;
  foursomes?: { id: string; name: string; a: string[]; b: string[]; swap?: boolean }[] | null;
};

export type LineupContest = {
  kind: "single" | "team" | "altshot";
  /** "Singles", "Four-ball", "Alternate shot" */
  label: string;
  partner: string | null;
  opponents: string[];
  /** Positive = this player receives, negative = gives, 0 = level; null = cannot be computed yet. */
  strokes: number | null;
  /** How the strokes arise, in words — "off the low man, Bob (PH 6)" / "difference of playing handicaps". */
  basis: string;
};

export type LineupRow = {
  key: string; name: string; team: string | null; teamName: string | null;
  group: string | null;            // foursome name or "Grp N"
  tee: string | null; rating: number | null; slope: number | null;
  index: number | null;
  courseHandicap: number | null;   // chBasis, rounded — the whole-number figure a golfer calls their course handicap
  courseHandicapExact: number | null; // chBasis as the engine uses it (unrounded; 15.2, not 15). The
                                      // arithmetic line prints THIS, because 15 × 90% is 13.5 and the
                                      // engine's answer is 13.7 — a card that shows 15 lies about its input.
  allowancePct: number;
  playingExact: number | null;     // CH × allowance, unrounded
  playingHandicap: number | null;  // the figure actually played off
  noShow: boolean;
  contests: LineupContest[];
};

export type Lineup = {
  tees: { name: string; rating: number | null; slope: number | null }[];
  allowancePct: number;
  rows: LineupRow[];
  /** Group names in the GAME'S order (foursomes as the organizer arranged them, then tee groups
   *  numerically, then "Players"). The picker and the page use this; deriving the order from the
   *  alphabetical player list put Group 1 last whenever its first player sorted late. */
  groups: string[];
};

const r1 = (n: number) => Math.round(n * 10) / 10;

export function buildLineup(game: LineupGame, players: LineupPlayer[], courseTees: CourseTee[] = []): Lineup {
  const holes = game.holes_meta?.length;
  const allowance = game.allowance_pct ?? 100;
  const byKey = new Map(players.map((p) => [pkey(p), p]));
  const nameOf = (k: string) => byKey.get(k)?.display_name ?? "?";
  const chOf = (p: LineupPlayer) => (p.course_handicap != null
    ? chBasis({ ...p, course_handicap: p.course_handicap, handicap_index: p.handicap_index ?? undefined, slope: p.slope ?? undefined, rating: p.rating ?? undefined, course_handicap_source: p.course_handicap_source ?? undefined }, game.course_par, holes)
    : null);
  const teamName = (key: string | null | undefined) => {
    if (!key) return null;
    const t = (game.teams || []).find((x) => x.key === key);
    return t ? `Team ${t.name || t.key}` : `Team ${key}`;
  };
  const teeOf = (name: string | null | undefined) => courseTees.find((t) => t.name === name) || null;

  // Tees in use, with rating and slope — once, in the header.
  const teeNames = Array.from(new Set(players.map((p) => p.tee_name).filter((x): x is string => !!x)));
  const tees = teeNames.map((n) => ({ name: n, rating: teeOf(n)?.rating ?? null, slope: teeOf(n)?.slope ?? null }));

  const contestsFor = (p: LineupPlayer): LineupContest[] => {
    const me = pkey(p);
    const out: LineupContest[] = [];
    const myCh = chOf(p);

    if (game.game_type === "match") {
      const pr = (game.pairings || []).find((x) => x.a === me || x.b === me);
      if (pr) {
        const oppKey = pr.a === me ? pr.b : pr.a;
        const opp = byKey.get(oppKey);
        const oppCh = opp ? chOf(opp) : null;
        let strokes: number | null = null;
        if (myCh != null && oppCh != null) { const m = matchAllowance(myCh, oppCh, allowance); strokes = m.a - m.b; }
        out.push({ kind: "single", label: "Singles", partner: null, opponents: [nameOf(oppKey)], strokes, basis: "difference of playing handicaps" });
      }
      return out;
    }

    const f = (game.foursomes || []).find((x) => x.a.includes(me) || x.b.includes(me));
    if (!f) return out;
    const mine = f.a.includes(me) ? f.a : f.b;
    const theirs = f.a.includes(me) ? f.b : f.a;
    const partnerKey = mine.find((k) => k !== me) ?? null;

    if (game.game_type === "alt_shot") {
      const sides = altShotSides(game as never, players as never, f);
      const iAmA = f.a.includes(me);
      const strokes = sides.receiving == null ? (sides.aCh != null && sides.bCh != null ? 0 : null)
        : (sides.receiving === "a") === iAmA ? sides.strokes : -sides.strokes;
      out.push({ kind: "altshot", label: "Alternate shot", partner: partnerKey ? nameOf(partnerKey) : null, opponents: theirs.map(nameOf), strokes,
        basis: "side handicaps (combined CH × allowance), then the difference" });
      return out;
    }

    // Trifecta: two genuine singles first.
    if (game.game_type === "trifecta" && f.a.length === 2 && f.b.length === 2) {
      for (const [aK, bK] of trifectaSingles(f.a, f.b, !!f.swap)) {
        if (aK !== me && bK !== me) continue;
        const oppKey = aK === me ? bK : aK;
        const opp = byKey.get(oppKey);
        const oppCh = opp ? chOf(opp) : null;
        let strokes: number | null = null;
        if (myCh != null && oppCh != null) { const m = matchAllowance(myCh, oppCh, allowance); strokes = m.a - m.b; }
        out.push({ kind: "single", label: "Singles", partner: null, opponents: [nameOf(oppKey)], strokes, basis: "difference of playing handicaps" });
      }
    }

    // Four-ball leg (fourball and trifecta): strokes off the low man of the foursome.
    if (game.game_type === "fourball" || game.game_type === "trifecta") {
      const members = [...f.a, ...f.b].map((k) => byKey.get(k)).filter((x): x is LineupPlayer => !!x && !x.no_show);
      const adj = members.map((m) => ({ m, ph: chOf(m) != null ? applyAllowance(chOf(m), allowance) : null }));
      const known = adj.filter((x): x is { m: LineupPlayer; ph: number } => x.ph != null);
      let strokes: number | null = null; let basis = "off the low man of the group";
      if (myCh != null && known.length === members.length && known.length > 0) {
        const low = known.reduce((a, b) => (b.ph < a.ph ? b : a));
        strokes = applyAllowance(myCh, allowance) - low.ph;
        basis = low.m.display_name === p.display_name ? "you are the low man of the group" : `off the low man, ${low.m.display_name} (PH ${low.ph})`;
      }
      out.push({ kind: "team", label: "Four-ball", partner: partnerKey ? nameOf(partnerKey) : null, opponents: theirs.map(nameOf), strokes, basis });
    }
    return out;
  };

  const rows: LineupRow[] = [...players]
    .sort((a, b) => String(a.display_name).localeCompare(String(b.display_name)))
    .map((p) => {
      const ch = chOf(p);
      const tee = teeOf(p.tee_name);
      const f = (game.foursomes || []).find((x) => x.a.includes(pkey(p)) || x.b.includes(pkey(p)));
      return {
        key: pkey(p), name: p.display_name, team: p.team ?? null, teamName: teamName(p.team),
        group: f?.name ?? (p.tee_group != null ? `Grp ${p.tee_group}` : null),
        tee: p.tee_name ?? null, rating: tee?.rating ?? null, slope: tee?.slope ?? null,
        index: p.handicap_index ?? null,
        courseHandicap: ch != null ? Math.round(ch) : null,
        courseHandicapExact: ch != null ? r1(ch) : null,
        allowancePct: allowance,
        playingExact: ch != null ? r1(applyAllowanceExact(ch, allowance)) : null,
        playingHandicap: ch != null ? applyAllowance(ch, allowance) : null,
        noShow: !!p.no_show,
        contests: contestsFor(p),
      };
    });

  const groupOrder: string[] = [];
  for (const f of game.foursomes || []) if (f.name && !groupOrder.includes(f.name)) groupOrder.push(f.name);
  const teeGroups = Array.from(new Set(players.map((p) => p.tee_group).filter((x): x is number => x != null))).sort((a, b) => a - b).map((n) => `Grp ${n}`);
  for (const g of teeGroups) if (!groupOrder.includes(g)) groupOrder.push(g);
  for (const r of rows) { const g = r.group || "Players"; if (!groupOrder.includes(g)) groupOrder.push(g); }
  return { tees, allowancePct: allowance, rows, groups: groupOrder };
}

/** "you get 3 strokes" / "you give 2" / "level" — the words a golfer uses. */
export function strokesPhrase(strokes: number | null): string {
  if (strokes == null) return "strokes TBD";
  if (strokes === 0) return "level";
  const n = Math.abs(strokes);
  const unit = n === 1 ? "stroke" : "strokes";
  return strokes > 0 ? `you get ${n} ${unit}` : `you give ${n} ${unit}`;
}

/** Plain-text version for "Copy as text": the same facts as the card, nothing the card lacks. */
export function buildLineupText(game: LineupGame, lineup: Lineup): string {
  const lines: string[] = [];
  lines.push(game.name?.trim() || "Line-up");
  const sub = [game.course, game.played_at].filter(Boolean).join(" \u00b7 ");
  if (sub) lines.push(sub);
  for (const t of lineup.tees) lines.push(`${t.name} tees${t.rating != null ? ` \u00b7 ${t.rating} / ${t.slope ?? "\u2014"}` : ""}`);
  if (lineup.allowancePct !== 100) lines.push(`${lineup.allowancePct}% allowance: Playing Handicap = Course Handicap \u00d7 ${lineup.allowancePct / 100}, rounded`);
  lines.push("");
  for (const r of lineup.rows) {
    const bits = [r.teamName, r.group, r.tee ? `${r.tee} tees` : null].filter(Boolean).join(" \u00b7 ");
    const hcp = r.courseHandicap == null ? "CH \u2014"
      : lineup.allowancePct === 100 ? `CH ${r.courseHandicap} (idx ${r.index ?? "\u2014"})`
      : `CH ${r.courseHandicapExact} \u00d7 ${lineup.allowancePct}% = ${r.playingExact} \u2192 PH ${r.playingHandicap} (idx ${r.index ?? "\u2014"})`;
    lines.push(`${r.name}${bits ? ` \u2014 ${bits}` : ""}${r.noShow ? " \u00b7 no-show" : ""}`);
    lines.push(`  ${hcp}`);
    for (const c of r.contests) {
      lines.push(`  ${c.label}${c.partner ? ` with ${c.partner}` : ""} vs ${c.opponents.join(" & ")}: ${strokesPhrase(c.strokes)}`);
    }
  }
  return lines.join("\n");
}
