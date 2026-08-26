/**
 * Alternate shot (foursomes) — 2v2 match play with ONE ball per side.
 *
 * The format: two partners share a single ball and alternate strokes. One tees off on odd holes,
 * the other on even holes, and that order must hold for the whole round. Because only one ball is
 * in play, the WHS allowance is 50% of the two partners' combined Course Handicaps.
 *
 * WHY THIS IS NOT `fourball`
 * `fourball` is also 2v2, which makes the two easy to confuse. The difference is the number of
 * balls: in four-ball each player plays their own and the side takes the better score; here there
 * is one ball, so the side has one score full stop. That single fact drives everything below —
 * the side's hole score is entered rather than derived, and the handicap is halved rather than
 * applied per player.
 *
 * WHY THESE ROUNDS DO NOT COUNT FOR HANDICAP
 * A foursomes round produces no individual score, so it is not an acceptable score for WHS
 * Handicap Index purposes. The app must not post it to a player's rounds or to GHIN. That is a
 * deliberate exclusion, not an oversight — see altShotPostsRounds() below, which exists purely so
 * the rule is stated in code and can be asserted.
 */

export type AltShotSide = {
  /** Stable key for the side, e.g. the foursome id plus "a" or "b". */
  key: string;
  name: string;
  /** The two partners' game_player ids. */
  playerIds: [string, string];
  /** Each partner's Course Handicap, before the 50% allowance. */
  courseHandicaps: [number | null, number | null];
};

export type TeamHandicap = {
  /**
   * The team Course Handicap, or null when a partner's handicap is unknown.
   *
   * EXACT, not rounded — it can legitimately be 7.5. Rounding here and again at the difference
   * loses a stroke: 28 and 15 combined give 14 and 7.5, a difference of 6.5 that rounds to 7;
   * pre-rounding gives 14 and 8, a difference of 6.
   */
  value: number | null;
  /** Indices (0 or 1) of partners whose handicap is missing. Empty when both are known. */
  missing: number[];
  /**
   * What the team handicap WOULD be if the missing partners played off scratch. Offered so the
   * organiser can accept it deliberately — never applied automatically.
   */
  ifScratch: number;
};

/**
 * Team Course Handicap: 50% of the two partners' combined Course Handicaps, rounded half-up.
 * Match play cannot give half a stroke, so a whole number is required.
 *
 * A MISSING handicap is reported, not guessed. The two are very different matches: a partner who
 * plays off 20 counted as scratch turns a team handicap of 17 into 7, handing the other side ten
 * strokes nobody agreed to — and nothing on screen would say so. `ifScratch` exists so the
 * organiser can choose that outcome explicitly, which is a legitimate way to play; what is not
 * legitimate is the app choosing it for them.
 */
export function altShotTeamHandicap(a: number | null, b: number | null): TeamHandicap {
  const missing: number[] = [];
  if (a == null) missing.push(0);
  if (b == null) missing.push(1);
  const ifScratch = ((a ?? 0) + (b ?? 0)) / 2;
  return { value: missing.length ? null : ifScratch, missing, ifScratch };
}

/**
 * The team handicap actually used in a match, given the organiser's decision.
 *
 * `playScratchIfMissing` is that decision, made in the setup flow after the warning. Defaulting it
 * to false means an unresolved handicap produces no strokes rather than the wrong strokes — the
 * match shows as unhandicapped, which is visible, instead of subtly skewed, which is not.
 */
export function altShotEffectiveHandicap(
  t: TeamHandicap,
  playScratchIfMissing = false,
): number | null {
  if (t.value != null) return t.value;
  return playScratchIfMissing ? t.ifScratch : null;
}

/**
 * Strokes given in a match: the difference between the two sides' team handicaps, applied to the
 * side with the higher handicap. The lower side always plays off scratch, which is how match play
 * handicapping works — only the difference matters, never the absolute figures.
 */
export function altShotMatchStrokes(
  sideA: number | null,
  sideB: number | null,
): { receiving: "a" | "b" | null; strokes: number } {
  if (sideA == null || sideB == null) return { receiving: null, strokes: 0 };
  const diff = sideA - sideB;
  if (diff === 0) return { receiving: null, strokes: 0 };
  // The ONLY rounding in the chain, half-up, because a side cannot receive half a stroke on a
  // hole. Rounding the team handicaps first instead would lose a stroke on any pairing whose
  // combined total is odd.
  const strokes = Math.round(Math.abs(diff));
  if (strokes === 0) return { receiving: null, strokes: 0 };
  return diff > 0 ? { receiving: "a", strokes } : { receiving: "b", strokes };
}

/**
 * Which partner tees off on a given hole.
 *
 * The side nominates who takes the odd holes before starting, and it cannot change mid-round.
 * `oddTeePlayerId` is that nomination; the other partner takes the even holes. Returned so the
 * scoring screen can show whose turn it is, which is the thing pairs actually forget out on the
 * course — and getting it wrong is a penalty under Rule 22.
 */
export function altShotTeeOrder(
  side: Pick<AltShotSide, "playerIds">,
  oddTeePlayerId: string,
  holeNumber: number,
): string {
  const [first, second] = side.playerIds;
  const odd = oddTeePlayerId === second ? second : first;
  const even = odd === first ? second : first;
  return holeNumber % 2 === 1 ? odd : even;
}

/**
 * Net score for a side on one hole: the single gross score less any stroke received.
 *
 * `recv` comes from the usual stroke-index allocation, run against the side's MATCH strokes rather
 * than either partner's own handicap.
 */
export function altShotNet(gross: number | null, recv: number): number | null {
  if (gross == null) return null;
  return gross - recv;
}

export type HoleResult = "a" | "b" | "halved" | null;

/**
 * Who won the hole on low net. null means the hole is not yet complete — distinct from "halved",
 * which is a real result. Conflating the two is how a match ends up showing a lead that has not
 * been played.
 */
export function altShotHoleResult(
  grossA: number | null,
  recvA: number,
  grossB: number | null,
  recvB: number,
): HoleResult {
  const na = altShotNet(grossA, recvA);
  const nb = altShotNet(grossB, recvB);
  if (na == null || nb == null) return null;
  if (na === nb) return "halved";
  return na < nb ? "a" : "b";
}

export type MatchState = {
  /** Positive = side A up by that many; negative = side B up. */
  lead: number;
  holesPlayed: number;
  holesRemaining: number;
  /** e.g. "3 & 2", "2 up", "All square", "Halved" once closed. */
  label: string;
  /** True once the lead exceeds the holes left — the match is decided. */
  decided: boolean;
};

/**
 * Run the match. `results` is one entry per hole in play order; nulls are holes not yet played.
 *
 * A match closes as soon as one side is up by more holes than remain, which is why the label is
 * "3 & 2" rather than a final score — the remaining holes are not played.
 */
export function altShotMatch(results: HoleResult[], totalHoles = 18): MatchState {
  let lead = 0;
  let played = 0;
  let decidedAt: number | null = null;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r == null) continue;
    played++;
    if (r === "a") lead++;
    else if (r === "b") lead--;
    const remainingAfter = totalHoles - (i + 1);
    if (decidedAt == null && Math.abs(lead) > remainingAfter) decidedAt = i + 1;
  }

  const remaining = Math.max(0, totalHoles - played);
  const up = Math.abs(lead);

  let label: string;
  if (decidedAt != null) {
    const left = totalHoles - decidedAt;
    // "3 & 2" — up by three with two to play. "N up" when it goes the distance.
    label = left > 0 ? `${up} & ${left}` : `${up} up`;
  } else if (played === totalHoles) {
    label = lead === 0 ? "Halved" : `${up} up`;
  } else if (lead === 0) {
    label = "All square";
  } else {
    label = `${up} up`;
  }

  return { lead, holesPlayed: played, holesRemaining: remaining, label, decided: decidedAt != null };
}

/**
 * Alternate shot rounds are NOT acceptable scores for handicap purposes: only one ball is in play,
 * so no individual score exists. Stated as a function rather than a comment so the exclusion can
 * be asserted by a test and cannot be quietly dropped by a later change to the finish flow.
 */
export function altShotPostsRounds(): false {
  return false;
}
