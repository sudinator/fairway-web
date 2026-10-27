/**
 * 212.50 — the phone's side of LATE scores (owner, Oct 26: "once ended, scores only change if the organizer reopens").
 * When a game ends while a phone still has unsent scores, the server refuses them with BN164 (migration 0222). The
 * phone then: stops sending for that game (no endless retries), KEEPS the scores, tells the player once, and resumes
 * when the organizer reopens the game. The decisions live here so they can be tested; the game screen applies them.
 */
export const LATE_SCORE_CODE = "BN164";

/** The server refused a score because the game has ended. */
export const isLateScoreRefusal = (error: { code?: string | null } | null | undefined): boolean => error?.code === LATE_SCORE_CODE;

/** The one-time message. `scores` = what this phone still holds for the game (player holes + team / side scores). */
export function lateScoreNotice(scores: number): string {
  const what = scores > 0 ? `${scores} ${scores === 1 ? "score" : "scores"} on this phone weren't` : "the latest scores on this phone weren't";
  return `This game has ended, so ${what} added. They're kept on this phone — ask the organizer to reopen the game if they should count.`;
}

/** Hold the queue while the game is ended and a late score was refused; resume once it is reopened. */
export function lateScoreHold(state: { refused: boolean; status: string | null | undefined }): { hold: boolean; resume: boolean } {
  if (!state.refused) return { hold: false, resume: false };
  return state.status === "ended" ? { hold: true, resume: false } : { hold: false, resume: true };
}

/** Team / side scores count toward the message only in formats that keep them (scramble, alternate shot). */
export const keepsSideScores = (gameType: string | null | undefined): boolean => gameType === "alt_shot" || gameType === "scramble";
