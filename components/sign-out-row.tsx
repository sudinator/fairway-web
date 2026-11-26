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
import { signOutSafely, unsyncedWork, type UnsyncedItem } from "@/lib/sign-out";
import { downloadScoringRecovery } from "@/lib/scoring-device";

export function SignOutRow({ userId, onSignOut }: { userId: string; onSignOut: () => Promise<{ error: { message?: string } | null }> }) {
  const [pending, setPending] = useState<UnsyncedItem[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { try { setPending(unsyncedWork()); } catch { setPending([]); } }, []);
  return (
    <div style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${C.borderGreen}` }}>
      {pending.length > 0 && (
        <div data-unsynced-notice style={{ color: C.gold, fontSize: 12, lineHeight: 1.5, marginBottom: 10 }}>
          {pending.length === 1 ? "Scores on this phone haven’t synced yet" : `${pending.length} items on this phone haven’t synced yet`} — open that scorecard online to sync before signing out.
          <div style={{ color: C.sage, marginTop: 4 }}>{pending.slice(0, 3).map((p) => <div key={p.key}>{p.label}</div>)}</div>
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button style={{ ...btn(false), fontSize: 13, opacity: busy ? 0.62 : 1 }} disabled={busy} onClick={async () => {
          setBusy(true);
          try { await signOutSafely(userId, { signOut: onSignOut, confirm: askConfirm, notify: notifyError }); } finally { setBusy(false); }
        }}>{busy ? "Signing out…" : "Sign out"}</button>
        {pending.length > 0 && <button style={{ ...btn(false), fontSize: 13 }} onClick={() => downloadScoringRecovery()}>Download saved scores</button>}
      </div>
    </div>
  );
}
