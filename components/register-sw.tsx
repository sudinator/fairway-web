"use client";
import { useEffect, useSyncExternalStore } from "react";
import { automaticUpdateState, serverAutomaticUpdateState, subscribeAutomaticUpdates, registerAutomaticUpdates, requestAppUpdate, clearConfirmedUpdateNotice, newerVersion } from "@/lib/automatic-updates";
import { C } from "@/lib/golf";
import { btn } from "@/components/ui";
export function RegisterSW() {
  const state = useSyncExternalStore(subscribeAutomaticUpdates, automaticUpdateState, serverAutomaticUpdateState);
  useEffect(() => registerAutomaticUpdates(), []);
  const available = newerVersion(state.latest);
  useEffect(() => {
    if (!state.completed || available || !state.notice) return;
    const timer = window.setTimeout(clearConfirmedUpdateNotice, 8000);
    return () => window.clearTimeout(timer);
  }, [state.completed, state.notice, available]);
  if (!state.notice && !available) return null;
  return <aside aria-label="App update" style={{ position: "fixed", bottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)", left: 12, right: 12, zIndex: 1000, background: C.greenLight, color: C.cream, border: `1px solid ${C.gold}`, borderRadius: 12, padding: 16, boxShadow: "0 4px 16px #0006", maxHeight: "50dvh", overflowY: "auto" }}>
    <div role="status" style={{ fontSize: 13, lineHeight: 1.5 }}>{state.notice || `Version ${state.latest} is ready. Update now reloads the app. Finish your current entry first; unfinished rounds do not block updates.`}</div>
    {available && <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
      <button style={btn(true)} disabled={state.updating} onClick={() => { void requestAppUpdate(); }}>{state.updating ? "Updating…" : "Update now"}</button>
    </div>}
  </aside>;
}
