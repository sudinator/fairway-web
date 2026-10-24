// Scramble teams (211.1) — how a scramble's teams are stored and balanced. Pure.
//
// Teams live in games.foursomes (the group structure alternate shot uses):
//   * "field" (one leaderboard): each group is ONE team — { id, name: "Team 1", a: [players], b: [] };
//   * "match" (team v team):     each group is ONE match — { id, name: "Match 1", a: [team], b: [team] }.
// Each group's players share a tee group (group number = position + 1), so scoring permissions and markers work
// exactly as they do for alternate shot.

// 211.8: a_hcp / b_hcp — a team handicap the organizer entered (null / absent = calculated from its players).
export type ScrambleGroup = { id: string; name: string; a: string[]; b: string[]; a_hcp?: number | null; b_hcp?: number | null; tee?: number | null };
export type TeamPlayer = { key: string; ch: number | null };

/** Team sizes as even as possible within 2–4 (e.g. 10 players in teams of 4 → 4, 3, 3). null = can't (fewer than 2).
 *  Size 1 (211.8): every player is their own team — their teammates play outside the app. */
export function scrambleTeamSizes(players: number, size: 1 | 2 | 3 | 4): number[] | null {
  if (size === 1) return players >= 1 ? Array(players).fill(1) : null;
  if (players < 2) return null;
  let teams = Math.ceil(players / size);
  while (teams > 1 && Math.floor(players / teams) < 2) teams--;
  const base = Math.floor(players / teams), extra = players % teams;
  const sizes = Array.from({ length: teams }, (_, i) => base + (i < extra ? 1 : 0));
  return sizes.every((n) => n >= 2 && n <= 4) ? sizes : null;
}

/**
 * Balanced teams: players spread by course handicap, snake-style (lowest to team 1, next to team 2 … then back),
 * so every team gets a fair mix. For team v team, teams are paired into matches in order (1 v 2, 3 v 4, …).
 */
export function balanceScrambleTeams(players: TeamPlayer[], size: 1 | 2 | 3 | 4, mode: "field" | "match"): ScrambleGroup[] | null {
  const sizes = scrambleTeamSizes(players.length, size);
  if (!sizes) return null;
  const sorted = [...players].sort((x, y) => (x.ch ?? 99) - (y.ch ?? 99) || x.key.localeCompare(y.key));
  const teams: string[][] = sizes.map(() => []);
  let t = 0, dir = 1;
  for (const p of sorted) {
    let guard = 0;
    while (teams[t].length >= sizes[t] && guard++ < sizes.length * 2) { t += dir; if (t < 0 || t >= teams.length) { dir = -dir; t += dir; } }
    teams[t].push(p.key);
    t += dir;
    if (t < 0 || t >= teams.length) { dir = -dir; t += dir; }
  }
  if (mode === "field") return teams.map((a, i) => ({ id: `team-${i + 1}`, name: `Team ${i + 1}`, a, b: [] }));
  const out: ScrambleGroup[] = [];
  for (let i = 0; i < teams.length; i += 2) out.push({ id: `match-${i / 2 + 1}`, name: `Match ${i / 2 + 1}`, a: teams[i], b: teams[i + 1] ?? [] });
  return out;
}

/** Every team as { group, side, members } — the leaderboard and the scorecard read teams this way. */
export function scrambleTeamsOf(groups: ScrambleGroup[] | null | undefined, sideNames?: [string, string] | null): { groupId: string; side: "a" | "b"; name: string; members: string[]; hcp: number | null }[] {
  const out: { groupId: string; side: "a" | "b"; name: string; members: string[]; hcp: number | null }[] = [];
  let n = 0;
  for (const g of groups || []) for (const side of ["a", "b"] as const) {
    const members = (g[side] || []) as string[];
    if (!members.length) continue;
    n++;
    const h = g[side === "a" ? "a_hcp" : "b_hcp"];
    // 212.5: a Ryder Cup scramble's sides are the Cup's teams ("Reds", "Blues") — each group is one match
    out.push({ groupId: g.id, side, name: sideNames ? sideNames[side === "a" ? 0 : 1] : `Team ${n}`, members, hcp: typeof h === "number" && Number.isFinite(h) ? h : null });
  }
  return out;
}

/** Setup is complete: every player on exactly one team of 2–4 (or 1 in a "teammates outside the app" game, where
 *  every team needs its handicap entered unless the game is gross); team v team needs two teams in every match. */
export function scrambleSetupProblem(groups: ScrambleGroup[] | null | undefined, playerKeys: string[], mode: "field" | "match", opts: { size?: number | null; gross?: boolean; method?: "usga" | "gross" | "agreed" | null; exact?: number | null; sideNames?: [string, string]; noShows?: { key: string; name: string }[] } = {}): string | null {
  const method = opts.method ?? (opts.gross ? "gross" : "usga");
  const solo = opts.size === 1;
  const gs = groups || [];
  if (!gs.length) return "Make the teams — Setup → Teams.";
  const placed = gs.flatMap((g) => [...g.a, ...g.b]);
  if (new Set(placed).size !== placed.length) return "A player is on two teams.";
  // 212.33 (owner, staging game 386503): a no-show keeps their team place (owner: "I would leave on the team") — so
  // say so, by name, until the organizer moves them or returns them to play. The team handicap still counts them.
  for (const ns of opts.noShows ?? []) {
    const t = scrambleTeamsOf(gs, opts.sideNames).find((x) => x.members.includes(ns.key));
    if (t) return `${ns.name} is marked as a no-show but is on ${t.name} — take them off the team, or return them to play.`;
  }
  const missing = playerKeys.filter((k) => !placed.includes(k)).length;
  if (missing) return `${missing} player${missing === 1 ? " isn't" : "s aren't"} on a team yet.`;
  if (mode === "field" && gs.some((g) => !g.a.length && !g.b.length)) return "A team has no players — add players to it or remove it.";
  // 212.3 (checked before the general size rule, so a Cup reads it by match and side): a Ryder Cup scramble — every team in every match has exactly the session's number of players
  if (opts.exact) for (const g of gs) for (const side of ["a", "b"] as const) {
    if (g[side].length !== opts.exact) return `${g.name}: ${opts.sideNames?.[side === "a" ? 0 : 1] ?? (side === "a" ? "Team A" : "Team B")} have ${g[side].length} of ${opts.exact} players.`;
  }
  for (const t of scrambleTeamsOf(gs)) {
    if (t.members.length < (solo ? 1 : 2) || t.members.length > 4) return `${t.name} has ${t.members.length} player${t.members.length === 1 ? "" : "s"} — a scramble team has 2 to 4.`;
    if (solo && method === "usga" && t.hcp == null) return `Enter ${t.name}'s team handicap — its teammates play outside the app.`;
  }
  if (mode === "match" && gs.some((g) => !g.a.length || !g.b.length)) return "Every match needs two teams.";
  return null;
}

/**
 * 212.3: Ryder Cup scramble matches — each Cup side's players snake-drafted by course handicap into teams of EXACTLY
 * `size` (players beyond a whole team are left unplaced for the organizer to decide), paired into Match 1, 2, …
 * with Team A's team on side a and Team B's on side b.
 */
export function cupScrambleMatches(sideA: TeamPlayer[], sideB: TeamPlayer[], size: 2 | 3 | 4): ScrambleGroup[] {
  const teamsOf = (ps: TeamPlayer[]) => {
    const n = Math.floor(ps.length / size);
    const sorted = [...ps].sort((x, y) => (x.ch ?? 99) - (y.ch ?? 99) || x.key.localeCompare(y.key)).slice(0, n * size);
    const teams: string[][] = Array.from({ length: n }, () => []);
    sorted.forEach((p, i) => { const round = Math.floor(i / n), pos = i % n; teams[round % 2 === 0 ? pos : n - 1 - pos].push(p.key); });
    return teams;
  };
  const a = teamsOf(sideA), b = teamsOf(sideB);
  return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => ({ id: `match-${i + 1}`, name: `Match ${i + 1}`, a: a[i] || [], b: b[i] || [] }));
}

/** 212.5: the Cup's two team names when a scramble game has them (a Ryder Cup session), else null. */
export function cupSideNames(game: { teams?: unknown }): [string, string] | null {
  const t = Array.isArray(game.teams) ? (game.teams as { key?: string; name?: string }[]) : [];
  return t.length === 2 ? [t[0]?.name || "Team A", t[1]?.name || "Team B"] : null;
}

/** 212.34 (owner, Oct 23) — which TEE GROUP each team plays in, for a one-leaderboard scramble. Saving teams used to
 * make every team its own group, so two teams of 2 playing as a foursome had two group cards and one scorer couldn't
 * keep both. Rules: a team never splits; a group holds at most 4 players (a captain counts as one); teams of 2 pair
 * up by default; captains (owner: "don't need to default to 2 teams per group but have that option") and teams of
 * 3–4 default to one team per group; the organizer's choice (foursomes[].tee) wins wherever it still fits. Team v
 * team keeps one group per match. Returns team id → group number 1..n, numbered in team order. */
export const SCRAMBLE_GROUP_MAX = 4;
export function scrambleTeeGroups(groups: ScrambleGroup[] | null | undefined, mode: "field" | "match", captains: boolean): Map<string, number> {
  const gs = (groups || []).filter((g) => (g.a?.length ?? 0) + (g.b?.length ?? 0) > 0);
  const out = new Map<string, number>();
  if (mode === "match") { gs.forEach((g, i) => out.set(g.id, i + 1)); return out; }
  const size = (g: ScrambleGroup) => (g.a?.length ?? 0) + (g.b?.length ?? 0);
  const load = new Map<string, number>(), label = new Map<string, string>();   // provisional group labels
  // 1. the organizer's choices, where they fit
  for (const g of gs) {
    if (typeof g.tee !== "number" || !Number.isInteger(g.tee) || g.tee < 1) continue;
    const k = `t${g.tee}`;
    if ((load.get(k) ?? 0) + size(g) > SCRAMBLE_GROUP_MAX) continue;
    load.set(k, (load.get(k) ?? 0) + size(g)); label.set(g.id, k);
  }
  // 2. everyone else: teams of 2 pair up (not captains); the rest play one team per group
  let n = 0, open: string | null = null;
  for (const g of gs) {
    if (label.has(g.id)) continue;
    if (!captains && size(g) === 2 && open && (load.get(open) ?? 0) + 2 <= SCRAMBLE_GROUP_MAX) {
      load.set(open, (load.get(open) ?? 0) + 2); label.set(g.id, open); open = null; continue;
    }
    const k = `d${++n}`; load.set(k, size(g)); label.set(g.id, k);
    if (!captains && size(g) === 2) open = k;   // a lone pair waits for the next pair, even past a bigger team
  }
  // 3. number the groups 1..n in the order their first team appears
  const num = new Map<string, number>();
  for (const g of gs) { const k = label.get(g.id)!; if (!num.has(k)) num.set(k, num.size + 1); out.set(g.id, num.get(k)!); }
  return out;
}
