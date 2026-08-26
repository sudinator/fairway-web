/**
 * Match length — 18 holes, front nine, or back nine.
 *
 * Games take their holes straight from the course, so a game on an 18-hole course has always been
 * 18 holes with no way to play a nine. This module is the shared piece: it belongs to every
 * format, not just alternate shot, because a nine-hole singles match or four-ball is just as
 * ordinary as a nine-hole foursomes.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * It does not renumber holes. A back-nine match is played on holes 10-18 and the card must say so
 * — a player looking at "hole 1" while standing on the 10th tee is a scoring error waiting to
 * happen. The hole numbers and stroke indexes are the course's own throughout.
 */

export type MatchLength = "18" | "front9" | "back9";

export const MATCH_LENGTHS: { value: MatchLength; label: string; short: string }[] = [
  { value: "18", label: "18 holes", short: "18" },
  { value: "front9", label: "Front nine", short: "F9" },
  { value: "back9", label: "Back nine", short: "B9" },
];

type HoleLike = { hole_number?: number | null; par?: number | null; si?: number | null };

/**
 * The holes actually in play.
 *
 * Selection is by POSITION in the course's own hole list rather than by hole_number, because a
 * nine-hole course, a composite layout, or a course whose holes are numbered from 10 would all
 * break a hole_number filter. The first half is the front nine by definition.
 *
 * A course with fewer than 18 holes is returned whole for any selection: there is no back nine to
 * take, and silently returning an empty card would be far worse than ignoring the request.
 */
export function holesForLength<T extends HoleLike>(courseHoles: T[], length: MatchLength): T[] {
  if (!Array.isArray(courseHoles) || courseHoles.length < 18) return courseHoles ?? [];
  const half = Math.floor(courseHoles.length / 2);
  if (length === "front9") return courseHoles.slice(0, half);
  if (length === "back9") return courseHoles.slice(half);
  return courseHoles;
}

/** How many holes a selection yields, for labels and for the match runner's totalHoles. */
export function holeCountFor(courseHoles: HoleLike[], length: MatchLength): number {
  return holesForLength(courseHoles, length).length;
}

/**
 * Course Handicap for a nine-hole match: half the 18-hole figure.
 *
 * A player off 14 does not receive 14 strokes over nine holes — they receive 7. Applying the full
 * figure would give a stroke on nearly every hole and make the handicap meaningless.
 *
 * ORDER MATTERS: halve the COURSE handicap first, then apply any format allowance (50% for
 * foursomes, 90% for four-ball, and so on). That is the published order — each player's nine-hole
 * Course Handicap is computed for their tee, then the event allowance is applied.
 *
 * THIS IS AN APPROXIMATION, and deliberately so. Under WHS a nine-hole Course Handicap comes from
 * that nine's OWN Course Rating and Slope, which differ between the front and back — clubs are
 * issued separate nine-hole tables precisely because you cannot just halve the eighteen-hole
 * figure. BNN stores one rating and slope per tee for the full course, because that is what
 * GolfCourseAPI publishes, so the exact method is not available. Halving is the standard practical
 * substitute and matches what a group playing a casual nine would do. Documented rather than
 * hidden, so that if per-nine ratings ever arrive nobody has to rediscover why this was inexact.
 *
 * The result is NOT rounded: rounding here and again when the format allowance is applied loses a
 * stroke. Rounding belongs at the end of the chain, where a whole number is actually needed.
 */
export function courseHandicapForLength(ch: number | null, length: MatchLength): number | null {
  if (ch == null) return null;
  return length === "18" ? ch : ch / 2;
}

/**
 * A label for the card and the game list: "Back nine", or the course's own hole range when that is
 * more useful to someone standing on a tee.
 */
export function matchLengthLabel(length: MatchLength, holes: HoleLike[]): string {
  const def = MATCH_LENGTHS.find((m) => m.value === length);
  if (!def) return "18 holes";
  if (length === "18" || !holes.length) return def.label;
  const first = holes[0]?.hole_number;
  const last = holes[holes.length - 1]?.hole_number;
  return first != null && last != null ? `${def.label} (${first}\u2013${last})` : def.label;
}

// ---------------------------------------------------------------------------
// Setup asks this as TWO questions: how many holes, then — only if nine — which nine. These
// helpers keep that flow honest so a screen cannot leave the pair in an impossible state, such as
// an 18-hole match that still remembers "back nine" from a previous answer.

/** The first question. */
export type HoleCountChoice = "18" | "9";

/** The second question, asked only when the first answer is "9". */
export type NineChoice = "front9" | "back9";

/** Which nine a length refers to, or null for an 18-hole match. */
export function nineOf(length: MatchLength): NineChoice | null {
  return length === "18" ? null : length;
}

/** The first answer, derived from the stored length. */
export function holeCountOf(length: MatchLength): HoleCountChoice {
  return length === "18" ? "18" : "9";
}

/**
 * Apply the first answer. Choosing 18 discards any previously chosen nine, so an organiser who
 * picks "back nine" and then changes to 18 does not leave a stale answer behind. Choosing 9
 * defaults to the front, which is the more common casual nine and is immediately changeable.
 */
export function setHoleCount(current: MatchLength, choice: HoleCountChoice): MatchLength {
  if (choice === "18") return "18";
  return current === "18" ? "front9" : current;
}

/** Apply the second answer. Only meaningful once the first answer is "9". */
export function setNine(nine: NineChoice): MatchLength {
  return nine;
}

/** Whether the setup flow should show the front/back question at all. */
export function needsNineChoice(length: MatchLength): boolean {
  return holeCountOf(length) === "9";
}

/**
 * A nine can only be chosen on a course with two of them. On a nine-hole course the question is
 * meaningless and must not be asked — there is one nine and it is the whole course.
 */
export function canChooseNine(courseHoles: HoleLike[]): boolean {
  return Array.isArray(courseHoles) && courseHoles.length >= 18;
}
