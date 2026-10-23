// 212.18 — INSIGHTS (owner, Oct 2026; designed in 210.x, placed on Oct 22): a member's scoring against par by hole
// type, difficulty and stretch of the round, plus consistency, with plain-English findings ranked by the shots they're
// worth. From the member's LAST 20 VALID rounds (lib/round-rules: 9+ holes scored), nothing until 5 such rounds, and no
// finding drawn from too few holes. Pure: no data access. Shown as a dashboard card (the two strongest findings) and a
// full Insights screen.
import type { Round } from "./golf";
import { holeScore, isValidRound, isFullCard, handicapReading } from "./round-rules";
import { chBasisOrNull } from "./game-shape";
import { allocateStrokes } from "./golf";

export const INSIGHT_WINDOW = 20;
export const INSIGHT_MIN_ROUNDS = 5;
const MIN_HOLES = 20;   // a category needs at least this many scored holes before it can produce a finding

export type Bucket = { key: string; label: string; holes: number; avgToPar: number | null; perRound: number;
  /** 212.18: against what the member's own game predicts for these holes (see EXPECTED below), per hole; complete
   *  18-hole rounds with stroke indexes */
  netHoles: number; netAvg: number | null };
export type Finding = { key: string; title: string; detail: string; text: string; shots: number; tone: "leak" | "strength" | "info" };
export type Insights = {
  roundsUsed: number;
  ready: boolean;                      // at least INSIGHT_MIN_ROUNDS valid rounds
  overall: number | null;              // average to par per hole
  overallNet: number | null;           // average against expectation per hole (≈ 0 by construction)
  byPar: Bucket[]; byDifficulty: Bucket[]; byStretch: Bucket[];
  withinHandicap: { rounds: number; within: number } | null;
  blowUpCost: number | null;           // shots a round lost beyond bogey on double-bogey-or-worse holes (per 18)
  threePutts: number | null;           // three-putts a round (per 18), where putts were recorded
  findings: Finding[];
};

/** A round that counts: final, with hole-by-hole scores, 9+ holes scored. */
export function isInsightRound(r: Round): boolean {
  if (r.status && r.status !== "final") return false;
  const holes = Array.isArray(r.holes) ? r.holes : [];
  return holes.length > 0 && isValidRound(holes.map((h) => h.strokes), holes.length);
}

const sign = (n: number) => (n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1));

export function computeInsights(rounds: Round[]): Insights {
  const used = rounds.filter(isInsightRound).sort((a, b) => String(b.played_at).localeCompare(String(a.played_at))).slice(0, INSIGHT_WINDOW);
  const acc = new Map<string, { sum: number; n: number }>();
  const add = (k: string, v: number) => { const a = acc.get(k) || { sum: 0, n: 0 }; a.sum += v; a.n++; acc.set(k, a); };
  // EXPECTED: everyone drops more shots on the hardest holes — that's what stroke index means — so a raw comparison always
  // "finds" the hardest holes. Instead each hole is compared with what the member's OWN game predicts for it: the round's
  // score over par, spread across the holes the way handicap strokes are (by stroke index, using the course handicap's
  // shape). Each round's expectations add up to its actual score, so a player who pars everything expects par
  // everywhere (no leak invented), and a +12 round expects about 0.9 over on the hardest holes.
  // (the strokes come from the ONE allocation — lib/golf allocateStrokes, by stroke-index rank)
  let within = 0, withinRounds = 0, blowSum = 0, blowRounds = 0, tpSum = 0, tpRounds = 0;
  for (const r of used) {
    const holes = r.holes;
    const full = holes.length === 18 && isFullCard(holes.map((h) => h.strokes), 18) && holes.every((h) => h.stroke_index != null && h.par);
    // the ONE course-handicap rule (lib/game-shape chBasisOrNull): a manual course handicap (0153) is used as entered;
    // no handicap at all is "none", never scratch
    const chRound = full ? handicapReading(chBasisOrNull(r, r.course_par, 18)) : null;
    const chInt = chRound == null ? null : Math.round(chRound);
    let expOf: ((holeNumber: number) => number) | null = null;
    if (chInt != null) {
      const over = holes.reduce((n, h) => n + ((holeScore(h.strokes) || 0) - h.par), 0);
      const alloc = chInt > 0 ? allocateStrokes(holes.map((h) => ({ hole_number: h.hole_number, stroke_index: h.stroke_index })) as never, chInt) as Record<number, number> : null;
      const w = (hn: number) => (alloc ? alloc[hn] || 0 : 1);   // a scratch or plus player: spread evenly
      const totalW = holes.reduce((n, h) => n + w(h.hole_number), 0);
      expOf = (hn: number) => (totalW ? (over * w(hn)) / totalW : 0);
    }
    let scored = 0, blow = 0, putted = 0, tp = 0;
    holes.forEach((h, i) => {
      const s = holeScore(h.strokes);
      if (s == null || !h.par) return;
      scored++;
      const d = s - h.par;
      add("all", d);
      if (h.par === 3 || h.par === 4 || h.par === 5) add(`par${h.par}`, d);
      const si = h.stroke_index;
      const stretch = i < 3 ? "first" : i >= holes.length - 3 ? "last" : "middle";
      if (si != null && si >= 1 && si <= 18) add(si <= 6 ? "hard" : si <= 12 ? "mid" : "easy", d);
      add(stretch, d);
      if (expOf && si != null && si >= 1 && si <= 18) {
        const nd = d - expOf(h.hole_number);
        add("n:all", nd);
        if (h.par === 3 || h.par === 4 || h.par === 5) add(`n:par${h.par}`, nd);
        add(`n:${si <= 6 ? "hard" : si <= 12 ? "mid" : "easy"}`, nd);
        add(`n:${stretch}`, nd);
      }
      if (d >= 2) blow += d - 1;
      if (h.putts != null && h.putts >= 0) { putted++; if (h.putts >= 3) tp++; }
    });
    if (scored) { blowSum += blow * (18 / scored); blowRounds++; }
    if (putted >= 9) { tpSum += tp * (18 / putted); tpRounds++; }
    const ch = handicapReading(chBasisOrNull(r, r.course_par, holes.length));
    if (isFullCard(holes.map((h) => h.strokes), holes.length) && holes.length === 18 && ch != null) {
      const par = holes.reduce((n, h) => n + (h.par || 0), 0);
      const gross = holes.reduce((n, h) => n + (holeScore(h.strokes) || 0), 0);
      withinRounds++;
      if (gross - ch - par <= 3) within++;
    }
  }
  const avg = (k: string) => { const a = acc.get(k); return a && a.n ? a.sum / a.n : null; };
  const overall = avg("all"), overallNet = avg("n:all");
  const bucket = (key: string, label: string): Bucket => {
    const a = acc.get(key);
    return { key, label, holes: a?.n || 0, avgToPar: avg(key), perRound: used.length ? (a?.n || 0) / used.length : 0, netHoles: acc.get(`n:${key}`)?.n || 0, netAvg: avg(`n:${key}`) };
  };
  const byPar = [bucket("par3", "par 3s"), bucket("par4", "par 4s"), bucket("par5", "par 5s")];
  const byDifficulty = [bucket("hard", "the six hardest holes"), bucket("mid", "the middle six"), bucket("easy", "the six easiest holes")];
  const byStretch = [bucket("first", "the first three holes"), bucket("middle", "the middle holes"), bucket("last", "the last three holes")];
  const ready = used.length >= INSIGHT_MIN_ROUNDS;
  const blowUpCost = blowRounds >= INSIGHT_MIN_ROUNDS ? blowSum / blowRounds : null;
  const threePutts = tpRounds >= INSIGHT_MIN_ROUNDS ? tpSum / tpRounds : null;
  const withinHandicap = withinRounds >= INSIGHT_MIN_ROUNDS ? { rounds: withinRounds, within } : null;

  const findings: Finding[] = [];
  const F = (key: string, tone: Finding["tone"], shots: number, title: string, detail: string) => findings.push({ key, tone, shots, title, detail, text: `${title}: ${detail}` });
  const cap = (t: string) => t[0].toUpperCase() + t.slice(1);
  if (ready && overallNet != null) {
    // shots a round versus the member's average NET hole, for categories with enough holes
    const cats = [...byPar, ...byDifficulty].filter((b) => b.netHoles >= MIN_HOLES && b.netAvg != null)
      .map((b) => ({ b, perHole: b.netAvg! - overallNet, shots: (b.netAvg! - overallNet) * (b.netHoles / used.length) }));
    const worst = cats.reduce<(typeof cats)[number] | null>((m, c) => (!m || c.shots > m.shots ? c : m), null);
    const best = cats.reduce<(typeof cats)[number] | null>((m, c) => (!m || c.shots < m.shots ? c : m), null);
    if (worst && worst.shots >= 0.3) F("leak", "leak", worst.shots, `${cap(worst.b.label)} cost you most`,
      `${worst.perHole.toFixed(1)} a hole more than your game predicts · about ${worst.shots.toFixed(1)} shots a round`);
    if (best && best !== worst && best.shots <= -0.3) F("strength", "strength", -best.shots, `${cap(best.b.label)} are your strength`,
      `${(-best.perHole).toFixed(1)} a hole better than your game predicts · about ${(-best.shots).toFixed(1)} shots a round`);
  }
  if (ready && overall != null) {
    const last = byStretch[2], first = byStretch[0];
    if (last.holes >= MIN_HOLES && last.avgToPar != null) {
      const d = last.avgToPar - overall;
      if (d <= -0.15) F("finish", "strength", -d * 3, "Strong finisher", `your last three holes average ${(-d).toFixed(1)} a hole better than the rest of your round`);
      else if (d >= 0.15) F("finish", "leak", d * 3, "Fading late", `your last three holes average ${d.toFixed(1)} a hole worse than the rest of your round`);
    }
    if (first.holes >= MIN_HOLES && first.avgToPar != null && first.avgToPar - overall >= 0.15)
      F("start", "leak", (first.avgToPar - overall) * 3, "Slow starter", `your first three holes average ${(first.avgToPar - overall).toFixed(1)} a hole worse than the rest of your round`);
    if (blowUpCost != null && blowUpCost >= 1) F("blowups", "leak", blowUpCost, "Blow-up holes", `double bogey or worse costs you ${blowUpCost.toFixed(1)} shots a round beyond bogey`);
    if (threePutts != null && threePutts >= 1) F("putts", "info", threePutts * 0.9, "Three-putts", `${threePutts.toFixed(1)} a round`);
    if (withinHandicap) F("within", "info", 0, "Playing to your handicap", withinHandicap.within === withinHandicap.rounds ? `within 3 of it in all of your last ${withinHandicap.rounds} full rounds` : `within 3 of it in ${withinHandicap.within} of your last ${withinHandicap.rounds} full rounds`);
  }
  // problems first, then strengths, then the general figures — each by the shots it's worth
  const rank = { leak: 0, strength: 1, info: 2 } as const;
  findings.sort((a, b) => rank[a.tone] - rank[b.tone] || b.shots - a.shots);
  return { roundsUsed: used.length, ready, overall, overallNet, byPar, byDifficulty, byStretch, withinHandicap, blowUpCost, threePutts, findings };
}
