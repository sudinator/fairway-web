// Frozen pre-net classification body for differential testing.
import { played, type Round } from "./golf";
export function legacyHoleBuckets(rounds: Round[]) {
  const b = { eagle: 0, birdie: 0, par: 0, bogey: 0, double: 0 };
  rounds.forEach((r) =>
    played(r).forEach((h) => {
      const d = (h.strokes || 0) - h.par;
      if (d <= -2) b.eagle++;
      else if (d === -1) b.birdie++;
      else if (d === 0) b.par++;
      else if (d === 1) b.bogey++;
      else b.double++;
    })
  );
  return b;
}
