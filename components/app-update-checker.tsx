"use client";
import React, { useEffect, useState, useSyncExternalStore } from "react";
import { C } from "@/lib/golf";
import { APP_VERSION } from "@/lib/app-version";
import { btn } from "@/components/ui";
import { automaticUpdateState, serverAutomaticUpdateState, subscribeAutomaticUpdates, checkAutomaticVersion } from "@/lib/automatic-updates";

export function UpdateChecker() {
  const state = useSyncExternalStore(subscribeAutomaticUpdates, automaticUpdateState, serverAutomaticUpdateState);
  const [copies, setCopies] = useState<string[]>([]);
  useEffect(() => {
    void checkAutomaticVersion();
    try { const st = window.localStorage; setCopies(Array.from({ length: st.length }, (_, i) => st.key(i)!).filter(k => k?.startsWith("bnn_verified_score_recovery:"))); } catch { /* export is optional */ }
  }, []);
  return <div style={{ background: C.greenLight, borderRadius: 12, padding: 16, marginTop: 12 }}>
    <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 17, fontWeight: 700 }}>App version &amp; updates</div>
    <div style={{ color: C.cream, fontSize: 13, marginTop: 12 }}>Current version: <b>{APP_VERSION}</b></div>
    <div style={{ color: C.sage, fontSize: 13, marginTop: 4 }}>Latest version: {state.latest || "Not checked yet"}</div>
    <div style={{ color: C.cream, fontSize: 13, marginTop: 12, lineHeight: 1.5 }}>Updates install automatically. A fresh open or refresh loads the latest version when connected. Unfinished rounds and saved scores do not block updates. An already-open game keeps running until you restart or refresh.</div>
    {state.message && <div role="status" style={{ color: C.cream, fontSize: 13, marginTop: 12 }}>{state.message}</div>}
    <button style={{ ...btn(false), marginTop: 12 }} disabled={state.checking} onClick={() => { void checkAutomaticVersion(); }}>{state.checking ? "Checking…" : "Check version"}</button>
    {copies.length > 0 && <div style={{ marginTop: 16, color: C.sage, fontSize: 13 }}>Previously saved recovery copies remain on this phone. Export them before signing out or clearing website data.
      <button style={{ ...btn(false), marginTop: 8 }} onClick={() => {
        const data = copies.map(key => ({ key, savedCopy: window.localStorage.getItem(key) }));
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
        const a = document.createElement("a"); a.href = url; a.download = "BNN-recovery-copies.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
      }}>Download recovery copies</button>
    </div>}
    <div style={{ color: C.sage, fontSize: 11, marginTop: 12 }}>Birdie Num Num — created by Amit Sud · © 2026 Amit Sud</div>
  </div>;
}
