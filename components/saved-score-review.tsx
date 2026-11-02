"use client";
import React, { useState, useSyncExternalStore } from "react";
import { C } from "@/lib/golf";
import { btn } from "@/components/ui";
import { savedScoreState, serverSavedScoreState, subscribeSavedScores, keepDatabaseScores, recoveryCopies, type ScoreReader } from "@/lib/saved-score-verification";
import { savedScoreReader, verifySavedScoresFromServer } from "@/lib/verify-saved-scores-server";

function download(data: string, filename: string) {
  const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function SavedScoreReview({ verify = verifySavedScoresFromServer, reader = savedScoreReader }: { verify?: () => Promise<void>; reader?: () => ScoreReader }) {
  const state = useSyncExternalStore(subscribeSavedScores, savedScoreState, serverSavedScoreState);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [kept, setKept] = useState<string | null>(null);
  const copies = state === serverSavedScoreState() ? [] : recoveryCopies();
  return <div style={{ marginTop: 16, color: C.cream, overflowWrap: "anywhere" }}>
    <div style={{ fontWeight: 700, fontSize: 15 }}>Saved-score verification</div>
    <div style={{ color: C.sage, fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>Verify saved game scores without reopening each game. Matches clear automatically. Differences stay saved for review. Personal rounds and team-score drafts still use their scorecards.</div>
    <button style={{ ...btn(false), marginTop: 12 }} disabled={state.busy} onClick={() => { setConfirm(null); setKept(null); void verify(); }}>{state.busy ? "Verifying…" : "Verify saved scores"}</button>
    {state.message && <div role="status" style={{ marginTop: 12, fontSize: 13 }}>{state.message}</div>}
    {state.reviews.map(review => <div key={review.key} style={{ borderTop: `1px solid ${C.borderGreen}`, marginTop: 12, paddingTop: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>{review.title}</div>
      <div style={{ fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>{review.message}</div>
      {review.differences.length > 0 && <details style={{ marginTop: 8, fontSize: 13 }}><summary>Review {review.differences.length} differing values</summary>
        <table style={{ width: "100%", tableLayout: "fixed", fontSize: 12, marginTop: 8 }}><thead><tr><th>Hole*</th><th>Field</th><th>Saved</th><th>Database</th></tr></thead><tbody>{review.differences.map(d => <tr key={`${d.hole}:${d.field}`}><td>{d.hole}</td><td>{d.field}</td><td>{String(d.local ?? "—")}</td><td>{String(d.database ?? "—")}</td></tr>)}</tbody></table>
        <div style={{ color: C.sage, marginTop: 8 }}>*Position in the scheduled scorecard; position 1 can be hole 10 for a back-nine game.</div>
      </details>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        <button style={btn(false)} onClick={() => download(JSON.stringify({ gameId: review.gameId, playerId: review.playerId, backupRaw: review.raw }, null, 2), `bnn-saved-scores-${review.gameId}.json`)}>Download saved scores</button>
        {review.state === "different" && <button style={btn(false)} disabled={state.busy} onClick={() => { setConfirm(null); setKept(review.key); }}>Keep saved scores</button>}
        {review.canKeepDatabase && <button style={btn(false)} disabled={state.busy} onClick={() => { setKept(null); setConfirm(review.key); }}>Use database version</button>}
      </div>
      {kept === review.key && <div role="status" style={{ marginTop: 12, fontSize: 13 }}>Your saved scores are unchanged and still protected. Download a copy and open this game's scorecard to recover them. If ended, the organizer must reopen it before corrections can be saved.</div>}
      {confirm === review.key && <div style={{ marginTop: 12, fontSize: 13 }}>Keep the database scores for this completed game? Your previous saved scores will be retained in Recovery copies; this action does not upload scores.
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}><button style={btn(true)} disabled={state.busy} onClick={() => { void keepDatabaseScores(review, reader()).then(ok => { if (ok) setConfirm(null); }); }}>Confirm database version</button><button style={btn(false)} disabled={state.busy} onClick={() => setConfirm(null)}>Cancel</button></div>
      </div>}
    </div>)}
    {copies.length > 0 && <details style={{ marginTop: 16, fontSize: 13 }}><summary>Recovery copies ({copies.length})</summary><div style={{ marginTop: 8 }}>Download copies before signing out or clearing website data. To restore scores, use the game's correction workflow; these copies are never uploaded automatically.</div>{copies.map(copy => <div key={copy.id} style={{ marginTop: 12 }}><div>{copy.title} · {copy.savedAt}</div><button style={{ ...btn(false), marginTop: 8 }} onClick={() => download(copy.data, `bnn-recovery-${copy.id.slice(-36)}.json`)}>Download recovery copy</button></div>)}</details>}
  </div>;
}
