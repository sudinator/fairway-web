// Scramble teams (211.1) — how a scramble's teams are stored and balanced. Pure.
//
// Teams live in games.foursomes (the group structure alternate shot uses):
//   * "field" (one leaderboard): each group is ONE team — { id, name: "Team 1", a: [players], b: [] };
//   * "match" (team v team):     each group is ONE match — { id, name: "Match 1", a: [team], b: [team] }.
// Each group's players share a tee group (group number = position + 1), so scoring permissions and markers work
// exactly as they do for alternate shot.

export type ScrambleGroup = { id: string; name: string; a: string[]; b: string[] };
export type TeamPlayer = { key: string; ch: number | null };

/** Team sizes as even as possible within 2–4 (e.g. 10 players in teams of 4 → 4, 3, 3). null = can't (fewer than 2). */
export function scrambleTeamSizes(players: number, size: 2 | 3 | 4): number[] | null {
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
export function balanceScrambleTeams(players: TeamPlayer[], size: 2 | 3 | 4, mode: "field" | "match"): ScrambleGroup[] | null {
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
export function scrambleTeamsOf(groups: ScrambleGroup[] | null | undefined): { groupId: string; side: "a" | "b"; name: string; members: string[] }[] {
  const out: { groupId: string; side: "a" | "b"; name: string; members: string[] }[] = [];
  let n = 0;
  for (const g of groups || []) for (const side of ["a", "b"] as const) {
    const members = (g[side] || []) as string[];
    if (!members.length) continue;
    n++;
    out.push({ groupId: g.id, side, name: `Team ${n}`, members });
  }
  return out;
}

/** Setup is complete: every player on exactly one team of 2–4; team v team needs two teams in every match. */
export function scrambleSetupProblem(groups: ScrambleGroup[] | null | undefined, playerKeys: string[], mode: "field" | "match"): string | null {
  const gs = groups || [];
  if (!gs.length) return "Make the teams — Setup → Teams.";
  const placed = gs.flatMap((g) => [...g.a, ...g.b]);
  if (new Set(placed).size !== placed.length) return "A player is on two teams.";
  const missing = playerKeys.filter((k) => !placed.includes(k)).length;
  if (missing) return `${missing} player${missing === 1 ? " isn't" : "s aren't"} on a team yet.`;
  for (const t of scrambleTeamsOf(gs)) if (t.members.length < 2 || t.members.length > 4) return `${t.name} has ${t.members.length} player${t.members.length === 1 ? "" : "s"} — a scramble team has 2 to 4.`;
  if (mode === "match" && gs.some((g) => !g.a.length || !g.b.length)) return "Every match needs two teams.";
  return null;
}
