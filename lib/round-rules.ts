// The ONE place that decides what a round is, for every statistic (210.5). Before this, each feature wrote its
// own check — and one of them let an empty scorecard count as a finished round ("best gross 0"), and
// converting a missing handicap gave 0 ("most improved 20 → 0"). ci/check_round_rules.py keeps statistics code
// from writing its own version again.
//
// The rules match BNN's handicap engine (lib/golf adjustedGross) and the recap:
//   * a hole counts only with a real score (a positive number);
//   * fewer than 9 holes scored is not a round (never scored / abandoned); 9 or more is a valid round, even if
//     it was marked complete early;
//   * a FULL CARD has a real score on every hole of the game — needed for anything compared stroke for stroke
//     (best gross / best net, the recap's finishers, net position);
//   * a missing handicap index is missing — never 0;
//   * alternate-shot scores belong to the pair, and scramble scores to the team, so they feed no individual
//     scoring statistic (and the database never posts them as anyone's round — post_game_rounds_internal).

type Scores = readonly (number | string | null | undefined)[] | null | undefined;

/** A hole's score if it is real (a positive number), else null. */
export function holeScore(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** How many of the game's holes have a real score. */
export function scoredHoles(scores: Scores, holes: number): number {
  if (!Array.isArray(scores)) return 0;
  let n = 0;
  for (let i = 0; i < holes; i++) if (holeScore(scores[i]) != null) n++;
  return n;
}

/** A real score on every hole of the game (holes > 0). */
export function isFullCard(scores: Scores, holes: number): boolean {
  return holes > 0 && scoredHoles(scores, holes) === holes;
}

/** A valid round: 9 or more holes scored (every hole, for a game shorter than 9). */
export function isValidRound(scores: Scores, holes: number): boolean {
  return holes > 0 && scoredHoles(scores, holes) >= Math.min(9, holes);
}

/** A full card on an 18-hole game. */
export function isFull18(scores: Scores, holes: number): boolean {
  return holes === 18 && isFullCard(scores, holes);
}

/** A real handicap index, or null — a missing index is never read as 0. */
export function handicapReading(v: unknown): number | null {
  if (v == null || (typeof v === "string" && v.trim() === "")) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Whether a format's scores belong to individual players (alternate shot: to the pair; scramble: to the team). */
export function countsForIndividualStats(gameType: string | null | undefined): boolean {
  return gameType !== "alt_shot" && gameType !== "scramble";
}

/** The one sentence that says shortened rounds don't count toward exceptional play (210.6, owner) — used by the
 *  recap (app and shared image) and the round-summary email, so they read word for word the same. */
export function shortenedNote(shortened: readonly { name: string; holes: number }[]): string | null {
  if (!shortened.length) return null;
  const parts = shortened.map((s, i) => (i === 0 ? `${s.name} (${s.holes} holes)` : `${s.name} (${s.holes})`));
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `Only completed rounds count toward top scores and standout rounds — ${list} ${shortened.length === 1 ? "isn't" : "aren't"} counted.`;
}
