// Flights: dividing a field into handicap-index bands, each with its own winner.
// Stage 1 = one-off (per-event) flights. A band is defined by its inclusive upper index
// bound `hi` (null = open top); the lower bound is the previous band's hi. Assignment is by
// index: a player lands in the first band whose hi is null or >= their index.

export type FlightBand = { key: string; name: string; hi: number | null };

const KEYS = ["A", "B", "C", "D", "E", "F"];

// Split the field into `n` roughly-equal-size bands by handicap index (lowest = Flight A).
// Only players WITH an index shape the cut points; players without one are handled as
// "unassigned" by the caller. Returns [] if n < 1.
export function autoSplitFlights(indexes: (number | null)[], n: number): FlightBand[] {
  const count = Math.max(1, Math.min(KEYS.length, Math.floor(n)));
  const vals = indexes.filter((x): x is number => x != null).sort((a, b) => a - b);
  const bands: FlightBand[] = [];
  if (vals.length === 0) {
    // No indexes to cut on — still return named empty bands so the UI can render.
    for (let i = 0; i < count; i++) bands.push({ key: KEYS[i], name: `Flight ${KEYS[i]}`, hi: null });
    return bands;
  }
  const size = Math.ceil(vals.length / count);
  for (let i = 0; i < count; i++) {
    const chunk = vals.slice(i * size, i * size + size);
    const isLast = i === count - 1;
    // Upper bound = the highest index in this chunk (open for the last band). If a chunk is
    // empty (more bands than players), carry the previous cut so ranges stay monotonic.
    const hi = isLast || chunk.length === 0
      ? (isLast ? null : (bands[i - 1]?.hi ?? null))
      : chunk[chunk.length - 1];
    bands.push({ key: KEYS[i], name: `Flight ${KEYS[i]}`, hi });
  }
  return bands;
}

// The band key an index falls into (null if no index or no bands).
export function flightForIndex(index: number | null, bands: FlightBand[]): string | null {
  if (index == null || !bands.length) return null;
  for (const b of bands) if (b.hi == null || index <= b.hi) return b.key;
  return bands[bands.length - 1].key;
}

// Human range label for band i, e.g. "up to 8.4", "8.5–15.2", "15.3+".
export function flightRangeLabel(bands: FlightBand[], i: number): string {
  const b = bands[i];
  if (!b) return "";
  const prevHi = i > 0 ? bands[i - 1].hi : null;
  const lo = prevHi == null ? null : Math.round((prevHi + 0.1) * 10) / 10;
  if (lo == null && b.hi != null) return `up to ${b.hi.toFixed(1)}`;
  if (lo != null && b.hi == null) return `${lo.toFixed(1)}+`;
  if (lo != null && b.hi != null) return `${lo.toFixed(1)}–${b.hi.toFixed(1)}`;
  return "all handicaps";
}
