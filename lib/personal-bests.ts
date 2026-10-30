/**
 * Personal bests (owner, Oct 23: a dashboard card + a "new personal best" celebration first; Oct 30: variant C — the latest
 * new best as a hero, the rest as rows). Computed from a member's FINISHED rounds, exactly as the dashboard loads them
 * (test clubs never post rounds, so they never count). Eighteen-hole rounds set the round bests; nine-hole rounds set
 * only "best nine". A best is NEW when its round is within the last 30 days.
 */
import type { Round } from "@/lib/golf";
import { played, isGrossOnly, strokesOf, ptsOf, roundHoleCount } from "@/lib/golf";

export type BestKey = "gross" | "net" | "points" | "birdies" | "nine" | "putts" | "streak";
export type Best = {
  key: BestKey; label: string; value: number; display: string; lowerIsBetter: boolean;
  roundId: string; course: string; tee: string | null; playedAt: string; when: string; detail: string;
  /** The best this one beat (the previous best), when there was one. */
  prev: { value: number; display: string } | null;
  isNew: boolean;
};
export type PersonalBests = { rounds: number; bests: Best[]; newest: Best | null };

const LABEL: Record<BestKey, string> = { gross: "Lowest gross", net: "Lowest net", points: "Best Stableford", birdies: "Most birdies", nine: "Best nine", putts: "Fewest putts", streak: "Longest par streak" };
const full18 = (r: Round) => (r.status ?? "final") !== "in_progress" && !(r as { deleted_at?: string | null }).deleted_at && (isGrossOnly(r) ? roundHoleCount(r) === 18 : played(r).length === 18);
const full9 = (r: Round) => (r.status ?? "final") !== "in_progress" && !(r as { deleted_at?: string | null }).deleted_at && played(r).length === 9;
const sorted = (r: Round) => [...played(r)].sort((a, b) => a.hole_number - b.hole_number);
const gross = (r: Round) => strokesOf(r);
const net = (r: Round) => (r.course_handicap != null ? strokesOf(r) - r.course_handicap : null);
const birdies = (r: Round) => played(r).filter((h) => h.strokes != null && h.strokes <= h.par - 1).length;
const putts = (r: Round) => { const hs = played(r); return hs.length === 18 && hs.every((h) => h.putts != null) ? hs.reduce((s, h) => s + (h.putts || 0), 0) : null; };
const streak = (r: Round) => { let best = 0, run = 0; for (const h of sorted(r)) { run = h.strokes != null && h.strokes <= h.par ? run + 1 : 0; best = Math.max(best, run); } return best; };
const nines = (r: Round): { value: number; which: string }[] => {
  const hs = sorted(r);
  if (hs.length === 18) return [{ value: hs.slice(0, 9).reduce((s, h) => s + (h.strokes || 0), 0), which: "Front nine" }, { value: hs.slice(9).reduce((s, h) => s + (h.strokes || 0), 0), which: "Back nine" }];
  if (hs.length === 9) return [{ value: hs.reduce((s, h) => s + (h.strokes || 0), 0), which: hs[0].hole_number > 9 ? "Back nine" : "Front nine" }];
  return [];
};

type Cand = { r: Round; value: number; detail?: string };
function pick(cands: Cand[], lowerIsBetter: boolean, min = 1): { best: Cand; prev: Cand | null } | null {
  const ok = cands.filter((c) => Number.isFinite(c.value) && c.value >= min);
  if (!ok.length) return null;
  const order = [...ok].sort((a, b) => (lowerIsBetter ? a.value - b.value : b.value - a.value) || (+new Date(b.r.played_at) - +new Date(a.r.played_at)));
  const best = order[0];
  // the previous best: the best among rounds BEFORE the best's round
  const before = order.filter((c) => +new Date(c.r.played_at) < +new Date(best.r.played_at));
  return { best, prev: before[0] ?? null };
}
const whenOf = (r: Round) => { const d = new Date(`${String(r.played_at).slice(0, 10)}T12:00:00`); return isNaN(+d) ? String(r.played_at).slice(0, 10) : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };   // "Oct 25"
const isNew = (r: Round, now: Date) => +now - +new Date(r.played_at) <= 30 * 86400000;

export function personalBests(rounds: Round[], now = new Date()): PersonalBests {
  const r18 = rounds.filter(full18), rAll = rounds.filter((r) => full18(r) || full9(r));
  const out: Best[] = [];
  const add = (key: BestKey, lowerIsBetter: boolean, picked: { best: Cand; prev: Cand | null } | null, fmt: (v: number) => string, detail?: (c: Cand) => string) => {
    if (!picked) return;
    const { best, prev } = picked;
    out.push({ key, label: LABEL[key], value: best.value, display: fmt(best.value), lowerIsBetter, roundId: best.r.id, course: best.r.course, tee: best.r.tee_name ?? null, playedAt: best.r.played_at, when: whenOf(best.r),
      detail: detail ? detail(best) : [best.r.course, best.r.tee_name].filter(Boolean).join(" · "), prev: prev ? { value: prev.value, display: fmt(prev.value) } : null, isNew: isNew(best.r, now) });
  };
  add("gross", true, pick(r18.map((r) => ({ r, value: gross(r) })), true), (v) => String(v));
  add("net", true, pick(r18.filter((r) => net(r) != null).map((r) => ({ r, value: net(r) as number })), true), (v) => String(v));
  add("points", false, pick(r18.filter((r) => !isGrossOnly(r)).map((r) => ({ r, value: ptsOf(r) })), false), (v) => `${v} pts`);
  add("birdies", false, pick(r18.filter((r) => !isGrossOnly(r)).map((r) => ({ r, value: birdies(r) })), false, 1), (v) => String(v));
  add("nine", true, pick(rAll.flatMap((r) => nines(r).map((n) => ({ r, value: n.value, detail: `${n.which} · ${r.course}` }))), true), (v) => String(v), (c) => c.detail ?? "");
  add("putts", true, pick(r18.filter((r) => putts(r) != null).map((r) => ({ r, value: putts(r) as number })), true), (v) => String(v));
  add("streak", false, pick(r18.filter((r) => !isGrossOnly(r)).map((r) => ({ r, value: streak(r) })), false, 3), (v) => `${v} holes`, (c) => `${c.r.course}`);
  const news = out.filter((b) => b.isNew).sort((a, b) => +new Date(b.playedAt) - +new Date(a.playedAt));
  return { rounds: r18.length, bests: out, newest: news[0] ?? null };
}

/** The bests a given round set — for the recap's "new personal best" line and the round email. */
export function newBestsOf(rounds: Round[], roundId: string): Best[] {
  return personalBests(rounds, new Date(8640000000000000)).bests.filter((b) => b.roundId === roundId);
}

/** "beat your 81 by two" / "first one" */
export function beatLine(b: Best): string {
  if (!b.prev) return "your first";
  const d = Math.abs(b.value - b.prev.value), word = b.key === "points" ? "point" : b.key === "birdies" ? "birdie" : b.key === "streak" ? "hole" : b.key === "putts" ? "putt" : "shot";
  return `beat your ${b.prev.display} by ${d === 1 ? "one" : d === 2 ? "two" : d === 3 ? "three" : d} ${d === 1 ? word : word + "s"}`;
}
