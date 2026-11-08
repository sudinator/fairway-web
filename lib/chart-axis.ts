// Display-only axis policy. Points keep ordinal round spacing; no aggregation or sorting.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function civilDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(value);
  if (!m) return null;
  const date = new Date(`${m[1]}T00:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === m[1] ? m[1] : null;
}

export function formatChartDate(value: unknown): string {
  const date = civilDate(value);
  return date ? `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}, ${date.slice(0, 4)}` : "Date unavailable";
}

/** Recharts measures the available width and hides colliding ticks, including endpoints. */
export function chartXAxis<T extends object>(data: readonly T[], valueKey: keyof T = "i" as keyof T, dateKey: keyof T = "playedAt" as keyof T) {
  const dates = data.map(point => civilDate(point[dateKey]));
  const monthMode = data.length > 10 && dates.every(Boolean) && new Set(dates.map(d => d!.slice(0, 7))).size > 1;
  const keys = data.map(point => point[valueKey] as string | number);
  const selected = monthMode ? keys.filter((_, i) => i === 0 || dates[i]!.slice(0, 7) !== dates[i - 1]!.slice(0, 7)) : keys;
  return {
    ticks: [...new Set(selected)],
    interval: "preserveStartEnd" as const,
    minTickGap: 14,
    tickSize: 0,
    tickMargin: 18,
    height: 38,
    tickFormatter: (value: unknown): string => {
      const i = keys.indexOf(value as string | number);
      const date = dates[i];
      if (monthMode && date) return `${MONTHS[Number(date.slice(5, 7)) - 1]} ’${date.slice(2, 4)}`;
      if (valueKey === "week" && date) return `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;
      return value == null ? "" : String(value);
    },
  };
}

// Conservative width budget for 11px bold numeric labels (8px per glyph plus
// 8px clearance). The actual available width comes from ResponsiveContainer.
export function showCountLabels(values: readonly number[], width: number): boolean {
  if (!values.length || !Number.isFinite(width) || width <= 0 || !values.every(Number.isFinite)) return false;
  const glyphs = Math.max(...values.map(v => String(v).length));
  const plotBudget = Math.max(0, width - (glyphs + 1) * 8 - 12);
  return plotBudget / values.length >= glyphs * 8 + 8;
}
