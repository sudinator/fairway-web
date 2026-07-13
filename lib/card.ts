// Pure card-stats: the running index, its recent trend, and the rolling-form
// series. Shared so the self-card (computed from own rounds) and the stored
// peer summary (player_cards, read via group_cards) always agree.
import { Round, roundDifferential, runningHandicap } from "./golf";

const chrono = (a: Round, b: Round) => (a.played_at || "").localeCompare(b.played_at || "") || (a.id || "").localeCompare(b.id || "");

// last-5 rolling average of handicap differentials, chronological order
export function rollingForm(rounds: Round[]): number[] {
  const diffs = rounds.slice().sort(chrono).map(roundDifferential).filter((x): x is number => x != null);
  const out: number[] = [];
  for (let i = 0; i < diffs.length; i++) {
    const w = diffs.slice(Math.max(0, i - 4), i + 1);
    out.push(Math.round((w.reduce((a, b) => a + b, 0) / w.length) * 10) / 10);
  }
  return out;
}

export type CardStats = { idx: number | null; idx_trend: number | null; form: number[]; rounds: number };

export function computeCardStats(rounds: Round[]): CardStats {
  const idx = runningHandicap(rounds).index;
  // trend = index now vs index before the most recent 5 rounds (negative = improving)
  const prior = rounds.length > 5 ? runningHandicap(rounds.slice().sort(chrono).slice(0, -5)).index : null;
  const idx_trend = idx != null && prior != null ? Math.round((idx - prior) * 10) / 10 : null;
  return { idx, idx_trend, form: rollingForm(rounds).slice(-10), rounds: rounds.length };
}
