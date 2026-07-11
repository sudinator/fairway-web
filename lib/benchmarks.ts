// Golf stat benchmarks by handicap, for the dashboard "How you compare" card.
//
// SOURCES (all free / public). Figures are APPROXIMATE and blended across these:
//  - Break X Golf, per-handicap benchmark tables incl. 10th–90th percentile
//    per-round ranges (their own users' entered rounds):
//    https://breakxgolf.com/golf-stats-by-handicap/ , /10-handicap-stats/ , /15-handicap-stats/
//  - Arccos (≈750M shots) reported via Golf Monthly and The Left Rough
//  - Shot Scope via Golf Monthly
//  - Putts/round corroborated across the above and Back2Basics Golf
//
// IMPORTANT CAVEATS:
//  - These come from tracking-app users, who skew better than the true population at
//    a given handicap, and sources disagree somewhat (different samples/definitions).
//    Treat as "typical ranges," not absolutes. The UI labels them as such.
//  - "avg" = a representative mean; "lo/hi" = a typical per-round spread (≈10th–90th
//    pct). lo/hi for 10 & 15 are taken from Break X's published ranges; lo/hi for
//    0/5/20 are INTERPOLATED/estimated from the neighbouring bands and the averages.
//  - Putts/round is itself a weak stat (ignores first-putt distance — a high handicap
//    who chips close can post a low number), so don't over-read it.
//  - Scrambling (up & down %, = save par after missing GIR) added from Break X per-handicap
//    up-and-down rates (0:50.0, 5:37.7, 10:31.6, 15:25.1, 20:21.7); lo/hi from Break X ranges
//    (15: 8-42, 20: 8-40, 5: 20-60, 0: 30-70), 10 estimated. NOTE scrambling is noisy on small
//    samples (needs ~20-30 rounds to stabilise), so the UI holds it to a higher round-count guard.
//  - Penalties intentionally OMITTED: not published cleanly by handicap.
//  - Replace/augment with Birdie Num Num's OWN rounds aggregated by handicap once the
//    dataset is rich enough; this static table is the bootstrap.

export type StatKey = "fir" | "gir" | "putts" | "scramble";
export type Band = { lo: number; hi: number; avg: number };
export type HcpBand = { hcp: number; fir: Band; gir: Band; putts: Band; scramble: Band };

// +1 = higher is better (fairways, greens); -1 = lower is better (putts).
export const BENCH_DIR: Record<StatKey, 1 | -1> = { fir: 1, gir: 1, putts: -1, scramble: 1 };
export const BENCH_LABEL: Record<StatKey, string> = { fir: "Fairways", gir: "Greens in reg.", putts: "Putts / round", scramble: "Scrambling" };
export const BENCH_UNIT: Record<StatKey, string> = { fir: "%", gir: "%", putts: "", scramble: "%" };
// Track layout domains (min,max) so a value/band maps to a 0–100% position.
export const BENCH_DOMAIN: Record<StatKey, [number, number]> = { fir: [20, 75], gir: [0, 75], putts: [28, 41], scramble: [0, 70] };

export const BENCH: HcpBand[] = [
  // scratch — averages sourced (FW ~56%, GIR ~56%, putts 31.3); ranges estimated.
  { hcp: 0,  fir: { lo: 46, hi: 67, avg: 56 }, gir: { lo: 40, hi: 72, avg: 56 }, putts: { lo: 28, hi: 34, avg: 31.3 }, scramble: { lo: 30, hi: 70, avg: 50.0 } },
  // 5 — averages sourced (FW ~51%, GIR ~46%, putts 32.5); ranges estimated.
  { hcp: 5,  fir: { lo: 42, hi: 62, avg: 51 }, gir: { lo: 30, hi: 60, avg: 46 }, putts: { lo: 29, hi: 35, avg: 32.5 }, scramble: { lo: 20, hi: 60, avg: 37.7 } },
  // 10 — averages + ranges sourced (Break X): FW 49% (35–71), GIR 37% (22–54), putts 33.9 (30–37).
  { hcp: 10, fir: { lo: 35, hi: 71, avg: 49 }, gir: { lo: 22, hi: 54, avg: 37 }, putts: { lo: 30, hi: 37, avg: 33.9 }, scramble: { lo: 14, hi: 52, avg: 31.6 } },
  // 15 — averages + ranges sourced (Break X): FW 48%, GIR 26% (5–44), putts 34.8 (31–39).
  { hcp: 15, fir: { lo: 33, hi: 63, avg: 48 }, gir: { lo: 5,  hi: 44, avg: 26 }, putts: { lo: 31, hi: 39, avg: 34.8 }, scramble: { lo: 8,  hi: 42, avg: 25.1 } },
  // 20 — averages sourced (FW ~43%, GIR ~22%, putts 36.1); ranges estimated.
  { hcp: 20, fir: { lo: 30, hi: 56, avg: 43 }, gir: { lo: 8,  hi: 38, avg: 22 }, putts: { lo: 32, hi: 40, avg: 36.1 }, scramble: { lo: 8,  hi: 40, avg: 21.7 } },
];

// Interpolate a band for any handicap (clamped to the table ends), so a 13.2 index
// reads between the 10 and 15 anchors rather than snapping to one.
export function bandFor(hcpRaw: number): HcpBand {
  const pts = BENCH;
  const hcp = Math.max(pts[0].hcp, Math.min(pts[pts.length - 1].hcp, hcpRaw));
  let a = pts[0], b = pts[1];
  for (let i = 0; i < pts.length - 1; i++) {
    if (hcp >= pts[i].hcp && hcp <= pts[i + 1].hcp) { a = pts[i]; b = pts[i + 1]; break; }
  }
  const t = b.hcp === a.hcp ? 0 : (hcp - a.hcp) / (b.hcp - a.hcp);
  const lerp = (x: number, y: number) => Math.round((x + (y - x) * t) * 10) / 10;
  const band = (k: StatKey): Band => ({ lo: lerp(a[k].lo, b[k].lo), hi: lerp(a[k].hi, b[k].hi), avg: lerp(a[k].avg, b[k].avg) });
  return { hcp: hcpRaw, fir: band("fir"), gir: band("gir"), putts: band("putts"), scramble: band("scramble") };
}

// Suggested aspirational targets below the player's current index (deduped, >= 0).
export function goalOptions(index: number): number[] {
  const base = Math.round(index);
  const raw = [base - 3, base - 6, 0];
  return Array.from(new Set(raw.map((h) => Math.max(0, h)))).filter((h) => h < base).sort((x, y) => y - x);
}
