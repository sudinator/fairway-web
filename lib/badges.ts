// Achievements / badges. This module is PURE: `evaluateRound` takes a finished
// round + the player's prior badge state and returns the awards that round earns.
// No I/O here — the caller (compute-on-finish / backfill) persists to member_badges.
import { Round, Hole, played, isGrossOnly, isGIR, roundDifferential } from "./golf";

export type BadgeKind = "once" | "count" | "best" | "milestone";
export type BadgeTier = "common" | "rare" | "elite";
export type BadgeCategory = "scoring" | "streaks" | "ballstriking" | "milestones";

export type BadgeDef = {
  key: string;
  label: string;
  icon: string;        // emoji for the disc
  tier: BadgeTier;
  kind: BadgeKind;
  category: BadgeCategory;
  dir?: 1 | -1;        // for "best" badges: +1 higher is better, -1 lower is better
  desc: string;        // one-line explainer
};

// The full catalog. `key` is the stable id stored in member_badges.badge_key.
export const BADGES: BadgeDef[] = [
  // --- Scoring ---
  { key: "best_vs_par", label: "Best round vs par", icon: "🏆", tier: "elite", kind: "best", dir: -1, category: "scoring", desc: "Your lowest 18-hole score relative to par." },
  { key: "best_differential", label: "Best differential", icon: "🎯", tier: "elite", kind: "best", dir: -1, category: "scoring", desc: "Your lowest handicap differential." },
  { key: "first_birdie", label: "First birdie", icon: "🐦", tier: "common", kind: "once", category: "scoring", desc: "Made your first birdie." },
  { key: "birdie", label: "Birdie", icon: "🐤", tier: "common", kind: "count", category: "scoring", desc: "Holes played one under par." },
  { key: "birdie_par3", label: "Birdie on a par 3", icon: "🎽", tier: "rare", kind: "count", category: "scoring", desc: "The hardest birdie to make." },
  { key: "eagle", label: "Eagle or better", icon: "🦅", tier: "rare", kind: "count", category: "scoring", desc: "Two or more under par on a hole." },
  { key: "first_eagle", label: "First eagle", icon: "✨", tier: "rare", kind: "once", category: "scoring", desc: "Made your first eagle." },
  { key: "par_train", label: "Par train", icon: "🚂", tier: "common", kind: "count", category: "scoring", desc: "Four or more pars in a row." },
  { key: "even_par_nine", label: "Even-par nine", icon: "⚖️", tier: "rare", kind: "count", category: "scoring", desc: "Level par or better over a nine." },
  { key: "broke_100", label: "Broke 100", icon: "💯", tier: "common", kind: "once", category: "scoring", desc: "Shot under 100 for the first time." },
  { key: "broke_90", label: "Broke 90", icon: "9️⃣", tier: "common", kind: "once", category: "scoring", desc: "Shot under 90 for the first time." },
  { key: "broke_85", label: "Broke 85", icon: "🎿", tier: "rare", kind: "once", category: "scoring", desc: "Shot under 85 for the first time." },
  { key: "broke_80", label: "Broke 80", icon: "8️⃣", tier: "rare", kind: "once", category: "scoring", desc: "Shot under 80 for the first time." },
  { key: "broke_par", label: "Broke par", icon: "👑", tier: "elite", kind: "once", category: "scoring", desc: "Shot par or better for a round." },

  // --- Streaks & consistency ---
  { key: "bogey_free_3", label: "Bogey-free 3+", icon: "✅", tier: "common", kind: "count", category: "streaks", desc: "Three or more holes in a row without a bogey." },
  { key: "bogey_free_5", label: "Bogey-free 5+", icon: "🔗", tier: "rare", kind: "count", category: "streaks", desc: "Five or more holes in a row without a bogey." },
  { key: "bogey_free_9", label: "Bogey-free nine", icon: "🔥", tier: "rare", kind: "count", category: "streaks", desc: "A full front or back nine with no bogeys." },
  { key: "bogey_free_round", label: "Bogey-free round", icon: "🧊", tier: "elite", kind: "count", category: "streaks", desc: "Eighteen holes without a single bogey." },
  { key: "bounce_back", label: "Bounce-back", icon: "↩️", tier: "common", kind: "count", category: "streaks", desc: "A birdie on the hole right after a bogey." },
  { key: "no_blowups", label: "No blow-ups", icon: "🛡️", tier: "rare", kind: "count", category: "streaks", desc: "A full round with no double bogey or worse." },

  // --- Ball-striking & short game ---
  { key: "best_fairways", label: "Best fairways", icon: "🎯", tier: "common", kind: "best", dir: 1, category: "ballstriking", desc: "Most fairways hit in a round." },
  { key: "best_gir", label: "Best greens", icon: "🟢", tier: "common", kind: "best", dir: 1, category: "ballstriking", desc: "Most greens in regulation in a round." },
  { key: "fewest_putts", label: "Fewest putts", icon: "⛳", tier: "rare", kind: "best", dir: -1, category: "ballstriking", desc: "Fewest total putts in a round." },
  { key: "no_three_putts", label: "No 3-putts", icon: "🚫", tier: "common", kind: "count", category: "ballstriking", desc: "A full round without a three-putt." },
  { key: "no_penalties", label: "Clean card", icon: "🧼", tier: "common", kind: "count", category: "ballstriking", desc: "A full round with no penalty strokes." },
  { key: "sand_save", label: "Sand save", icon: "🏖️", tier: "rare", kind: "count", category: "ballstriking", desc: "Up-and-down for par from a greenside bunker." },
  { key: "scramble_master", label: "Scramble master", icon: "🎩", tier: "elite", kind: "count", category: "ballstriking", desc: "Four or more up-and-downs in a round." },

  // --- Milestones ---
  { key: "first_round", label: "First round", icon: "🏁", tier: "common", kind: "once", category: "milestones", desc: "Logged your first round." },
  { key: "rounds_5", label: "5 rounds", icon: "🖐️", tier: "common", kind: "milestone", category: "milestones", desc: "Played five rounds." },
  { key: "rounds_10", label: "10 rounds", icon: "📅", tier: "common", kind: "milestone", category: "milestones", desc: "Played ten rounds." },
  { key: "rounds_25", label: "25 rounds", icon: "🎖️", tier: "rare", kind: "milestone", category: "milestones", desc: "Played twenty-five rounds." },
  { key: "rounds_50", label: "50 rounds", icon: "🏅", tier: "rare", kind: "milestone", category: "milestones", desc: "Played fifty rounds." },
  { key: "rounds_100", label: "100 rounds", icon: "💠", tier: "elite", kind: "milestone", category: "milestones", desc: "Played one hundred rounds." },
];

export const BADGE_BY_KEY: Record<string, BadgeDef> = Object.fromEntries(BADGES.map((b) => [b.key, b]));

export type Award = { key: string; kind: BadgeKind; value?: number; isRecord?: boolean };

// Prior state = what member_badges holds for this player BEFORE this round.
export type PriorBadges = {
  priorRounds: number;                 // count of finished rounds before this one
  bests: Record<string, number>;       // key -> current best_value
  earned: Set<string>;                 // keys already earned (for once/milestone gating)
};

// Evaluate a single finished round. Returns the awards it produces. Pure.
export function evaluateRound(r: Round, prior: PriorBadges): Award[] {
  const awards: Award[] = [];
  const add = (key: string, kind: BadgeKind, value?: number, isRecord?: boolean) => awards.push({ key, kind, value, isRecord });
  const considerBest = (key: string, value: number, dir: 1 | -1) => {
    const prev = prior.bests[key];
    if (prev == null) add(key, "best", value, false);
    else if (dir === 1 ? value > prev : value < prev) add(key, "best", value, true);
  };

  // Milestones (rounds played, this round inclusive)
  const n = prior.priorRounds + 1;
  if (n === 1 && !prior.earned.has("first_round")) add("first_round", "once");
  for (const t of [5, 10, 25, 50, 100]) if (n >= t && !prior.earned.has(`rounds_${t}`)) add(`rounds_${t}`, "milestone");

  // Best differential (works for gross-only too)
  const diff = roundDifferential(r);
  if (diff != null) considerBest("best_differential", diff, -1);

  const holes = played(r).slice().sort((a, b) => a.hole_number - b.hole_number);
  const grossOnly = isGrossOnly(r);
  const gross = grossOnly ? (r.gross_score as number) : (holes.length ? holes.reduce((s, h) => s + (h.strokes || 0), 0) : null);
  const par = r.course_par ?? (holes.length ? holes.reduce((s, h) => s + h.par, 0) : null);
  const fullRound = holes.length >= 18 || (grossOnly && gross != null);

  // Round vs par + gross thresholds
  if (fullRound && gross != null && par != null) {
    const vsPar = gross - par;
    considerBest("best_vs_par", vsPar, -1);
    for (const [key, thr] of [["broke_100", 100], ["broke_90", 90], ["broke_85", 85], ["broke_80", 80]] as const)
      if (gross < thr && !prior.earned.has(key)) add(key, "once");
    if (vsPar <= 0 && !prior.earned.has("broke_par")) add("broke_par", "once");
  }

  // Everything below needs per-hole detail
  if (holes.length) {
    // Birdies / eagles
    let birdies = 0, eagles = 0, par3birdie = 0;
    for (const h of holes) {
      if (h.strokes == null) continue;
      const tp = h.strokes - h.par;
      if (tp <= -2) eagles++;
      else if (tp === -1) { birdies++; if (h.par === 3) par3birdie++; }
    }
    if (birdies + eagles > 0 && !prior.earned.has("first_birdie")) add("first_birdie", "once");
    if (birdies + eagles > 0) add("birdie", "count", birdies + eagles);
    if (par3birdie > 0) add("birdie_par3", "count", par3birdie);
    if (eagles > 0) { add("eagle", "count", eagles); if (!prior.earned.has("first_eagle")) add("first_eagle", "once"); }

    // Streaks over consecutive played holes
    const toPar = holes.map((h) => (h.strokes != null ? h.strokes - h.par : null));
    let curBF = 0, maxBF = 0, curPar = 0, maxPar = 0, bounce = 0, blowup = false;
    for (let i = 0; i < holes.length; i++) {
      const tp = toPar[i];
      if (tp == null) { curBF = 0; curPar = 0; continue; }
      if (tp <= 0) { curBF++; if (curBF > maxBF) maxBF = curBF; } else curBF = 0;
      if (tp === 0) { curPar++; if (curPar > maxPar) maxPar = curPar; } else curPar = 0;
      if (tp >= 2) blowup = true;
      const prev = toPar[i - 1];
      if (i > 0 && prev != null && prev >= 1 && tp <= -1) bounce++;
    }
    if (maxBF >= 3) add("bogey_free_3", "count");
    if (maxBF >= 5) add("bogey_free_5", "count");
    if (maxPar >= 4) add("par_train", "count");
    if (bounce > 0) add("bounce_back", "count", bounce);

    // Nines / full round
    const front = holes.filter((h) => h.hole_number >= 1 && h.hole_number <= 9);
    const back = holes.filter((h) => h.hole_number >= 10 && h.hole_number <= 18);
    const nineClean = (hs: Hole[]) => hs.length >= 9 && hs.every((h) => h.strokes != null && h.strokes - h.par <= 0);
    if (nineClean(front) || nineClean(back)) add("bogey_free_9", "count");
    if (holes.length >= 18 && holes.every((h) => h.strokes != null && h.strokes - h.par <= 0)) add("bogey_free_round", "count");
    const nineSum = (hs: Hole[]) => hs.reduce((s, h) => s + ((h.strokes || 0) - h.par), 0);
    if ((front.length >= 9 && nineSum(front) <= 0) || (back.length >= 9 && nineSum(back) <= 0)) add("even_par_nine", "count");
    if (holes.length >= 18 && !blowup) add("no_blowups", "count");

    // Putts
    const puttHoles = holes.filter((h) => h.putts != null);
    if (holes.length >= 18 && puttHoles.length >= 18) {
      considerBest("fewest_putts", puttHoles.reduce((s, h) => s + (h.putts as number), 0), -1);
      if (!holes.some((h) => h.putts != null && (h.putts as number) >= 3)) add("no_three_putts", "count");
    }

    // Penalties
    if (holes.length >= 18 && holes.every((h) => h.strokes != null)) {
      if (holes.reduce((s, h) => s + (h.penalties || 0), 0) === 0) add("no_penalties", "count");
    }

    // Fairways / greens (best in a round)
    const firHoles = holes.filter((h) => h.par >= 4 && h.fairway != null);
    if (firHoles.length > 0) considerBest("best_fairways", firHoles.filter((h) => h.fairway === "hit").length, 1);
    const girHoles = holes.filter((h) => h.strokes != null && h.putts != null);
    if (girHoles.length > 0) considerBest("best_gir", girHoles.filter((h) => isGIR(h)).length, 1);

    // Short game: sand saves + scrambles (need strokes & putts to know GIR)
    const scoredWithPutts = holes.filter((h) => h.strokes != null && h.putts != null);
    const sand = scoredWithPutts.filter((h) => h.sand && !isGIR(h) && (h.strokes as number) <= h.par).length;
    if (sand > 0) add("sand_save", "count", sand);
    const scrambles = scoredWithPutts.filter((h) => !isGIR(h) && (h.strokes as number) <= h.par).length;
    if (scrambles >= 4) add("scramble_master", "count");
  }

  return awards;
}

// A fully-reconciled badge row for one (user, badge_key), derived purely from the
// player's finished rounds. Deterministic: same rounds -> same rows.
export type BadgeRow = {
  badge_key: string;
  count: number;
  best_value: number | null;
  best_round_id: string | null;
  first_earned_at: string;  // the played_at of the round that first earned it
  last_earned_at: string;   // the played_at of the round that most recently earned/updated it
};

// Replay all finished rounds in chronological order, accumulating badge state.
// This is the single source of truth for both compute-on-finish and backfill —
// running it over the current finished-rounds list always yields the correct
// full set, so persistence is just a diff/upsert against these rows.
export function computeBadgeState(finished: Round[]): Record<string, BadgeRow> {
  const sorted = finished.slice().sort((a, b) => {
    const d = (a.played_at || "").localeCompare(b.played_at || "");
    return d !== 0 ? d : (a.id || "").localeCompare(b.id || "");
  });
  const state: PriorBadges = { priorRounds: 0, bests: {}, earned: new Set() };
  const rows: Record<string, BadgeRow> = {};
  for (const r of sorted) {
    const awards = evaluateRound(r, state);
    for (const a of awards) {
      const when = r.played_at;
      let row = rows[a.key];
      if (!row) row = rows[a.key] = { badge_key: a.key, count: 0, best_value: null, best_round_id: null, first_earned_at: when, last_earned_at: when };
      if (a.kind === "count") row.count += a.value ?? 1;
      else if (row.count < 1) row.count = 1;         // once / milestone / best => held at 1
      if (a.kind === "best") { row.best_value = a.value ?? null; row.best_round_id = r.id; state.bests[a.key] = a.value as number; }
      row.last_earned_at = when;
      state.earned.add(a.key);
    }
    state.priorRounds++;
  }
  return rows;
}
