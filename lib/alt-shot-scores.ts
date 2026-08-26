/**
 * Alternate shot score fan-out — one number entered, written to both partners' rows.
 *
 * WHY THE SCORE IS DUPLICATED
 * Scores live per player, as arrays on each `game_players` row, and the durable outbox syncs them
 * per row. A side in alternate shot has ONE score, so it has to go somewhere. Writing it to both
 * partners keeps every existing path working untouched — the outbox, the scorecard, the
 * leaderboard, the offline backup — and the duplication is honest: it is one score that genuinely
 * belongs to both players. Storing it on a nominated partner instead would leave the other with an
 * empty card, and a separate team-scores table would mean a second sync path alongside an outbox
 * that took real effort to get right.
 *
 * WHY THAT IS SAFE
 * The two writes carry an identical value, so a partial failure leaves the rows agreeing anyway —
 * there is no state where one partner has a 5 and the other a 4 unless someone edits one directly,
 * which sideScore() below detects rather than silently preferring one.
 *
 * These rounds do not post to handicaps (only one ball is in play, so no individual score exists),
 * which is why duplicating a gross score here cannot distort anyone's index.
 */

export type SideScoreWrite = {
  /** game_player id to write to. */
  playerId: string;
  holeIndex: number;
  strokes: number | null;
};

/**
 * The writes for one side scoring one hole: the same value to both partners.
 *
 * Returned as a list rather than performed here so the caller can put them through whatever it
 * already uses — the outbox, an optimistic local write, or both — instead of this module needing
 * to know about persistence.
 */
export function altShotScoreWrites(
  partnerIds: [string, string],
  holeIndex: number,
  strokes: number | null,
): SideScoreWrite[] {
  return partnerIds.map((playerId) => ({ playerId, holeIndex, strokes }));
}

export type SideScoreRead = {
  /** The side's score for the hole, or null if not yet entered. */
  strokes: number | null;
  /**
   * True when the two partners' rows disagree. Only reachable if a row was edited outside the
   * alternate-shot flow — an admin score correction, or a game converted from another format.
   * Surfaced rather than resolved, because silently preferring one partner would show a score
   * nobody entered.
   */
  conflict: boolean;
};

/**
 * Read a side's score for a hole from its two partners' rows.
 *
 * A missing value on one side is not a conflict: it is the normal state while the outbox is still
 * catching up, or when a partner joined after scoring began. Only two DIFFERENT numbers conflict.
 */
export function sideScore(
  a: (number | null)[] | null | undefined,
  b: (number | null)[] | null | undefined,
  holeIndex: number,
): SideScoreRead {
  const va = a?.[holeIndex] ?? null;
  const vb = b?.[holeIndex] ?? null;
  if (va == null && vb == null) return { strokes: null, conflict: false };
  if (va == null) return { strokes: vb, conflict: false };
  if (vb == null) return { strokes: va, conflict: false };
  return { strokes: va, conflict: va !== vb };
}

/**
 * Per-hole stats — putts, fairways, penalties — for a side.
 *
 * Deliberately NOT fanned out. Whose putt was it? In alternate shot the question has no answer at
 * the player level, and duplicating a putt count onto both partners would double the side's putts
 * in any aggregate and corrupt each player's own statistics for a round that is not theirs.
 *
 * Stats are recorded against the side, on the first partner's row only, and read from there. The
 * partner's row keeps nulls, which is correct: they did not personally take those putts either.
 */
export function altShotStatsOwner(partnerIds: [string, string]): string {
  return partnerIds[0];
}


// ---------------------------------------------------------------------------
// Finding the partner.

export type SidePlayer = { id: string; user_id: string | null };
export type Foursome = { id: string; name?: string; a?: string[] | null; b?: string[] | null };

/** Same rule as lib/game-shape's pkey: user_id when signed in, row id for a guest. */
const keyOf = (p: SidePlayer) => p.user_id ?? p.id;

/**
 * The two ROW ids making up the side that `playerId` belongs to.
 *
 * Foursome sides hold player KEYS, not row ids, so each key is mapped back through the players
 * list. Skipping that step would look correct for guests — whose key IS their row id — and
 * silently write nothing for every signed-in member.
 *
 * Returns null when the player is not in any foursome, or when their side does not hold exactly
 * two players. A side of one or three is not an alternate shot pair, and guessing which two to
 * write would put a score on someone who did not play the ball.
 */
export function partnerRowIds(
  playerId: string,
  foursomes: Foursome[] | null | undefined,
  players: SidePlayer[],
): [string, string] | null {
  const self = players.find((p) => p.id === playerId);
  if (!self || !Array.isArray(foursomes)) return null;
  const key = keyOf(self);

  for (const f of foursomes) {
    for (const side of [f?.a, f?.b]) {
      if (!Array.isArray(side) || !side.includes(key)) continue;
      const rows = side
        .map((k) => players.find((p) => keyOf(p) === k))
        .filter((p): p is SidePlayer => !!p)
        .map((p) => p.id);
      // Exactly two, and both resolvable. A player listed in a foursome but no longer in the game
      // — removed mid-round — leaves a key that resolves to nothing, and writing to the survivor
      // alone would quietly turn the pair into a single.
      if (rows.length !== 2) return null;
      return [rows[0], rows[1]];
    }
  }
  return null;
}
