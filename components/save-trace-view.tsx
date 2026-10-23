"use client";
// 212.25 / 212.27 — the save trace (lib/save-trace): the panel at the top of the game screen (when switched on), and
// its switch for Admin → Diagnostics.
import React, { useState, useSyncExternalStore } from "react";
import { subscribeTrace, traceLines, traceVersion, saveTraceEnabled, setSaveTraceEnabled } from "@/lib/save-trace";
import { C } from "@/lib/golf";
import { btn } from "@/components/ui";
export function SaveTraceView() {
  useSyncExternalStore(subscribeTrace, traceVersion, () => 0);
  const [open, setOpen] = useState(true);
  const lines = traceLines();
  return (
    <div data-save-trace style={{ background: C.ink, color: C.cream, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, borderRadius: 8, padding: "8px 12px", marginBottom: 8 }}>
      <div onClick={() => setOpen(!open)} style={{ color: C.gold, fontWeight: 700, cursor: "pointer" }}>SAVE TRACE {open ? "▾" : "▸"} <span style={{ color: C.sage, fontWeight: 500 }}>· off in Admin → Diagnostics</span></div>
      {open ? (lines.length ? lines.map((l, i) => <div key={i} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{l}</div>) : <div>— enter a score —</div>) : null}
    </div>
  );
}

/** True while the trace is switched on (re-renders when the switch changes). */
export function useSaveTraceOn(): boolean {
  useSyncExternalStore(subscribeTrace, traceVersion, () => 0);
  return saveTraceEnabled();
}

/** Admin → Diagnostics: the switch. */
export function SaveTraceToggle() {
  const on = useSaveTraceOn();
  return (
    <div data-save-trace-toggle style={{ marginTop: 18, border: `1px solid ${C.borderGreen}`, borderRadius: 12, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 16, fontWeight: 700, flex: 1 }}>Score-save trace</div>
        <button aria-pressed={on} onClick={() => setSaveTraceEnabled(!on)} style={{ ...btn(on), fontSize: 12 }}>{on ? "On" : "Off"}</button>
      </div>
      <div style={{ color: C.sage, fontSize: 12, marginTop: 6, lineHeight: 1.45 }}>
        Shows, at the top of the game screen, each step of saving a score — the tap, whether this device is the scorer, why a save was held, what was sent and what came back, and what each refresh kept. For this device only; switch it off when you&apos;re done.
      </div>
    </div>
  );
}
