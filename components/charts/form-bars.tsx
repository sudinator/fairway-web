"use client";
// The Dashboard's "form" chart, as ONE shared component (205.0, extracted from components/dashboard
// Scoring Form): per-round bars, green when at or better than the average and red when worse, a
// cream 5-round rolling line, the average as a dashed reference. Used by the Dashboard and by the
// Season Wrapped story so a change to the chart changes both. `width` renders at a fixed size (the
// story and the render harness); without it the chart fills its container as on the Dashboard.
import React from "react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Bar, Rectangle, Line, ComposedChart } from "recharts";
import { C } from "@/lib/golf";
import { barShapeValue } from "@/lib/chart-helpers";

export type FormPoint = { i: number; name?: string; course?: string; value: number; roll: number | null };

export function niceDomain(vals: number[], pad: number): [number, number] {
  if (vals.length === 0) return [0, 1];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) { lo -= pad; hi += pad; }
  else { const p = Math.max(pad, Math.round((hi - lo) * 0.15)); lo -= p; hi += p; }
  return [Math.floor(lo), Math.ceil(hi)];
}

/** Rolling n-point average, as the Dashboard computes it. */
export function withRolling(values: { value: number; name?: string; course?: string }[], n = 5): FormPoint[] {
  return values.map((x, i) => {
    const w = values.slice(Math.max(0, i - (n - 1)), i + 1);
    return { i: i + 1, name: x.name, course: x.course, value: x.value, roll: w.length >= Math.min(n, 3) ? Math.round((w.reduce((s, t) => s + t.value, 0) / w.length) * 10) / 10 : null };
  });
}

export function FormBars({ data, avg, domain, lowerBetter = true, tooltip, width, height = 200, nameMap, ticks, tickFormatter }: {
  data: FormPoint[]; avg: number | null; domain?: [number, number]; lowerBetter?: boolean;
  tooltip?: React.ReactElement; width?: number; height?: number; nameMap?: Record<string, string>;
  /** Optional x-axis labelling (205.1): which round numbers carry a tick, and what each says. Without
   *  them every round is numbered, as on the Dashboard. */
  ticks?: number[]; tickFormatter?: (i: number) => string;
}) {
  const dom = domain ?? niceDomain(data.map((d) => d.value), 2);
  const chart = (
    <ComposedChart data={data} width={width} height={width ? height : undefined} margin={{ top: 5, right: 6, left: -8, bottom: 0 }}>
      <XAxis dataKey="i" tick={{ fill: C.sage, fontSize: 11 }} axisLine={{ stroke: C.greenMid }} tickLine={false} ticks={ticks} tickFormatter={tickFormatter} {...(ticks ? { interval: 0 as const, minTickGap: 0 } : {})} />
      <YAxis domain={dom} allowDecimals={false} tick={{ fill: C.cream, fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
      {tooltip ? <Tooltip wrapperStyle={{ pointerEvents: "auto" }} cursor={{ fill: "rgba(255,255,255,0.06)" }} content={tooltip} /> : null}
      {avg != null && <ReferenceLine y={Math.round(avg * 10) / 10} stroke={C.sage} strokeDasharray="3 4" />}
      <Bar dataKey="value" name={nameMap?.value} radius={[3, 3, 0, 0]} maxBarSize={26} isAnimationActive={!width} shape={(props: any) => {
        const v = barShapeValue(props, "value");
        const good = avg != null && v != null && (lowerBetter ? v <= avg : v >= avg);
        return <Rectangle x={props.x} y={props.y} width={props.width} height={props.height} radius={[3, 3, 0, 0]} fill={good ? "#4ADE80" : "#FB7185"} />;
      }} />
      <Line type="monotone" dataKey="roll" name={nameMap?.roll} stroke={C.cream} strokeWidth={2.5} dot={{ fill: C.cream, r: 3 }} isAnimationActive={!width} />
    </ComposedChart>
  );
  return width ? chart : <ResponsiveContainer>{chart}</ResponsiveContainer>;
}
