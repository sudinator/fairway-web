/** Read-only analytics scope and evidence; never feeds scoring, posting or stored handicaps. */
import { played, isGrossOnly, roundHoleCount, roundDifferential, runningHandicap, type Round } from './golf';
import { roundStatCompleteness } from './round-stats';
import { isFullCard, holeScore } from './round-rules';
export type AnalyticsWindow = '5' | '20' | 'season' | 'all';
export type AnalyticsFilters = { window: AnalyticsWindow; course: string; tee: string; length: 'all' | '9' | '18' };
export const analyticsNameKey = (s: string | null | undefined) => (s || '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
export function analyticsScope(rounds: Round[], filters: AnalyticsFilters, now = new Date()): Round[] {
  const year = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric' }).format(now);
  const filtered = rounds.filter(r => (!r.status || r.status === 'final') && !(r as Round & { deleted_at?: string }).deleted_at)
    .filter(r => !filters.course || analyticsNameKey(r.course) === filters.course)
    .filter(r => !filters.tee || analyticsNameKey(r.tee_name) === filters.tee)
    .filter(r => filters.length === 'all' || roundHoleCount(r) === Number(filters.length))
    .filter(r => played(r).length > 0 || isGrossOnly(r))
    .sort((a, b) => b.played_at.localeCompare(a.played_at) || b.id.localeCompare(a.id));
  return filters.window === '5' ? filtered.slice(0, 5) : filters.window === '20' ? filtered.slice(0, 20)
    : filters.window === 'season' ? filtered.filter(r => r.played_at.slice(0, 4) === year) : filtered;
}
export function completeScoringRound(r: Round, holes: 9 | 18): boolean {
  return roundHoleCount(r) === holes && (isGrossOnly(r) ? Number.isFinite(r.gross_score) && r.gross_score! > 0 : r.holes.length === holes && isFullCard(r.holes.map(h => h.strokes), holes));
}
export function completePuttingRound(r: Round, holes: 9 | 18 = 18): boolean {
  return completeScoringRound(r, holes) && !isGrossOnly(r) && (holes !== 18 || roundStatCompleteness(r.holes).puttsRoundEligible) && r.holes.every(h => Number.isInteger(h.putts) && h.putts! >= 0);
}
export function analyticsCoverage(rounds: Round[]) {
  const hs = rounds.flatMap(played);
  const tracked = (f: (r: Round) => boolean) => rounds.filter(f).length;
  return {
    rounds: rounds.length, holes: hs.length,
    puttingRounds: tracked(r => completePuttingRound(r)),
    puttHoles: hs.filter(h => h.putts != null && h.putts >= 0).length,
    fairwayRounds: tracked(r => played(r).some(h => h.par >= 4 && h.fairway != null)),
    fairwayHoles: hs.filter(h => h.par >= 4 && h.fairway != null).length,
    fairwayEligible: hs.filter(h => h.par >= 4).length,
    girRounds: tracked(r => played(r).some(h => h.putts != null)),
    scrambleRounds: tracked(r => played(r).some(h => h.putts != null && holeScore(h.strokes) != null && h.strokes! - h.putts! > h.par - 2)),
    detailedRounds: tracked(r => played(r).length > 0),
  };
}
/** Same establishment boundary as Season Wrapped: only compare readings with 20 differentials. */
export function establishedIndexChange(rounds: Round[]) {
  const chronological = [...rounds].filter(r => roundDifferential(r) != null).sort((a, b) => a.played_at.localeCompare(b.played_at) || a.id.localeCompare(b.id));
  if (chronological.length < 20) return null;
  const first = runningHandicap(chronological.slice(0, 20)).index, current = runningHandicap(chronological).index;
  return first == null || current == null ? null : { first, current, delta: current - first };
}
