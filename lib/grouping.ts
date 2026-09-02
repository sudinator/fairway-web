// Pure tee-group randomizer. No React, no DB — safe to unit-test.
//
// Rules (agreed with the group):
//  * A member and the guests they sponsored form one PARTY that must stay together.
//  * A foursome never exceeds `maxPer` (4) people.
//  * A sponsor keeps a full foursome: sponsor + up to 3 guests. Guests beyond that
//    are OVERFLOW — left unassigned for the organizer to place by hand.
//  * Groups come out balanced (e.g. 5 -> [3,2], 10 -> [4,3,3]); never a lone single
//    when it can be avoided.

export type GPlayer = {
  id: string;                 // game_players row id
  userId: string | null;      // the member's user id (null for guests)
  isGuest: boolean;
  guestOf: string | null;     // sponsor's userId, for guests
};

export type Party = { hostId: string; playerIds: string[] };

export type BuiltParties = {
  parties: Party[];                                   // capped parties to seat
  overflow: { sponsorUserId: string; guestIds: string[] }[]; // guests beyond a foursome
};

// Deterministic RNG for reproducible shuffles in tests (mulberry32).
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Build parties, keeping each guest with the sponsor who invited them and capping
// a party at `maxPer` people. Guests whose sponsor isn't in the field (or who have
// no sponsor) become their own party of one.
export function buildParties(field: GPlayer[], maxPer = 4): BuiltParties {
  const members = field.filter((p) => !p.isGuest);
  const guests = field.filter((p) => p.isGuest);
  const memberUserIds = new Set(members.map((m) => m.userId).filter((u): u is string => !!u));

  const parties: Party[] = [];
  const overflow: { sponsorUserId: string; guestIds: string[] }[] = [];
  const claimed = new Set<string>();

  for (const m of members) {
    const mine = m.userId ? guests.filter((g) => g.guestOf === m.userId) : [];
    mine.forEach((g) => claimed.add(g.id));
    const room = Math.max(0, maxPer - 1);        // seats beside the sponsor
    const seated = mine.slice(0, room);
    const extra = mine.slice(room);
    parties.push({ hostId: m.id, playerIds: [m.id, ...seated.map((g) => g.id)] });
    if (extra.length && m.userId) overflow.push({ sponsorUserId: m.userId, guestIds: extra.map((g) => g.id) });
  }
  // Orphan guests: sponsor not in the field, or no sponsor recorded.
  for (const g of guests) {
    if (claimed.has(g.id)) continue;
    if (g.guestOf && memberUserIds.has(g.guestOf)) continue; // safety; shouldn't happen
    parties.push({ hostId: g.id, playerIds: [g.id] });
  }
  return { parties, overflow };
}

// Seat intact parties into balanced bins of at most `maxPer`. Best-fit-decreasing:
// big parties first (so a 2/3-some never gets stranded), each seated into the bin
// with the most remaining room that still fits it — which spreads people evenly.
export function seatParties(parties: Party[], maxPer = 4, rng: () => number = Math.random): string[][] {
  const shuffled = shuffle(parties, rng);
  shuffled.sort((a, b) => b.playerIds.length - a.playerIds.length); // stable: singles keep shuffle order
  const people = shuffled.reduce((n, p) => n + p.playerIds.length, 0);
  const bins: string[][] = Array.from({ length: Math.max(1, Math.ceil(people / maxPer)) }, () => []);
  for (const party of shuffled) {
    let best = -1, bestRoom = -1;
    bins.forEach((b, i) => {
      const room = maxPer - b.length;
      if (room >= party.playerIds.length && room > bestRoom) { best = i; bestRoom = room; }
    });
    if (best === -1) { bins.push([]); best = bins.length - 1; }
    bins[best].push(...party.playerIds);
  }
  return bins.filter((b) => b.length);
}

export type RandomResult = {
  assignments: { playerId: string; group: number }[]; // group is 1-based
  overflowGuestIds: string[];                          // to be left unassigned (tee_group = null)
};

export type CompetitivePlayer = {
  id: string;
  team?: string | null;
  playingHandicap?: number | null;
};

export type CompetitiveAssignmentResult = {
  assignments: { playerId: string; group: number }[];
  unassignedIds: string[];
};

const handicapOrder = (a: CompetitivePlayer, b: CompetitivePlayer) => {
  const ah = a.playingHandicap == null || !Number.isFinite(a.playingHandicap) ? Number.POSITIVE_INFINITY : a.playingHandicap;
  const bh = b.playingHandicap == null || !Number.isFinite(b.playingHandicap) ? Number.POSITIVE_INFINITY : b.playingHandicap;
  return ah - bh || a.id.localeCompare(b.id);
};

/**
 * Build valid team-match foursomes: exactly two players from each of the two
 * persistent teams. Within each team, low+high handicap pairs reduce the spread
 * between groups; the second team's pairs are then matched in reverse total order.
 * Odd/imbalanced leftovers stay explicitly unassigned instead of creating a 3-v-1.
 */
export function balancedTeamGroups(field: CompetitivePlayer[], teamKeys: [string, string]): CompetitiveAssignmentResult {
  const pairsFor = (key: string) => {
    const sorted = field.filter((p) => p.team === key).sort(handicapOrder);
    const pairs: CompetitivePlayer[][] = [];
    while (sorted.length >= 2) pairs.push([sorted.shift()!, sorted.pop()!]);
    return { pairs, leftovers: sorted };
  };
  const a = pairsFor(teamKeys[0]);
  const b = pairsFor(teamKeys[1]);
  const pairTotal = (pair: CompetitivePlayer[]) => pair.reduce((n, p) => n + (p.playingHandicap ?? 0), 0);
  a.pairs.sort((x, y) => pairTotal(y) - pairTotal(x));
  b.pairs.sort((x, y) => pairTotal(x) - pairTotal(y));
  const count = Math.min(a.pairs.length, b.pairs.length);
  const assignments: CompetitiveAssignmentResult["assignments"] = [];
  for (let i = 0; i < count; i++) {
    [...a.pairs[i], ...b.pairs[i]].forEach((p) => assignments.push({ playerId: p.id, group: i + 1 }));
  }
  const placed = new Set(assignments.map((x) => x.playerId));
  return { assignments, unassignedIds: field.filter((p) => !placed.has(p.id)).map((p) => p.id) };
}

/** Build one-opponent-per-player matchups. Team Singles pairs across the two
 * teams by nearest playing handicap; standalone Singles pairs adjacent players.
 * An odd or imbalanced remainder is left unassigned and remains visible in setup.
 */
export function balancedOneVOne(field: CompetitivePlayer[], teamKeys?: [string, string]): { pairings: { a: string; b: string }[]; unassignedIds: string[] } {
  const pairings: { a: string; b: string }[] = [];
  if (teamKeys) {
    const left = field.filter((p) => p.team === teamKeys[0]).sort(handicapOrder);
    const available = field.filter((p) => p.team === teamKeys[1]).sort(handicapOrder);
    for (const a of left) {
      if (!available.length) break;
      const ah = a.playingHandicap ?? 0;
      let best = 0;
      for (let i = 1; i < available.length; i++) {
        if (Math.abs((available[i].playingHandicap ?? 0) - ah) < Math.abs((available[best].playingHandicap ?? 0) - ah)) best = i;
      }
      const b = available.splice(best, 1)[0];
      pairings.push({ a: a.id, b: b.id });
    }
  } else {
    const sorted = [...field].sort(handicapOrder);
    while (sorted.length >= 2) pairings.push({ a: sorted.shift()!.id, b: sorted.shift()!.id });
  }
  const placed = new Set(pairings.flatMap((p) => [p.a, p.b]));
  return { pairings, unassignedIds: field.filter((p) => !placed.has(p.id)).map((p) => p.id) };
}

// Top-level: field in, group assignments out. Overflow guests are reported so the
// caller can null their tee_group and prompt the organizer to place them.
export function randomTeeGroups(field: GPlayer[], maxPer = 4, rng: () => number = Math.random): RandomResult {
  const { parties, overflow } = buildParties(field, maxPer);
  const groups = seatParties(parties, maxPer, rng);
  const assignments: { playerId: string; group: number }[] = [];
  groups.forEach((ids, i) => ids.forEach((id) => assignments.push({ playerId: id, group: i + 1 })));
  return { assignments, overflowGuestIds: overflow.flatMap((o) => o.guestIds) };
}
