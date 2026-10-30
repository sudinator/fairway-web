/**
 * 212.39 — ONE-STEP CREATION, PHASE 1 (part 2): the record of what MANAGE GAME saves — teams, matchups, groups — for
 * each format. For every case in lib/create-behaviour, a fixed set of organizer choices is turned into the exact calls
 * Manage Game makes, through the same shared rules its save handlers use (lib/structure-ops, lib/game-structure,
 * lib/scramble-teams), and rendered as SQL. ci/assert-structure-behaviour.sql replays them on a real database AS THE
 * ORGANIZER (permissions and triggers apply as in the app) and compares what is stored with the golden record in it.
 * Organizer choices: teams Reds = Amit, Raj, Nihar, Karan; Blues = Sam, Vikram, Bo, Guest Kumar. Groups of four in
 * that order (team formats: two from each side). Matchups Amit v Sam, Raj v Vikram, Nihar v Bo, Karan v Kumar.
 */
import { createBehaviour, behaviourCases, type CreateCase } from "./create-behaviour";
import { teamMoveArgs, teamPlayFoursomesAfter, scrambleTeeAssignments, altShotFirstDriverFoursomes, trifectaSwapFoursomes, foursomeTeeGroupUpdates } from "./structure-ops";
import { addFoursome, assignFoursomePlayer, deriveTeeGroupsFromFoursomes, type Foursome } from "./game-structure";
import type { ScrambleGroup } from "./scramble-teams";
import type { Game, Player } from "./game-types";

const hex = (n: number, w: number) => n.toString(16).padStart(w, "0");
export const ORGANIZER = "21390000-0000-0000-0000-0000000000a0";
export const CLUB = "21390000-0000-0000-0000-00000000c1b0";
const USERS: Record<string, string> = { "u-amit": ORGANIZER };
["u-raj", "u-nihar", "u-karan", "u-sam", "u-vikram", "u-bo", "u-dev"].forEach((u, i) => { USERS[u] = `21390000-0000-0000-0000-0000000000a${i + 1}`; });
export const MEMBER_USERS = USERS;
const gameId = (n: number) => `21391000-0000-0000-0000-${hex(n, 12)}`;
const rowId = (n: number, k: number) => `21392000-0000-0000-${hex(n, 4)}-${hex(k, 12)}`;
const q = (v: unknown) => `'${JSON.stringify(v).replace(/'/g, "''")}'`;

type Op = { route: string; sql: string };
export type StructureCase = { id: string; gameId: string; insertGame: string; insertPlayers: string; ops: Op[];
  /** 212.40: what Create saved, and the line-up the organizer ended with — the one-step flow is given exactly these. */
  created: { game: Record<string, unknown>; players: Record<string, unknown>[] }; final: { game: Game; players: Player[] } };

export function structureCase(c: CreateCase, n: number): StructureCase | null {
  const rec = createBehaviour(c);
  if (rec.blocked) return null;   // Create refuses it, so Manage Game never sees it
  const gid = gameId(n);
  const game = { ...(rec.game as Record<string, unknown>), id: gid, group_id: CLUB, created_by: ORGANIZER, code: String(213900 + n) } as unknown as Game & Record<string, unknown>;
  const players = rec.players.map((r, k) => ({ ...(r as Record<string, unknown>), id: rowId(n, k), game_id: gid,
    user_id: (r as { user_id: string | null }).user_id ? USERS[(r as { user_id: string }).user_id] : null,
    guest_of: (r as { guest_of?: string | null }).guest_of ? USERS[(r as { guest_of: string }).guest_of] : (r as { guest_of?: unknown }).guest_of ?? null,
    team: (r as { team?: string | null }).team ?? null, tee_group: (r as { tee_group?: number | null }).tee_group ?? null })) as unknown as Player[];   // 212.67: a Cup session's rows arrive with their sides
  const key = (p: Player) => p.user_id ?? p.id;
  const ops: Op[] = [];
  let state: { game: Game; players: Player[] } = { game, players };
  const setGame = (patch: Record<string, unknown>, route: string) => {
    ops.push({ route, sql: `update public.games set ${Object.keys(patch).map((k) => `${k} = ${q(patch[k])}::jsonb`).join(", ")} where id = '${gid}';` });
    state = { ...state, game: { ...state.game, ...patch } as Game };
  };
  // the routes Manage Game takes
  const setTeam = (p: Player, team: string) => {   // setPlayerTeam
    const next = state.players.map((x) => (x.id === p.id ? { ...x, team } : x));
    const a = teamMoveArgs(gid, state.game, next, [{ player: p.id, team }]);
    ops.push({ route: "setPlayerTeam → apply_game_structure", sql: `perform public.apply_game_structure('${gid}'::uuid, ${q(a.p_teams)}::jsonb, ${q(a.p_groups)}::jsonb, ${a.p_foursomes === null ? "null" : q(a.p_foursomes)}::jsonb);` });
    state = { game: a.p_foursomes ? { ...state.game, foursomes: a.p_foursomes } as Game : state.game, players: next };
  };
  const setTeeGroup = (p: Player, group: number) => {   // setPlayerTeeGroup (+ syncTeamPlayFoursomes)
    ops.push({ route: "setPlayerTeeGroup → set_tee_group", sql: `perform public.set_tee_group('${p.id}'::uuid, ${group}::smallint);` });
    const next = state.players.map((x) => (x.id === p.id ? { ...x, tee_group: group } : x));
    state = { ...state, players: next };
    const f = teamPlayFoursomesAfter(state.game, next);
    if (f) setGame({ foursomes: f }, "syncTeamPlayFoursomes → games.foursomes");
  };
  const P = (name: string) => state.players.find((p) => p.display_name === name)!;
  const has = (name: string) => state.players.some((p) => p.display_name === name);
  // 212.67: a Cup session has no guest — the fixed names skip whoever isn't in the field
  const RED = ["Amit Sud", "Raj Mehta", "Nihar Shah", "Karan Patel"].filter(has), BLUE = ["Sam Lee", "Vikram Rao", "Bo Li", "Guest Kumar", "Dev Kapoor"].filter(has);   // a session: Dev Kapoor in the guest's place
  const ORDER = [...RED, ...BLUE];
  const MATCHES: [string, string][] = ([["Amit Sud", "Sam Lee"], ["Raj Mehta", "Vikram Rao"], ["Nihar Shah", "Bo Li"], ["Karan Patel", has("Guest Kumar") ? "Guest Kumar" : "Dev Kapoor"]] as [string, string][]).filter(([x, y]) => has(x) && has(y));
  const teamsPreset = c.session != null;   // v1.0: the Cup set the sides; the organizer never did
  const g = state.game, type = g.game_type, hasTeams = Array.isArray(g.teams) && g.teams.length === 2, has4 = Array.isArray(g.foursomes);

  if (type === "scramble") {   // setScrambleTeams: the teams, then each player's group from scrambleTeeGroups
    const size = c.scrambleTeamSize ?? 4, field = (g as { scramble_mode?: string }).scramble_mode !== "match";
    const chunks = (names: string[], k: number) => Array.from({ length: Math.ceil(names.length / k) }, (_, i) => names.slice(i * k, i * k + k));
    let groups: ScrambleGroup[];
    if (field) groups = chunks(ORDER, size).map((t, i) => ({ id: `team-${i + 1}`, name: `Team ${i + 1}`, a: t.map((nm) => key(P(nm))), b: [] }));
    else { const half = size === 4 ? 1 : 2; groups = Array.from({ length: half }, (_, i) => ({ id: `match-${i + 1}`, name: `Match ${i + 1}`, a: chunks(RED, size)[i].map((nm) => key(P(nm))), b: chunks(BLUE, size)[i].map((nm) => key(P(nm))) })); }
    setGame({ foursomes: groups }, "setScrambleTeams → games.foursomes");
    const assign = scrambleTeeAssignments(state.game, state.players, groups);
    ops.push({ route: "setScrambleTeams → set_tee_groups", sql: `perform public.set_tee_groups('${gid}'::uuid, ${q(assign)}::jsonb);` });
    state = { ...state, players: state.players.map((x) => { const t = assign.find((y) => y.player === x.id); return t ? { ...x, tee_group: t.group } : x; }) };
  } else if (hasTeams && has4 && type === "skins") {   // 2 v 2 skins: teams, then the foursome editor (saveFoursomes)
    if (!teamsPreset) ORDER.forEach((nm, i) => setTeam(P(nm), i < 4 ? "A" : "B"));
    let fs: Foursome[] = (state.game.foursomes ?? []) as Foursome[];
    const save = (next: Foursome[]) => {
      setGame({ foursomes: next }, "saveFoursomes → games.foursomes");
      const groupOf = deriveTeeGroupsFromFoursomes(next);
      for (const u of foursomeTeeGroupUpdates(state.players, groupOf)) {
        ops.push({ route: "saveFoursomes → game_players.tee_group", sql: `update public.game_players set tee_group = ${u.tee_group ?? "null"} where id = '${u.id}';` });
        state = { ...state, players: state.players.map((x) => (x.id === u.id ? { ...x, tee_group: u.tee_group } : x)) };
      }
      fs = next;
    };
    save(addFoursome(fs, "fs-1")); save(addFoursome(fs, "fs-2"));
    [["fs-1", "a", "Amit Sud"], ["fs-1", "a", "Raj Mehta"], ["fs-1", "b", "Sam Lee"], ["fs-1", "b", "Vikram Rao"],
     ["fs-2", "a", "Nihar Shah"], ["fs-2", "a", "Karan Patel"], ["fs-2", "b", "Bo Li"], ["fs-2", "b", "Guest Kumar"]]
      .forEach(([f, side, nm]) => save(assignFoursomePlayer(fs, f, side as "a" | "b", key(P(nm)))));
  } else if (hasTeams && has4) {   // four-ball, trifecta, alternate shot: teams, then groups of two a side
    if (!teamsPreset) ORDER.forEach((nm, i) => setTeam(P(nm), i < 4 ? "A" : "B"));
    [["Amit Sud", 1], ["Raj Mehta", 1], ["Sam Lee", 1], ["Vikram Rao", 1], ["Nihar Shah", 2], ["Karan Patel", 2], ["Bo Li", 2], ["Guest Kumar", 2], ["Dev Kapoor", 2]]
      .filter(([nm]) => has(nm as string)).forEach(([nm, gr]) => setTeeGroup(P(nm as string), gr as number));
    const f = (state.game.foursomes ?? []) as Foursome[];
    if (type === "alt_shot") for (const x of f) {   // setAltShotFirstDriver, both sides
      setGame({ foursomes: altShotFirstDriverFoursomes(state.game.foursomes as Foursome[], x.id, "a", (x.a ?? [])[0]) }, "setAltShotFirstDriver → games.foursomes");
      setGame({ foursomes: altShotFirstDriverFoursomes(state.game.foursomes as Foursome[], x.id, "b", (x.b ?? [])[0]) }, "setAltShotFirstDriver → games.foursomes");
    }
    if (type === "trifecta" && f[1]) setGame({ foursomes: trifectaSwapFoursomes(state.game.foursomes as Foursome[], f[1].id, true) }, "setTrifectaPairing → games.foursomes");
  } else {
    if (hasTeams && !teamsPreset) ORDER.forEach((nm, i) => setTeam(P(nm), i < 4 ? "A" : "B"));   // team match play, 1:1 skins
    const usesMatchups = type === "match" || (type === "skins" && hasTeams);
    if (usesMatchups) setGame({ pairings: MATCHES.map(([a, b]) => ({ a: key(P(a)), b: key(P(b)) })) }, "MatchSetupBuilder → games.pairings");
    const groupOrder = usesMatchups ? MATCHES.flat() : ORDER;   // two matches a group, or four in roster order
    if (state.players.length > 4 || state.players.some((p) => p.tee_group == null)) groupOrder.forEach((nm, i) => setTeeGroup(P(nm), i < 4 ? 1 : 2));
  }
  const cols = Object.keys(game).filter((k) => game[k] !== undefined);
  const insertGame = `insert into public.games (${cols.join(", ")}) select ${cols.join(", ")} from jsonb_populate_record(null::public.games, ${q(Object.fromEntries(cols.map((k) => [k, game[k]])))}::jsonb);`;
  const pcols = Array.from(new Set(players.flatMap((p) => Object.keys(p as unknown as Record<string, unknown>))));
  const insertPlayers = `insert into public.game_players (${pcols.join(", ")}) select ${pcols.join(", ")} from jsonb_populate_recordset(null::public.game_players, ${q(players)}::jsonb);`;
  return { id: c.id, gameId: gid, insertGame, insertPlayers, ops, created: { game: Object.fromEntries(cols.map((k) => [k, game[k]])), players: players as unknown as Record<string, unknown>[] }, final: state };
}

export function structureCases(keys: string[]): StructureCase[] {
  return behaviourCases(keys).map((c, i) => structureCase(c, i + 1)).filter((x): x is StructureCase => !!x);
}

/** The database test: set up the organizer, members and club; replay every case as the organizer; compare. */
export const STRUCTURE_GOLDEN_START = "-- GOLDEN-START", STRUCTURE_GOLDEN_END = "-- GOLDEN-END";
export function renderStructureSql(cases: StructureCase[], golden: string): string {
  const names: Record<string, string> = { [ORGANIZER]: "Amit Sud" };
  const people = Object.entries(MEMBER_USERS).map(([k, id]) => ({ id, name: names[id] ?? k }));
  const setup = [
    `insert into auth.users(id, email) values ${people.map((p, i) => `('${p.id}', 'structure${i}@example.test')`).join(", ")};`,
    `insert into public.profiles(id, display_name, account_status) values ${people.map((p) => `('${p.id}', '${p.name}', 'active')`).join(", ")};`,
    `insert into public.groups(id, name, created_by) values ('${CLUB}', 'Structure Baseline Club', '${ORGANIZER}');`,
    `insert into public.group_members(group_id, user_id, email, role, status) values ${people.map((p, i) => `('${CLUB}', '${p.id}', 'structure${i}@example.test', '${p.id === ORGANIZER ? "admin" : "member"}', 'active')`).join(", ")};`,
  ].join("\n");
  const asOrganizer = `perform set_config('request.jwt.claim.sub', '${ORGANIZER}', true); perform set_config('request.jwt.claims', '{"sub":"${ORGANIZER}","role":"authenticated"}', true); execute 'set local role authenticated';`;
  const blocks = cases.map((c) => `-- ${c.id}  (${c.ops.length} calls)
do $$ begin
  ${asOrganizer}
  ${c.insertGame}
  ${c.insertPlayers}
${c.ops.map((o) => `  ${o.sql}  -- ${o.route}`).join("\n")}
  execute 'reset role';
  insert into bnn_structure_state(id, state) select '${c.id.replace(/'/g, "''")}', jsonb_build_object(
    'game', (select jsonb_build_object('teams', teams, 'pairings', pairings, 'foursomes', foursomes, 'allowance_pct', allowance_pct, 'team_score_mode', team_score_mode, 'skins_mode', skins_mode, 'scramble_mode', scramble_mode, 'scramble_team_size', scramble_team_size) from public.games where id = '${c.gameId}'),
    'players', (select jsonb_agg(jsonb_build_object('id', id, 'name', display_name, 'team', team, 'tee_group', tee_group, 'is_marker', is_marker, 'course_handicap', course_handicap) order by display_name) from public.game_players where game_id = '${c.gameId}'));
end $$;`).join("\n\n");
  return `-- assert-structure-behaviour.sql — GENERATED by lib/structure-behaviour.test (212.39, one-step creation phase 1 part 2).
-- Do not edit by hand: regenerate with UPDATE_STRUCTURE_SQL=1 node .testout-screens/lib/structure-behaviour.test.js.
-- What MANAGE GAME saves (teams, matchups, groups) for every format Create can make: each case is created the way Create
-- creates it, then the organizer's choices are saved through the exact calls Manage Game makes — run AS THE ORGANIZER,
-- so permissions and triggers apply as in the app — and what is stored is compared with the golden record below.
-- The one-step flow (phase 3+) must store exactly this. To accept an INTENDED change: run this file with the golden
-- record emptied ('{}'), copy the CAPTURE notice's JSON in, and say why in DEPLOY_NOTES.
begin;
${setup}
create temp table bnn_structure_state(id text primary key, state jsonb) on commit drop;

${blocks}

do $$
declare
  now_state jsonb := (select jsonb_object_agg(id, state) from bnn_structure_state);
  golden jsonb :=
${STRUCTURE_GOLDEN_START}
'${golden.replace(/'/g, "''")}'
${STRUCTURE_GOLDEN_END}
  ;
  bad text;
begin
  if golden = '{}'::jsonb then raise notice 'CAPTURE %', now_state::text; return; end if;
  select string_agg(k, ', ' order by k) into bad from (
    select k from jsonb_object_keys(now_state) k where now_state -> k is distinct from golden -> k
    union select k from jsonb_object_keys(golden) k where not now_state ? k) d;
  if bad is not null then raise exception 'STRUCTURE BEHAVIOUR CHANGED for: %', bad; end if;
  raise notice 'STRUCTURE_BEHAVIOUR_PASS % cases: what Manage Game stores is unchanged', (select count(*) from jsonb_object_keys(now_state));
end $$;
rollback;
`;
}
