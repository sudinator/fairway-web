// Display-only recent form. Never feeds handicaps, game results or score writes.
export const RECENT_FORM_WEIGHT = 0.20;
export type TrendSample = { value: number; hit?: number; total?: number };

function valid(s: TrendSample, rate: boolean): boolean {
  return Number.isFinite(s.value) && (!rate || (
    Number.isFinite(s.hit) && Number.isFinite(s.total) && s.total! > 0 &&
    s.hit! >= 0 && s.hit! <= s.total!
  ));
}

/** Rate statistics pool recorded opportunities; other statistics average rounds. */
export function sampleAverage(samples: readonly TrendSample[], rate = false): number | null {
  const eligible = samples.filter(s => valid(s, rate));
  if (!eligible.length) return null;
  return rate
    ? 100 * eligible.reduce((s, x) => s + x.hit!, 0) / eligible.reduce((s, x) => s + x.total!, 0)
    : eligible.reduce((s, x) => s + x.value, 0) / eligible.length;
}

/**
 * Seed with the first eligible round. Later rounds contribute 20% and prior state 80%.
 * For rates, decay hits and opportunities separately: a 1/1 round must not outweigh 1/5.
 * Missing/invalid records do not advance the clock. No rounding until presentation.
 */
export function recentForm(samples: readonly TrendSample[], rate = false): (number | null)[] {
  let numerator = 0, denominator = 0, started = false;
  return samples.map(s => {
    if (!valid(s, rate)) return null;
    const n = rate ? s.hit! : s.value, d = rate ? s.total! : 1;
    numerator = started ? RECENT_FORM_WEIGHT * n + (1 - RECENT_FORM_WEIGHT) * numerator : n;
    denominator = started ? RECENT_FORM_WEIGHT * d + (1 - RECENT_FORM_WEIGHT) * denominator : d;
    started = true;
    return (rate ? 100 : 1) * numerator / denominator;
  });
}

export function trendSummary(samples: readonly TrendSample[], lowerBetter: boolean, rate = false) {
  const eligible = samples.filter(s => valid(s, rate));
  const last = eligible.slice(-5), previous = eligible.slice(-10, -5);
  const average = sampleAverage(eligible, rate);
  const latest = sampleAverage(last, rate);
  const prior = eligible.length >= 10 ? sampleAverage(previous, rate) : null;
  const improvement = latest == null || prior == null ? null : (lowerBetter ? prior - latest : latest - prior);
  const betterCount = average == null ? 0 : last.filter(s => lowerBetter ? s.value <= average : s.value >= average).length;
  return { average, latest, prior, improvement, lastCount: last.length, count: eligible.length, betterCount,
    hits: rate ? last.reduce((sum, s) => sum + s.hit!, 0) : null,
    opportunities: rate ? last.reduce((sum, s) => sum + s.total!, 0) : null };
}
