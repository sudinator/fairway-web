"use client";

import { rowPendingHoles } from "./draft";
import { emitSavedScoreVerification, scoringEditorOpen } from "./update-safety";

export const RECOVERY_PREFIX = "bnn_verified_score_recovery:";
const FIELDS = ["scores", "putts", "fairways", "penalties", "sand"] as const;
type Field = typeof FIELDS[number];
export type ScoreRow = Partial<Record<Field, unknown[] | null>> & { scoringVersion?: number };
export type VerifiedRow = { row: ScoreRow; game: { status: string; scoring_version: number; name?: string; code?: string }; player?: string };
export type ScoreReader = (gameId: string, playerId: string) => Promise<VerifiedRow | null>;
export type ScoreDifference = { hole: number; field: Field; local: unknown; database: unknown };
export type ScoreReview = { key: string; gameId: string; playerId: string; title: string; state: "different" | "unverified"; message: string; differences: ScoreDifference[]; canKeepDatabase: boolean; raw: string; watermark: string | null };
type Verification = { busy: boolean; message: string; reviews: ScoreReview[]; matched: number };
const INITIAL: Verification = { busy: false, message: "", reviews: [], matched: 0 };
let state = INITIAL;
const listeners = new Set<() => void>();
export const savedScoreState = () => state;
export const serverSavedScoreState = () => INITIAL;
export const subscribeSavedScores = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
function publish(patch: Partial<Verification>) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); }

function valid(row: any): row is ScoreRow {
  return !!row && typeof row === "object" && FIELDS.every(f => row[f] == null || (Array.isArray(row[f]) && row[f].length <= 36 && row[f].every((v: unknown) => v == null || ["number", "string", "boolean"].includes(typeof v))));
}
function value(row: ScoreRow, field: Field, i: number) {
  return row[field]?.[i] ?? (field === "penalties" ? 0 : field === "sand" ? false : null);
}
export function savedScoreDifferences(local: ScoreRow, remote: ScoreRow): ScoreDifference[] {
  if (!valid(local) || !valid(remote)) throw new Error("Invalid score data");
  const n = Math.max(0, ...FIELDS.flatMap(f => [local[f]?.length || 0, remote[f]?.length || 0]));
  const result: ScoreDifference[] = [];
  for (let i = 0; i < n; i++) for (const field of FIELDS) {
    const a = value(local, field, i), b = value(remote, field, i);
    if (a !== b) result.push({ hole: i + 1, field, local: a, database: b });
  }
  return result;
}
function bundle(row: ScoreRow) { return Object.fromEntries(FIELDS.map(f => [f, row[f] || []])); }
function entries() {
  const st = window.localStorage;
  return Array.from({ length: st.length }, (_, i) => st.key(i)!).filter(Boolean).flatMap(key => {
    const logical = key.replace(/^bnn_device_scores:[^:]*:[^:]*:/, "");
    if (!logical.startsWith("bnn_game_scores_")) return [];
    const ids = logical.slice("bnn_game_scores_".length), split = ids.lastIndexOf("_");
    if (split < 1) return [];
    return [{ key, gameId: ids.slice(0, split), playerId: ids.slice(split + 1), wm: key.replace("bnn_game_scores_", "bnn_game_wm_") }];
  });
}
function unchanged(key: string, raw: string, watermark: string | null) {
  return window.localStorage.getItem(key) === raw && window.localStorage.getItem(key.replace("bnn_game_scores_", "bnn_game_wm_")) === watermark;
}
async function boundedRead(read: ScoreReader, gameId: string, playerId: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([read(gameId, playerId), new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 8000); })]); }
  finally { clearTimeout(timer); }
}
let running: Promise<void> | null = null;
export function verifySavedScores(read: ScoreReader): Promise<void> {
  if (running) return running;
  if (state.busy) return Promise.resolve();
  running = run(read).finally(() => { running = null; });
  return running;
}
async function run(read: ScoreReader) {
  publish({ busy: true, message: "Verifying saved scores with the database…" });
  const reviews: ScoreReview[] = []; let matched = 0;
  try {
    const queue = entries();
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) {
        const e = queue.shift()!, raw = window.localStorage.getItem(e.key);
        if (!raw) continue;
        const watermark = window.localStorage.getItem(e.wm);
        const review: ScoreReview = { ...e, raw, watermark, title: `Saved game (${e.gameId.slice(0, 8)})`, state: "unverified", message: "Could not verify this saved scorecard. Reconnect and try again; its scores are preserved.", differences: [], canKeepDatabase: false };
        try {
          const local = JSON.parse(raw), wm = JSON.parse(watermark || "null");
          if (!valid(local) || (wm && !valid(wm))) throw new Error("Invalid saved data");
          if (rowPendingHoles(local as any, wm) === 0) continue;
          const remote = await boundedRead(read, e.gameId, e.playerId);
          if (!unchanged(e.key, raw, watermark)) { review.message = "This scorecard changed during verification. Verify again after saving."; reviews.push(review); continue; }
          if (!remote || !valid(remote.row)) { reviews.push(review); continue; }
          review.title = `${remote.game.name || "Game"}${remote.game.code ? ` · #${remote.game.code}` : ""}${remote.player ? ` · ${remote.player}` : ""}`;
          const differences = savedScoreDifferences(local, remote.row);
          // A changed reset/version is a separate recovery decision, never silently acknowledged.
          if ((local.scoringVersion ?? 0) !== remote.game.scoring_version) {
            review.message = "The game was reset or its scoring version changed. Open its scorecard to review recovery; saved scores are preserved.";
            reviews.push(review); continue;
          }
          if (!differences.length) {
            window.localStorage.setItem(e.wm, JSON.stringify(bundle(local)));
            matched++; emitSavedScoreVerification();
          } else {
            review.state = "different"; review.differences = differences;
            review.canKeepDatabase = remote.game.status === "ended";
            review.message = remote.game.status === "ended" ? "Saved values differ from the database. Review them below. Keep saved scores to recover them through the scorecard, or explicitly keep the database version." : "Saved values differ. Finish and sync this active game's scorecard; verification never uploads or overwrites scores.";
            reviews.push(review);
          }
        } catch { reviews.push(review); }
      }
    }));
    publish({ reviews, matched, message: `${matched} saved scorecard${matched === 1 ? "" : "s"} verified as matching.${reviews.length ? ` ${reviews.length} need review or could not be verified.` : " No outstanding game-score differences were found."}` });
  } catch { publish({ message: "Saved scores could not be checked. Keep your saved data and try again." }); }
  finally { publish({ busy: false }); }
}

// The caller has shown the differences and obtained an explicit choice. Re-read
// both sides; a stale review, active game, editor, failed read or archive failure vetoes it.
export async function onlyScoringWindow(): Promise<boolean> {
  try {
    if (!("serviceWorker" in navigator)) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    const worker = reg?.waiting || reg?.active;
    if (!worker) return false;
    return await new Promise<boolean>(resolve => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 4000);
      channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data?.alone === true); };
      try { worker.postMessage({ kind: "bnn-score-review-alone" }, [channel.port2]); }
      catch { clearTimeout(timer); channel.port1.close(); resolve(false); }
    });
  } catch { return false; }
}
export async function keepDatabaseScores(review: ScoreReview, read: ScoreReader, alone = onlyScoringWindow): Promise<boolean> {
  if (state.busy) return false;
  publish({ busy: true });
  try {
    if (!await alone() || scoringEditorOpen() || !unchanged(review.key, review.raw, review.watermark)) throw new Error();
    const remote = await boundedRead(read, review.gameId, review.playerId);
    const local = JSON.parse(review.raw);
    if (!remote || remote.game.status !== "ended" || !valid(remote.row) || !valid(local) || (local.scoringVersion ?? 0) !== remote.game.scoring_version || scoringEditorOpen() || !unchanged(review.key, review.raw, review.watermark)) throw new Error();
    if (JSON.stringify(savedScoreDifferences(local, remote.row)) !== JSON.stringify(review.differences)) throw new Error();
    if (!await alone() || scoringEditorOpen() || !unchanged(review.key, review.raw, review.watermark)) throw new Error();
    const archiveKey = `${RECOVERY_PREFIX}${crypto.randomUUID()}`;
    const archive = JSON.stringify({ savedAt: new Date().toISOString(), gameId: review.gameId, playerId: review.playerId, title: review.title, backup: local, previousConfirmation: JSON.parse(review.watermark || "null"), database: remote.row });
    window.localStorage.setItem(archiveKey, archive);
    if (window.localStorage.getItem(archiveKey) !== archive || !unchanged(review.key, review.raw, review.watermark)) throw new Error();
    // Preserve the local backup as a recovery archive. No database writes occur.
    const confirmed = bundle(remote.row);
    window.localStorage.setItem(review.key.replace("bnn_game_scores_", "bnn_game_wm_"), JSON.stringify(confirmed));
    if (window.localStorage.getItem(review.key) !== review.raw) throw new Error();
    window.localStorage.setItem(review.key, JSON.stringify({ ...confirmed, at: Date.now(), scoringVersion: remote.game.scoring_version }));
    emitSavedScoreVerification();
    publish({ reviews: state.reviews.filter(r => r.key !== review.key), message: "Database version kept. Your previous saved scores remain in Recovery copies below. No database scores were changed." });
    return true;
  } catch { publish({ message: "Nothing was discarded. Verification changed or could not finish. Close other BNN tabs and score editors, reconnect and verify again before making a choice." }); return false; }
  finally { publish({ busy: false }); }
}
export function recoveryCopies(): { id: string; title: string; savedAt: string; data: string }[] {
  try {
    const st = window.localStorage;
    return Array.from({ length: st.length }, (_, i) => st.key(i)!).filter(k => k?.startsWith(RECOVERY_PREFIX)).map(id => { const data = st.getItem(id)!, a = JSON.parse(data); return { id, title: a.title, savedAt: a.savedAt, data }; });
  } catch { return []; }
}
