"use client";
import React, { useEffect, useState } from "react";

// A tiny global toast so a failed database write becomes VISIBLE instead of a silent
// no-op. Any code can call notifyError(msg); a single <Toaster/> (mounted in home)
// renders it above everything, including modal overlays.
type Toast = { id: number; msg: string; kind: "error" | "info" };
let listeners: ((t: Toast) => void)[] = [];
let seq = 1;

function emit(msg: string, kind: "error" | "info") {
  const t = { id: seq++, msg, kind };
  listeners.forEach((l) => l(t));
}
export function notifyError(msg: string) { emit(msg, "error"); }
export function notifyInfo(msg: string) { emit(msg, "info"); }

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    const on = (t: Toast) => {
      setToasts((prev) => [...prev, t]);
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), 6000);
    };
    listeners.push(on);
    return () => { listeners = listeners.filter((l) => l !== on); };
  }, []);
  if (!toasts.length) return null;
  return (
    <div style={{ position: "fixed", left: 0, right: 0, bottom: 88, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, zIndex: 99999, pointerEvents: "none", padding: "0 16px" }}>
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
          style={{ pointerEvents: "auto", cursor: "pointer", maxWidth: 440, width: "100%", background: t.kind === "error" ? "#B83A2E" : "#16503D", color: "#FFFDF6", borderRadius: 12, padding: "12px 14px", fontSize: 13, fontWeight: 600, lineHeight: 1.4, boxShadow: "0 6px 24px rgba(0,0,0,0.28)" }}
        >
          {t.msg} <span style={{ opacity: 0.7, fontWeight: 400 }}>· tap to dismiss</span>
        </div>
      ))}
    </div>
  );
}
