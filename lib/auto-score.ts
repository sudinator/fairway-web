// STAGING-only: randomised scores through hole N (204.2), so the owner can watch a game progress
// without entering four scorecards by hand. Never offered in production (the organizer panel checks
// the html[data-env] marker the layout sets from VERCEL_GIT_COMMIT_REF). Writes go through the SAME
// RPC a scorecard uses (save_game_score_bundle), so fences, versions and triggers all apply.
export function randomHoleScore(par: number, rnd: () => number = Math.random): number {
  // A plausible club golfer: birdie 8%, par 30%, bogey 36%, double 18%, triple 8%.
  const r = rnd();
  if (r < 0.08) return Math.max(1, par - 1);
  if (r < 0.38) return par;
  if (r < 0.74) return par + 1;
  if (r < 0.92) return par + 2;
  return par + 3;
}

/** Scores 1..through filled (existing kept where present), the rest untouched. */
export function autoScores(existing: (number | null)[] | null | undefined, holes: { par: number }[], through: number, rnd: () => number = Math.random): (number | null)[] {
  const n = holes.length;
  const out: (number | null)[] = Array.from({ length: n }, (_, i) => existing?.[i] ?? null);
  for (let i = 0; i < Math.min(through, n); i++) if (out[i] == null || out[i]! <= 0) out[i] = randomHoleScore(holes[i].par, rnd);
  return out;
}

export function isStagingClient(): boolean {
  try { return typeof document !== "undefined" && document.documentElement.getAttribute("data-env") === "staging"; } catch { return false; }
}
