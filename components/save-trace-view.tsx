"use client";
// 212.25 — the save trace (lib/save-trace), on staging only, at the top of the game screen.
import React, { useState, useSyncExternalStore } from "react";
import { subscribeTrace, traceLines, traceVersion } from "@/lib/save-trace";
import { C } from "@/lib/golf";
export function SaveTraceView() {
  useSyncExternalStore(subscribeTrace, traceVersion, () => 0);
  const [open, setOpen] = useState(true);
  const lines = traceLines();
  return (
    <div data-save-trace style={{ background: C.ink, color: C.cream, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, borderRadius: 8, padding: "8px 12px", marginBottom: 8 }}>
      <div onClick={() => setOpen(!open)} style={{ color: C.gold, fontWeight: 700, cursor: "pointer" }}>SAVE TRACE (staging) {open ? "▾" : "▸"}</div>
      {open ? (lines.length ? lines.map((l, i) => <div key={i} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{l}</div>) : <div>— enter a score —</div>) : null}
    </div>
  );
}
