"use client";
import React, { useSyncExternalStore } from "react";
import { C } from "@/lib/golf";
import { btn } from "@/components/ui";
import { updateState, subscribeAppUpdate, serverUpdateState, type UpdateState } from "@/lib/app-update";
import type { UpdateBlocker } from "@/lib/update-safety";

export function useAppUpdate() { return useSyncExternalStore(subscribeAppUpdate, updateState, serverUpdateState); }
export function visibleUpdateBlockers(reported: UpdateBlocker[], live: UpdateBlocker[]) {
  const remote = reported.filter(item => item.key.startsWith("tab:") || ["other-tab", "tabs-changed"].includes(item.key));
  return [...new Map([...remote, ...live].map(item => [item.title + item.action, item])).values()];
}
export function UpdateBlockerList({ blockers }: { blockers: UpdateBlocker[] }) {
  if (!blockers.length) return <div style={{ color: C.sage, fontSize: 13 }}>No pending scoring was found in this browser’s saved data. Other open tabs are checked when you choose Update.</div>;
  return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    {blockers.map(item => <div key={item.key} style={{ borderTop: `1px solid ${C.borderGreen}`, paddingTop: 12 }}>
      <div style={{ color: C.cream, fontSize: 13, fontWeight: 700, overflowWrap: "anywhere" }}>{item.title}</div>
      {item.key.startsWith("tab:") && <div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>Reported by another tab at the last update attempt. Choose Update again after resolving it.</div>}
      <div style={{ color: C.sage, fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>{item.action}</div>
    </div>)}
  </div>;
}
export function UpdateBannerView({ state, onApply, onDismiss, onDetails }: { state: UpdateState; onApply: () => void; onDismiss: () => void; onDetails: () => void }) {
  const busy = state.phase === "preparing" || state.phase === "reloading";
  const title = state.phase === "success" ? "Update installed" : state.phase === "blocked" ? "Update paused" : state.phase === "failed" ? "Update did not complete" : "A new version is available";
  return <div data-update-notice role="status" aria-live="polite" style={{ position: "fixed", left: 12, right: 12, bottom: "calc(12px + env(safe-area-inset-bottom))", background: C.greenLight, border: `1px solid ${C.gold}`, borderRadius: 12, padding: "13px 16px", zIndex: 100 }}>
    <div style={{ color: C.cream, fontSize: 15, fontWeight: 700 }}>{title}</div>
    <div style={{ color: C.sage, fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>{state.message || `Version ${state.latest} is ready. Your current app stays in use until you update.`}</div>
    {state.blockers.length > 0 && <div style={{ color: C.cream, fontSize: 13, marginTop: 4, overflowWrap: "anywhere" }}>{state.blockers[0].title}{state.blockers.length > 1 ? ` · ${state.blockers.length - 1} more` : ""}</div>}
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
      {state.phase !== "success" && state.phase !== "blocked" && <button style={btn(true)} onClick={onApply} disabled={busy}>{busy ? "Updating…" : state.phase === "failed" ? "Try again" : "Update"}</button>}
      {state.phase !== "success" && <button style={btn(false)} onClick={onDetails} disabled={busy}>Details</button>}
      <button style={btn(false)} onClick={onDismiss} disabled={busy} aria-label="Dismiss update notice">Dismiss</button>
    </div>
  </div>;
}
