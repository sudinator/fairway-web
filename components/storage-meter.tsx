"use client";
// 212.28 — Admin → Diagnostics: how much BNN has stored on THIS phone (the browser's per-site storage, about 5 MB),
// by kind, and "Tidy now". The 212.26 bug was this area filling silently; this makes it visible.
import React, { useEffect, useState } from "react";
import { C } from "@/lib/golf";
import { btn } from "@/components/ui";
import { tidyScoringStorage } from "@/lib/scoring-device";

const LIMIT = 5 * 1024 * 1024;   // the smallest common per-site allowance (iPhone Safari / home-screen apps)
const KINDS: [string, RegExp][] = [
  ["Score backups", /bnn_game_scores_|bnn_game_wm_|bnn_round_draft|bnn_round_sync|bnn_draft_hole|bnn:altshot-side-drafts/],
  ["Game copies for offline use", /bnn_game_snap_/],
  ["Recovery archive", /bnn_scoring_recovery_v1/],
  ["Diagnostics log", /bnn_rsdiag_log/],
];
export type StorageReport = { bytes: number; items: number; kinds: { label: string; bytes: number }[] };
export function measureStorage(ls: Storage = window.localStorage): StorageReport {
  const totals = new Map<string, number>();
  let bytes = 0, items = 0;
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i); if (!k) continue;
    const size = (k.length + (ls.getItem(k) || "").length) * 2;   // the browser stores text as two bytes a character
    bytes += size; items++;
    const kind = KINDS.find(([, re]) => re.test(k))?.[0] ?? "Settings & other";
    totals.set(kind, (totals.get(kind) || 0) + size);
  }
  return { bytes, items, kinds: [...totals.entries()].map(([label, b]) => ({ label, bytes: b })).sort((a, b) => b.bytes - a.bytes) };
}
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function StorageMeter({ sample }: { sample?: StorageReport } = {}) {
  const [r, setR] = useState<StorageReport | null>(sample ?? null);   // sample: the design gallery
  const [msg, setMsg] = useState("");
  const refresh = () => { try { setR(measureStorage()); } catch { setR(null); } };
  useEffect(() => { if (!sample) refresh(); }, [sample]);
  if (!r) return null;
  const pct = Math.round((r.bytes / LIMIT) * 100);
  return (
    <div data-storage-meter style={{ marginTop: 18, border: `1px solid ${C.borderGreen}`, borderRadius: 12, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 16, fontWeight: 700, flex: 1 }}>Phone storage</div>
        <button onClick={() => { const n = tidyScoringStorage(); refresh(); setMsg(n ? `Tidied ${n} item${n === 1 ? "" : "s"}.` : "Nothing to tidy."); }} style={{ ...btn(false), fontSize: 12 }}>Tidy now</button>
      </div>
      <div style={{ color: C.cream, fontSize: 14, marginTop: 6 }}><b>{kb(r.bytes)}</b> of about 5 MB · {pct}% · {r.items} items</div>
      <div style={{ height: 8, background: C.green, borderRadius: 999, marginTop: 6, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.min(100, pct)}%`, background: pct >= 80 ? C.overRedDark : pct >= 50 ? C.gold : "#5BD08A", borderRadius: 999 }} />
      </div>
      {r.kinds.map((k) => (
        <div key={k.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 4 }}>
          <span style={{ color: C.sage }}>{k.label}</span><span style={{ color: C.cream }}>{kb(k.bytes)}</span>
        </div>
      ))}
      <div style={{ color: C.sage, fontSize: 11.5, marginTop: 6, lineHeight: 1.45 }}>What BNN keeps on this phone for offline scoring. It tidies itself automatically; unsent scores are never removed.{msg ? ` ${msg}` : ""}</div>
    </div>
  );
}
