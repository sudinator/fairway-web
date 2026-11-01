// Saved game stats use the same values as the real hole editor. Missing/invalid
// entries are unavailable, never manufactured misses or zero putts.
export function recordedFairway(value: unknown): "hit" | "miss" | "left" | "right" | null {
  return value === "hit" || value === "miss" || value === "left" || value === "right" ? value : null;
}
export function completeFairways(values: readonly unknown[] | null | undefined, holes: readonly { par: number }[]): { hit: number; of: number } | null {
  const eligible = holes.map((hole, i) => ({ hole, i })).filter(({ hole }) => hole.par >= 4);
  if (!eligible.length) return null;
  const entries = eligible.map(({ i }) => recordedFairway(values?.[i]));
  if (entries.some(value => value === null)) return null;
  return { hit: entries.filter(value => value === "hit").length, of: eligible.length };
}
export function completePutts(values: readonly unknown[] | null | undefined, holes: number): number | null {
  if (!Number.isInteger(holes) || holes <= 0) return null;
  let total = 0;
  for (let i = 0; i < holes; i++) {
    const value = values?.[i];
    const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null;
    total += n;
  }
  return total;
}
export function scoreDescription(relative: number): string {
  return relative === -2 ? "eagle" : relative === -1 ? "birdie" : relative === 0 ? "par" : relative === 1 ? "bogey" : relative === 2 ? "double bogey" : relative === 3 ? "triple bogey" : relative < 0 ? `${-relative} under par` : `${relative} over par`;
}
