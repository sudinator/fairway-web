"use client";
import React from "react";
import { C } from "@/lib/golf";
import { APP_VERSION } from "@/lib/app-version";
import { btn } from "@/components/ui";
import { useUpdateBlockers } from "@/components/update-safety";
import { useAppUpdate, UpdateBlockerList, visibleUpdateBlockers } from "@/components/app-update-status";
import { applyAppUpdate, checkForUpdate } from "@/lib/app-update";

export function UpdateChecker() {
  const local = useUpdateBlockers(), update = useAppUpdate();
  const blockers = visibleUpdateBlockers(update.blockers, local);
  const busy = update.phase === "preparing" || update.phase === "reloading" || update.phase === "checking";
  const isNewer = !!update.latest && update.latest !== APP_VERSION;
  return <div style={{ background: C.greenLight, borderRadius: 12, padding: 16, marginTop: 12 }}>
    <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 17, fontWeight: 700 }}>App version &amp; updates</div>
    <div style={{ color: C.cream, fontSize: 13, marginTop: 12 }}>Current version: <b>{APP_VERSION}</b></div>
    <div style={{ color: C.sage, fontSize: 13, marginTop: 4 }}>Latest version: {update.latest || "Not checked yet"}</div>
    {update.message && <div role="status" aria-live="polite" style={{ color: C.cream, fontSize: 13, marginTop: 12, lineHeight: 1.5 }}>{update.message}</div>}
    {blockers.length > 0 && <div style={{ color: C.cream, fontSize: 15, fontWeight: 700, marginTop: 12 }}>Updates are paused — what needs attention</div>}
    <div style={{ marginTop: 12 }}><UpdateBlockerList blockers={blockers} /></div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
      <button style={btn(false)} disabled={busy} onClick={() => { window.dispatchEvent(new Event("bnn-check-update-status")); void checkForUpdate(true); }}>{busy ? "Checking…" : "Check again"}</button>
      {isNewer && local.length === 0 && <button style={btn(true)} disabled={busy} onClick={() => { void applyAppUpdate(); }}>{update.phase === "preparing" || update.phase === "reloading" ? "Updating…" : `Update to ${update.latest}`}</button>}
    </div>
    <div style={{ color: C.sage, fontSize: 13, marginTop: 12, lineHeight: 1.5 }}>Dismissing the update notice only hides it for that release. You can return here to update at any time. No scores or drafts are removed.</div>
    <div style={{ color: C.sage, fontSize: 11, marginTop: 12 }}>Birdie Num Num — created by Amit Sud · © 2026 Amit Sud</div>
  </div>;
}
