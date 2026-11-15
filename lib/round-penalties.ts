/** A confirmed record includes explicit zeros; legacy/default zeros remain unknown. */
import { played, roundHoleCount, type Round } from './golf';
export function completePenaltyRound(r: Round, holes: 9 | 18): boolean {
  const hs=played(r);
  return (!r.status || r.status === 'final') && !(r as Round & {deleted_at?:string|null}).deleted_at && r.penalties_tracked === true && roundHoleCount(r) === holes && r.holes.length === holes && hs.length === holes && hs.every(h => Number.isInteger(h.penalties) && h.penalties >= 0);
}
