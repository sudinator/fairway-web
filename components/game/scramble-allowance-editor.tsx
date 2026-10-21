"use client";
// The game's own scramble allowance (211.9): one box per position, lowest course handicap first, with the USGA's
// percentage beside each as guidance and "Reset to USGA". Used when creating a scramble and in Setup → Format.
import React from "react";
import { C } from "@/lib/golf";
import { btn } from "@/components/ui";
import { SCRAMBLE_ALLOWANCES } from "@/lib/scramble";

export type ScrambleAllowance = Record<string, number[]>;

export function ScrambleAllowanceEditor({ size, value, onChange, disabled }: {
  size: 2 | 3 | 4; value: ScrambleAllowance | null | undefined; onChange: (next: ScrambleAllowance | null) => void; disabled?: boolean;
}) {
  const usga = SCRAMBLE_ALLOWANCES[size].map((x) => Math.round(x * 100));
  const custom = value?.[String(size)];
  const current = Array.isArray(custom) && custom.length === size ? custom : usga;
  const isCustom = current.some((v, i) => v !== usga[i]);
  const ordinal = (i: number) => (i === 0 ? "Lowest" : i === size - 1 ? "Highest" : i === 1 ? "2nd" : "3rd");
  const set = (i: number, raw: string) => {
    const v = Math.round(Number(raw));
    if (!Number.isFinite(v) || v < 0 || v > 100) return;
    const next = current.map((x, k) => (k === i ? v : x));
    const rest = { ...(value || {}) };
    if (next.every((x, k) => x === usga[k])) delete rest[String(size)]; else rest[String(size)] = next;
    onChange(Object.keys(rest).length ? rest : null);
  };
  return (
    <div data-scramble-allowance style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {current.map((v, i) => (
          <label key={`${size}-${i}-${v}`} style={{ flex: 1, color: C.sage, fontSize: 11 }}>
            {ordinal(i)}
            <input aria-label={`${ordinal(i)} course handicap percent`} inputMode="numeric" defaultValue={v} disabled={disabled}
              onBlur={(e) => { if (Number(e.currentTarget.value) !== v) set(i, e.currentTarget.value); }}
              style={{ width: "100%", boxSizing: "border-box", marginTop: 4, background: C.greenMid, color: C.cream, border: "none", borderRadius: 8, padding: "8px 12px", fontSize: 13 }} />
            <span style={{ display: "block", marginTop: 2 }}>USGA {usga[i]}%</span>
          </label>
        ))}
      </div>
      {isCustom ? (
        <button disabled={disabled} onClick={() => { const rest = { ...(value || {}) }; delete rest[String(size)]; onChange(Object.keys(rest).length ? rest : null); }}
          style={{ ...btn(false), marginTop: 8, fontSize: 12 }}>Reset to USGA</button>
      ) : null}
      <div style={{ color: C.sage, fontSize: 11, marginTop: 6 }}>Percent of each player&apos;s course handicap, lowest to highest. If numbers don&apos;t divide evenly, smaller teams use the USGA percentages for their size.</div>
    </div>
  );
}
