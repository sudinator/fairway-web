// 212.18 — messy PERSONAL rounds (the standing rule: every statistics feature runs through messy data). Each is a shape
// production has: an unfinished round, a scoreless historical round, an 8-hole card, a 9-hole round, missing stroke
// indexes, missing putts, picked-up holes, scores stored as text.
import type { Round } from "../golf";

const PAR = [4, 5, 3, 4, 4, 3, 4, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4], SI = [7, 3, 17, 1, 11, 15, 5, 9, 13, 8, 2, 18, 4, 12, 6, 16, 10, 14];
export function round(id: string, date: string, strokes: (number | string | null)[], extra: Partial<Round> = {}, holeExtra: (i: number) => Record<string, unknown> = () => ({})): Round {
  return { id, course: "Oak Hollow", tee_name: "White", rating: 71.2, slope: 128, course_par: 72, handicap_index: 12, course_handicap: 14, played_at: date, status: "final",
    holes: strokes.map((s, i) => ({ hole_number: i + 1, par: PAR[i], stroke_index: SI[i], strokes: s as number | null, putts: 2, fairway: null, penalties: 0, ...holeExtra(i) })), ...extra } as Round;
}
export const PARS = PAR, SIS = SI;
export function messyRounds(): { round: Round; counts: boolean; note: string }[] {
  const par18 = PAR.map((p) => p + 1);
  return [
    { round: round("draft", "2026-10-20", par18, { status: "draft" }), counts: false, note: "an unfinished (draft) round" },
    { round: round("hist", "2026-10-19", [], { gross_score: 88 }), counts: false, note: "a historical round with only a gross score" },
    { round: round("eight", "2026-10-18", [...par18.slice(0, 8), ...Array(10).fill(null)]), counts: false, note: "an 8-hole card" },
    { round: round("nine", "2026-10-17", par18.slice(0, 9)), counts: true, note: "a 9-hole round" },
    { round: round("nosi", "2026-10-16", par18, {}, () => ({ stroke_index: null })), counts: true, note: "no stroke indexes" },
    { round: round("noputt", "2026-10-15", par18, {}, () => ({ putts: null })), counts: true, note: "no putts recorded" },
    { round: round("pickup", "2026-10-14", par18.map((s, i) => (i === 5 ? null : s))), counts: true, note: "a picked-up hole" },
    { round: round("text", "2026-10-13", par18.map(String)), counts: true, note: "scores stored as text" },
  ];
}
