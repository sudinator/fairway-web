"use client";
// The game's own scramble allowance (211.9; 212.0: every team size at once — a game's teams may differ in size).
// One row per team size (2, 3, 4), one box per position, lowest course handicap first, the USGA's percentage beside
// each as guidance, and "Reset to USGA". Fields use the app's one field style (DISPLAY_RULES.md §2).
import React from "react";
import { C } from "@/lib/golf";
import { btn, inputStyle } from "@/components/ui";
import { SCRAMBLE_ALLOWANCES } from "@/lib/scramble";

export type ScrambleAllowance = Record<string, number[]>;
const SIZES = [2, 3, 4] as const;

export function ScrambleAllowanceEditor({ value, onChange, disabled }: {
  value: ScrambleAllowance | null | undefined; onChange: (next: ScrambleAllowance | null) => void; disabled?: boolean;
}) {
  const usgaOf = (n: 2 | 3 | 4) => SCRAMBLE_ALLOWANCES[n].map((x) => Math.round(x * 100));
  const currentOf = (n: 2 | 3 | 4) => { const c = value?.[String(n)]; return Array.isArray(c) && c.length === n ? c : usgaOf(n); };
  const anyCustom = SIZES.some((n) => currentOf(n).some((v, i) => v !== usgaOf(n)[i]));
  const set = (n: 2 | 3 | 4, i: number, raw: string) => {
    const v = Math.round(Number(raw));
    if (!Number.isFinite(v) || v < 0 || v > 100) return;
    const next = currentOf(n).map((x, k) => (k === i ? v : x));
    const rest = { ...(value || {}) };
    if (next.every((x, k) => x === usgaOf(n)[k])) delete rest[String(n)]; else rest[String(n)] = next;
    onChange(Object.keys(rest).length ? rest : null);
  };
  return (
    <div data-scramble-allowance style={{ marginTop: 8 }}>
      {SIZES.map((n) => (
        <div key={n} style={{ marginTop: 8 }}>
          <div style={{ color: C.cream, fontSize: 12, fontWeight: 700 }}>Team of {n}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            {currentOf(n).map((v, i) => {
              const pos = i === 0 ? "Lowest" : i === n - 1 ? "Highest" : i === 1 ? "2nd" : "3rd";
              return (
                <label key={`${n}-${i}-${v}`} style={{ flex: 1, color: C.sage, fontSize: 11 }}>
                  {pos}
                  <input aria-label={`Team of ${n}: ${pos} course handicap percent`} inputMode="numeric" defaultValue={v} disabled={disabled}
                    onBlur={(e) => { if (Number(e.currentTarget.value) !== v) set(n, i, e.currentTarget.value); }}
                    style={{ ...inputStyle, marginTop: 4 }} />
                  <span style={{ display: "block", marginTop: 2 }}>USGA {usgaOf(n)[i]}%</span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
      {anyCustom ? <button disabled={disabled} onClick={() => onChange(null)} style={{ ...btn(false), marginTop: 10, fontSize: 12 }}>Reset to USGA</button> : null}
      <div style={{ color: C.sage, fontSize: 11, marginTop: 6 }}>Percent of each player&apos;s course handicap, lowest to highest, for each team size.</div>
    </div>
  );
}
