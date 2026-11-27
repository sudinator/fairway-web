"use client";
/**
 * Profile → Sign out (212.130). The button runs lib/sign-out signOutSafely: a scan for scores that exist only on this
 * phone, a question before they would be left behind, the sign-out awaited, and a cleanup scoped to the signed-out
 * identity. When unsynced work is found the row says so and offers the recovery download beside the button, so a member
 * can keep a copy without going anywhere else first.
 */
import React, { useEffect, useState } from "react";
import { C } from "@/lib/golf";
import { btn } from "@/components/ui";
import { askConfirm } from "@/components/confirm";
import { notifyError } from "@/components/toast";
import { signOutSafely, unsyncedWork, retireUnsyncable, retiredSummary, type UnsyncedItem, type GameState } from "@/lib/sign-out";
import { downloadScoringRecovery } from "@/lib/scoring-device";

export function SignOutRow({ userId, onSignOut, onOpenGame, gameStates }: { userId: string; onSignOut: () => Promise<{ error: { message?: string } | null }>; onOpenGame?: (gameId: string) => void; gameStates?: (gameIds: string[]) => Promise<GameState[] | null> }) {
  const [pending, setPending] = useState<UnsyncedItem[]>([]);
  const [cleared, setCleared] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const mine = () => unsyncedWork(undefined, userId).filter((p) => p.owner === userId);   // this member's own items; another account's are kept regardless
    try { setPending(mine()); } catch { setPending([]); return; }
    // 212.135: entries for games the server has deleted or ended are cleared automatically (owner decision) and said so
    void (async () => {
      try {
        const { retired, archived } = await retireUnsyncable(mine(), userId, gameStates, window.localStorage);
        if (!alive || !retired.length) return;
        setCleared(retiredSummary(retired, archived)); setPending(mine());
      } catch { /* the notice keeps showing what is on the phone */ }
    })();
    return () => { alive = false; };
  }, [userId, gameStates]);
  return (
    <div style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${C.borderGreen}` }}>
      {cleared && <div data-retired-notice style={{ color: C.sage, fontSize: 12, lineHeight: 1.5, marginBottom: 10 }}>{cleared}</div>}
      {pending.length > 0 && (
        <div data-unsynced-notice style={{ color: C.gold, fontSize: 12, lineHeight: 1.5, marginBottom: 10 }}>
          {pending.length === 1 ? "Scores on this phone haven’t synced yet" : `${pending.length} items on this phone haven’t synced yet`} — open that scorecard online to sync before signing out.
          {/* 212.134 (owner): each item opens its game — opening the scorecard is what sends the entries; the holes are named */}
          <div style={{ color: C.sage, marginTop: 4 }}>{pending.slice(0, 5).map((p) => (
            p.gameId && onOpenGame
              ? <button key={p.key} type="button" data-unsynced-item={p.gameId} onClick={() => onOpenGame(p.gameId!)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", background: "none", border: "none", borderTop: `1px solid ${C.green}`, padding: "8px 0", color: C.cream, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                  <span style={{ flex: 1 }}>{p.label}{p.holes?.length ? <span style={{ color: C.sage, fontWeight: 500, fontSize: 11 }}> · hole{p.holes.length === 1 ? "" : "s"} {p.holes.join(", ")}</span> : null}</span>
                  <span style={{ color: C.sage, fontSize: 11 }}>Open ›</span>
                </button>
              : <div key={p.key}>{p.label}</div>
          ))}</div>
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button style={{ ...btn(false), fontSize: 13, opacity: busy ? 0.62 : 1 }} disabled={busy} onClick={async () => {
          setBusy(true);
          try { await signOutSafely(userId, { signOut: onSignOut, confirm: askConfirm, notify: notifyError, gameStates }); } finally { setBusy(false); }
        }}>{busy ? "Signing out…" : "Sign out"}</button>
        {pending.length > 0 && <button style={{ ...btn(false), fontSize: 13 }} onClick={() => downloadScoringRecovery()}>Download saved scores</button>}
      </div>
    </div>
  );
}
