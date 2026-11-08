// Historical 212.94 chart calculations, unchanged, for differential testing.
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

