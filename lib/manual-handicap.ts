/**
 * The manual course handicap's save (0153; 212.75). The number entered IS the course handicap for this game and its hole
 * count — used as given, not halved for a nine. Clearing it returns the player to the DERIVED figure, and 212.75 (owner,
 * Oct 30, production game 947286) stores that figure in the row: the leaderboard prints the stored number while the
 * card recomputes it, and a cleared row that kept the manual number showed CH 13 on one and CH 18 on the other.
 */
import { courseHandicap } from "@/lib/golf";

export type ManualHandicapPatch =
  | { course_handicap: number | null; course_handicap_source: "derived"; course_handicap_set_by: null; course_handicap_set_at: null }
  | { course_handicap: number; course_handicap_source: "manual"; course_handicap_set_by: string | null; course_handicap_set_at: string };

export function manualHandicapPatch(
  p: { handicap_index: number | null; rating: number | null; slope: number | null },
  coursePar: number | null, value: number | null, userId: string | null, now = new Date(),
): ManualHandicapPatch {
  if (value == null) {
    const derived = p.handicap_index != null && p.rating != null && p.slope != null && coursePar != null
      ? courseHandicap(p.handicap_index, p.slope, p.rating, coursePar) : null;
    return { course_handicap: derived, course_handicap_source: "derived", course_handicap_set_by: null, course_handicap_set_at: null };
  }
  return { course_handicap: value, course_handicap_source: "manual", course_handicap_set_by: userId, course_handicap_set_at: now.toISOString() };
}
