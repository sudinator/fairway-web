/**
 * 212.41 — ONE-STEP GAME CREATION, PHASE 3 (scramble first): the rules of the new Create flow. A format moved to
 * one-step gets Format BEFORE Players, a Teams step inside Create, and nothing is saved until "Create game"
 * (create_game_complete, 0219). Formats not yet moved keep today's flow unchanged.
 */
import type { GameTypeOpt } from "./game-create";
import { scrambleTeamSizes } from "./scramble-teams";
import { groupShapesOk, allowsOneShortGroup, fieldFitsTeamGroups, teamGroupFieldSizes } from "./grouping";
import type { CreateGameSection } from "@/components/game/setup/create-game-workspace";

/** Formats whose Create flow is one step. Moved family by family, each after the owner approves it on staging. */
export const ONE_STEP_FORMATS: ReadonlySet<GameTypeOpt> = new Set<GameTypeOpt>(["scramble", "fourball", "trifecta", "alt_shot", "match", "skins"]);   // 212.43: + the four-ball family; 212.58: + match play and skins
/** 212.58: match play (individual or team) and skins (individual or team 1:1) — matchups built inside Create. */
export const isMatchOneStep = (t: GameTypeOpt) => t === "match" || t === "skins";
/** The team formats whose groups ARE the matches (two a side) — four-ball, trifecta, alternate shot. */
export const isTeamGroupOneStep = (t: GameTypeOpt) => t === "fourball" || t === "trifecta" || t === "alt_shot";
export const isOneStep = (t: GameTypeOpt) => ONE_STEP_FORMATS.has(t);

/** The Create steps, in order: Game → Format → Players → Review; one-step formats add Teams before Review. */
export function createSectionsFor(t: GameTypeOpt): CreateGameSection[] {
  // Format comes before Players for EVERY format (owner, Oct 24: decision 1) — so the steps never reorder mid-way.
  return isOneStep(t) ? ["game", "format", "players", "teams", "review"] : ["game", "format", "players", "review"];
}
// Owner, Oct 25: the first step is really the course ("Course"), and the format step is the game itself ("Game").
export const SECTION_LABEL: Record<CreateGameSection, string> = { game: "Course", format: "Game", players: "Players", teams: "Teams", review: "Review" };

const word = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
/** "1 player makes", "8 players make" */
const players = (n: number) => `${word(n, "player")} ${n === 1 ? "makes" : "make"}`;
/** "a", "a or b", "a, b or c" */
const orList = (xs: string[]) => (xs.length < 3 ? xs.join(" or ") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);
/** "4 teams of 2", "3 teams — 2 of 2 and 1 of 3" */
function describeSizes(sizes: number[]): string {
  const counts = new Map<number, number>(); sizes.forEach((n) => counts.set(n, (counts.get(n) ?? 0) + 1));
  const parts = [...counts.entries()].sort((a, b) => a[0] - b[0]);
  return parts.length === 1 ? `${word(sizes.length, "team")} of ${parts[0][0]}` : `${word(sizes.length, "team")} (${parts.map(([sz, c]) => `${c} of ${sz}`).join(" and ")})`;
}
/** The live hint on the Players step: what this many players can make in the chosen format. Scramble team sizes are
 * chosen on the Teams step ("Every player"), or each player is a captain ("Captains only"). */
export function playerCountHint(t: GameTypeOpt, o: { players: number; captains?: boolean; scrambleMode?: "field" | "match"; teamMode?: boolean }): { text: string; ok: boolean } | null {
  const n = o.players;
  if (isMatchOneStep(t)) {   // 212.58
    if (n < 2) return { text: "Add at least 2 players.", ok: false };
    if (o.teamMode) return n % 2 === 0 ? { text: `${players(n)} two teams of ${n / 2}, with ${n / 2} matches.`, ok: true } : { text: `${n} players can't split into two equal teams — add or remove one.`, ok: false };
    if (t === "skins") return { text: `${players(n)} an individual skins game.`, ok: true };
    return n % 2 === 0 ? { text: `${players(n)} ${word(n / 2, "match", "matches")}.`, ok: true } : { text: `${players(n)} ${word((n - 1) / 2, "match", "matches")} — one player has a bye.`, ok: true };
  }
  if (isTeamGroupOneStep(t)) {
    // 212.47 (owner, Oct 26: keep it strict): say up front whether this many players works for the format
    const label = t === "alt_shot" ? "Alternate shot" : t === "trifecta" ? "Trifecta" : "Four-ball";
    const sizes = teamGroupFieldSizes(t);
    const list = `${sizes.slice(0, -1).join(", ")} or ${sizes[sizes.length - 1]}`;
    if (!fieldFitsTeamGroups(t, n)) {
      // the nearest sizes that work, either side
      const up = sizes.find((x) => x > n), down = [...sizes].reverse().find((x) => x < n);
      const fix = [up ? `add ${up - n === 1 ? "1 player" : `${up - n} players`} (for ${up})` : null, down ? `remove ${n - down === 1 ? "1" : n - down} (for ${down})` : null].filter(Boolean).join(" or ");
      return { text: `${label} works with ${list} players${t === "alt_shot" ? " (two pairs a group)" : ""} — you have ${n}: ${fix}.`, ok: false };
    }
    const a = Math.ceil(n / 2), b = Math.floor(n / 2), groups = Math.ceil(a / 2);
    return a === b
      ? { text: `${n} players: two teams of ${a}, ${groups} group${groups === 1 ? "" : "s"} of 2 v 2.`, ok: true }
      : { text: `${n} players: teams of ${a} and ${b} — ${groups} groups, one of them 2 v 1${t === "trifecta" ? " (the lone player plays a single against each opponent)" : " (the lone player's ball against the pair's best ball)"}.`, ok: true };
  }
  if (t !== "scramble") return null;
  if (n < 2) return { text: "Add players — a scramble needs at least two.", ok: false };
  if (o.captains) return { text: `${word(n, "captain")} — each one keeps score for a whole team. Their teammates don't need the app.`, ok: true };
  const sizes = [2, 3, 4] as const;
  if (o.scrambleMode === "match") {
    const fits = sizes.filter((sz) => n % (2 * sz) === 0);
    if (!fits.length) return { text: `${word(n, "player")} can't split into equal sides for team v team — add or remove players (sides of 2, 3 or 4, in pairs of teams).`, ok: false };
    return { text: `${word(n, "player")} can play ${orList(fits.map((sz) => `${word(n / (2 * sz), "match", "matches")} of ${sz} v ${sz}`))}. You'll pick on the Teams step.`, ok: true };
  }
  if (n < 4) return { text: `${word(n, "player")} make just one team — add players so two or more teams can play for the leaderboard.`, ok: false };
  const even = sizes.filter((sz) => n % sz === 0 && n / sz >= 2);
  if (even.length) return { text: `${word(n, "player")} can play as ${orList(even.map((sz) => `${word(n / sz, "team")} of ${sz}`))}. You'll pick on the Teams step.`, ok: true };
  const mixed = scrambleTeamSizes(n, 2);
  if (mixed) return { text: `${word(n, "player")} means mixed team sizes — for example ${describeSizes(mixed)}. You'll pick on the Teams step.`, ok: true };
  return { text: `${word(n, "player")} is too few for teams — a scramble team needs at least 2.`, ok: false };
}

/** The Teams step's starting suggestion: the biggest even team size (4, then 3, then 2), else mixed teams of about 2. */
export function defaultScrambleSize(n: number): 2 | 3 | 4 {
  return ([4, 3, 2] as const).find((sz) => n % sz === 0 && n / sz >= 2) ?? 2;
}

/** A saved draft: created with "Save draft", not yet sent to its players (games.players_notified_at is null). */
export const isDraftGame = (g: { players_notified_at?: string | null }) => g.players_notified_at === null;
/** Owner, Oct 25: a draft is visible only to its organizer and club admins until it is sent to the players. */
export function visibleGames<T extends { players_notified_at?: string | null; created_by?: string | null }>(games: T[], me: string | null, clubAdmin: boolean): T[] {
  return games.filter((g) => !isDraftGame(g) || clubAdmin || (!!me && g.created_by === me));
}

/** 212.43: what a four-ball-family line-up still needs before "Create game" (null = ready). Mirrors Manage Game's
 * readiness: everyone on a team and in a group, every group exactly two a side, and in alternate shot who drives first. */
export function teamGroupLineupProblem(gameType: GameTypeOpt,
  players: { id: string; display_name: string; team: string | null; tee_group: number | null }[],
  foursomes: { id: string; name?: string; a?: string[] | null; b?: string[] | null; a_first?: string | null; b_first?: string | null }[]): string | null {
  if (!players.length) return "Add players first.";
  // the root cause first: no grouping can fix an odd alternate-shot field
  if (gameType === "alt_shot" && players.length % 2 === 1) return "Alternate shot needs an even number of players — each side shares one ball between two.";
  const noTeam = players.filter((p) => !p.team);
  if (noTeam.length) return `${noTeam.length === 1 ? `${noTeam[0].display_name} isn't` : `${noTeam.length} players aren't`} on a team yet.`;
  const noGroup = players.filter((p) => p.tee_group == null);
  if (noGroup.length) return `${noGroup.length === 1 ? `${noGroup[0].display_name} isn't` : `${noGroup.length} players aren't`} in a group yet.`;
  // 212.45: two a side — or, in four-ball and trifecta with an odd number, exactly ONE 2 v 1 group (owner, Oct 26)
  const shapes = foursomes.map((f) => [(f.a ?? []).length, (f.b ?? []).length] as [number, number]);
  if (!foursomes.length || !groupShapesOk(gameType, shapes)) {
    const bad = foursomes.find((f) => !(((f.a ?? []).length === 2) && ((f.b ?? []).length === 2)));
    return `Each group needs two players from each team${allowsOneShortGroup(gameType) ? " (with an odd number, one group plays 2 v 1)" : ""}${bad ? ` — ${bad.name ?? "a group"} has ${(bad.a ?? []).length} v ${(bad.b ?? []).length}` : ""}.`;
  }
  if (gameType === "alt_shot" && foursomes.some((f) => !f.a_first || !f.b_first)) return "Choose who drives first for each side in every group.";
  return null;
}


/**
 * 212.58 — Review's rule for match play and skins. Team variants: everyone on a team, both teams the same size, and a
 * complete set of 1 v 1 matchups across the teams. Individual match play: everyone paired (with an odd number, one player
 * has a bye). Individual skins: nothing to pair. Groups are optional, as in Manage Game.
 */
export function matchLineupProblem(t: GameTypeOpt, o: { teamMode: boolean; players: { id: string; team?: string | null; no_show?: boolean | null }[]; pairings: { a: string; b: string }[]; teams: { key: string; name: string }[] | null; keyOf: (p: { id: string }) => string }): string | null {
  const ps = o.players.filter((p) => !p.no_show);
  const pairs = o.pairings.filter((x) => x.a && x.b && x.a !== x.b);
  if (ps.length < 2) return "Add at least 2 players.";
  if (o.teamMode) {
    const teams = o.teams ?? [];
    if (teams.length !== 2) return "Name the two teams.";
    const un = ps.filter((p) => !p.team).length;
    if (un) return `Put ${un === 1 ? "1 player" : `${un} players`} on a team.`;
    const [na, nb] = teams.map((x) => ps.filter((p) => p.team === x.key).length);
    if (na !== nb) return `The teams need the same number of players — now ${teams[0].name} ${na} v ${teams[1].name} ${nb}.`;
    const keyTeam = new Map(ps.map((p) => [o.keyOf(p), p.team]));
    if (pairs.some((x) => keyTeam.get(x.a) === keyTeam.get(x.b))) return "Each matchup pairs one player from each team.";
    if (pairs.length < na) return `Set all ${na} matchups — ${pairs.length} so far.`;
    return null;
  }
  if (t === "skins") return null;
  const paired = new Set(pairs.flatMap((x) => [x.a, x.b]));
  const left = ps.filter((p) => !paired.has(o.keyOf(p))).length;
  if (left > (ps.length % 2 === 1 ? 1 : 0)) return `Pair everyone up — ${left} ${left === 1 ? "player" : "players"} still without a match.`;
  return null;
}
