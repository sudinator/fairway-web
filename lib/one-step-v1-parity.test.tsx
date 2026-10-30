/**
 * 212.66 — THE v1.0 PARITY CHECK (owner, Oct 28: "When we started this project we took a snapshot of what the existing
 * workflow and output looked like and the goal was to compare this to the new workflow and output … This cannot be messed up").
 * For EVERY golden scenario (ci/golden/create-behaviour.json — v1.0's Create step; ci/assert-structure-behaviour.sql — v1.0's
 * Manage Game structure step): seed the REAL Create screen with the scenario (its format, the golden course and roster,
 * and the golden line-up choices: RED v BLUE, groups 1 and 2, the four matchups, first drivers, the trifecta swap, scramble
 * teams in roster order), press the real Create game button, and compare what it SENDS, field by field, with what v1.0
 * stored. Any difference fails, naming the scenario and the field.
 */
import * as fs from "fs";
import * as path from "path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import * as React from "react";
import { ok, report } from "./screen-harness";
import { CreateGame } from "@/components/tournaments";
import { saveSetupDraft } from "@/lib/setup-draft";
import { BEHAVIOUR_COURSE, BEHAVIOUR_CREATOR, BEHAVIOUR_ROSTER, BEHAVIOUR_GUESTS, BEHAVIOUR_CUP_EXTRA, behaviourCases, sessionTeams, type CreateCase } from "@/lib/create-behaviour";
import { replayFormatKey, reachableFormatKeys } from "@/lib/create-game-format";

const ROOT = process.cwd();
const golden = JSON.parse(fs.readFileSync(path.join(ROOT, "ci/golden/create-behaviour.json"), "utf8")) as { id: string; key: string; blocked: string | null; game: Record<string, unknown>; players: Record<string, unknown>[]; destination: unknown }[];
const sql = fs.readFileSync(path.join(ROOT, "ci/assert-structure-behaviour.sql"), "utf8");
const gs = sql.slice(sql.indexOf("-- GOLDEN-START") + "-- GOLDEN-START\n".length, sql.indexOf("-- GOLDEN-END")).trim();
const structure = JSON.parse(gs.slice(1, gs.lastIndexOf("'")).replace(/''/g, "'")) as Record<string, { game: Record<string, unknown>; players: { id: string; name: string; team: string | null; tee_group: number | null }[] }>;

// ── the golden course and roster, served to the screen the way the app's server would ──
const GROUP = "club-1";   // the golden record's club
const COURSE = { id: "c1", data: { id: "c1", name: BEHAVIOUR_COURSE.name, location: "", holes: BEHAVIOUR_COURSE.holes, tees: BEHAVIOUR_COURSE.tees.map((t) => ({ ...t, par: BEHAVIOUR_COURSE.par })) } };
const ROSTER = [...BEHAVIOUR_ROSTER, BEHAVIOUR_CUP_EXTRA].map((m) => ({ ...m, avatar_url: null }));   // the eighth member plays only in Cup sessions
const createBodies: Record<string, unknown>[] = [];
const linkCalls: { url: string; body: Record<string, unknown> }[] = [];   // 212.68: the session link, as v1.0 made it
(globalThis as { fetch: unknown }).fetch = async (input: string | URL, init?: { body?: string }) => {
  const url = String(input); const body = init?.body ? JSON.parse(init.body) : null;
  if (url.includes("/rpc/create_game_complete")) createBodies.push(body);
  if (url.includes("/rest/v1/competition_sessions") && init && (init as { method?: string }).method === "PATCH") { linkCalls.push({ url, body }); return new Response(JSON.stringify({ id: "sess-1" }), { status: 200, headers: { "content-type": "application/json" } }); }
  const json = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { "content-type": "application/json", "content-range": "0-99/*" } });
  if (url.includes("/rest/v1/group_courses")) return json([{ course_id: "c1" }]);
  if (url.includes("/rest/v1/favorite_courses")) return json([COURSE]);
  if (url.includes("/rpc/group_roster")) return json(ROSTER);
  if (url.includes("/rpc/create_game_complete")) return json("11111111-1111-1111-1111-111111111111");
  if (url.includes("/rpc/set_game_share")) return json(null);
  return json([]);
};
const ME = { id: BEHAVIOUR_CREATOR.id };
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const clickText = async (el: HTMLElement, text: string, sel = "button") => {
  const all = [...el.querySelectorAll(sel)];
  const t = (all.find((b) => (b.textContent || "").replace(/^[0-9]+/, "").trim() === text) ?? all.find((b) => (b.textContent || "").trim().includes(text))) as HTMLElement | undefined;
  if (!t) throw new Error(`no ${sel} with "${text}" — screen says: ${(el.textContent || "").slice(0, 400)}`);
  await act(async () => { t.click(); }); await flush(3);
};

// ── the golden line-up choices (lib/structure-behaviour), keyed to the screen's fixed player ids ──
const RED = ["Amit Sud", "Raj Mehta", "Nihar Shah", "Karan Patel"], BLUE = ["Sam Lee", "Vikram Rao", "Bo Li", "Guest Kumar", "Dev Kapoor"];   // Dev Kapoor: sessions only
const ORDER = [...RED, ...BLUE];
const MATCHES: [string, string][] = [["Amit Sud", "Sam Lee"], ["Raj Mehta", "Vikram Rao"], ["Nihar Shah", "Bo Li"], ["Karan Patel", "Guest Kumar"], ["Karan Patel", "Dev Kapoor"]];
const uuid = (n: number) => `22660000-0000-0000-0000-${String(n).padStart(12, "0")}`;

function seed(c: CreateCase) {
  const f = replayFormatKey(c.key, { matchLength: c.matchLength, scrambleTeamSize: c.scrambleTeamSize });
  const roster = c.session ? [...BEHAVIOUR_ROSTER, BEHAVIOUR_CUP_EXTRA] : BEHAVIOUR_ROSTER.slice(0, c.members ?? BEHAVIOUR_ROSTER.length), guests = c.session ? [] : BEHAVIOUR_GUESTS.slice(0, c.guests ?? BEHAVIOUR_GUESTS.length);
  const people: { name: string; idKey: string; pkey: string }[] = [{ name: BEHAVIOUR_CREATOR.display_name, idKey: `u:${BEHAVIOUR_CREATOR.id}`, pkey: BEHAVIOUR_CREATOR.id },
    ...roster.map((m) => ({ name: m.display_name ?? "", idKey: `u:${m.id}`, pkey: m.id })),
    ...guests.map((g) => ({ name: g.display_name, idKey: `g:${g.id}`, pkey: "" }))];
  const ids: Record<string, string> = {}; people.forEach((p, i) => { ids[p.idKey] = uuid(i + 1); });
  const rowId = (name: string): string => ids[people.find((p) => p.name === name)!.idKey];
  const pk = (name: string) => { const p = people.find((x) => x.name === name)!; return p.pkey || ids[p.idKey]; };   // pkey: user id, or the row id for a guest
  const present = (names: string[]) => names.filter((n) => people.some((p) => p.name === n));
  const gt = f.gameType, hasTeams = f.teamMode || gt === "fourball" || gt === "trifecta" || gt === "alt_shot";
  const draft: Record<string, unknown> = {
    // a session: the Cup's name and team names, and the creator ticked (as the Cup's seed does)
    name: c.session ? `${c.session.cupName} · ${c.session.sessionName}` : "", matchDate: "2026-10-24", teeIdx: 0, idxStr: String(BEHAVIOUR_CREATOR.handicap_index), favName: BEHAVIOUR_COURSE.name,
    gameType: gt, allowancePct: f.allowancePct, matchLength: f.matchLength, teamScoreMode: f.teamScoreMode, strokeBasis: f.strokeBasis, fmtFamily: f.fmtFamily,
    matchKind: f.matchKind ?? "ind", teamMode: c.session ? true : f.teamMode, skinsTeamStyle: f.skinsTeamStyle, skinsMode: f.skinsMode, team1: c.session?.teams.A ?? "", team2: c.session?.teams.B ?? "",
    scrambleTeamSize: f.scrambleTeamSize ?? 4, scrambleHandicap: f.scrambleHandicap ?? "usga", scrambleMinDrives: f.scrambleMinDrives ?? null, scrambleAllowance: null,
    flightMode: "off", createSection: "review",
    selectedPlayers: Object.fromEntries([...(c.session ? [BEHAVIOUR_CREATOR] : []), ...roster].map((m) => [m.id, true])), guestPlayers: guests.map((g) => ({ ...g })),
  };
  const team: Record<string, string | null> = {}, group: Record<string, number | null> = {};
  let foursomes: unknown[] | null = null, pairings: { a: string; b: string }[] | undefined;
  if (gt === "scramble") {
    const size = c.scrambleTeamSize ?? 4, field = f.fmtFamily !== "match";   // a scramble under Match play is the "match" scramble
    const chunks = (names: string[], k: number) => Array.from({ length: Math.ceil(names.length / k) }, (_, i) => names.slice(i * k, i * k + k));
    const groups = field
      ? chunks(present(ORDER), size).map((t, i) => ({ id: `team-${i + 1}`, name: `Team ${i + 1}`, a: t.map(pk), b: [] }))
      : Array.from({ length: size === 4 ? 1 : 2 }, (_, i) => ({ id: `match-${i + 1}`, name: `Match ${i + 1}`, a: chunks(present(RED), size)[i].map(pk), b: chunks(present(BLUE), size)[i].map(pk) }));
    draft.oneStepTeams = { groups, ids };
    return { draft, f, people };
  }
  if (hasTeams) present(ORDER).forEach((nm, i) => { team[rowId(nm)] = i < 4 ? "A" : "B"; });
  const twoVtwo = gt === "fourball" || gt === "trifecta" || gt === "alt_shot" || (gt === "skins" && f.teamMode && f.skinsTeamStyle === "best_ball");
  if (twoVtwo) {
    [["Amit Sud", 1], ["Raj Mehta", 1], ["Sam Lee", 1], ["Vikram Rao", 1], ["Nihar Shah", 2], ["Karan Patel", 2], ["Bo Li", 2], ["Guest Kumar", 2], ["Dev Kapoor", 2]].forEach(([nm, g]) => { if (present([nm as string]).length) group[rowId(nm as string)] = g as number; });
    const fsm = (id: string, name: string, a: string[], b: string[]) => ({ id, name, a: present(a).map(pk), b: present(b).map(pk) });   // a session has no guest
    foursomes = gt === "skins"
      ? [fsm("fs-1", "Foursome 1", ["Amit Sud", "Raj Mehta"], ["Sam Lee", "Vikram Rao"]), fsm("fs-2", "Foursome 2", ["Nihar Shah", "Karan Patel"], ["Bo Li", "Guest Kumar", "Dev Kapoor"])]
      : [fsm("group-1", "Group 1", ["Amit Sud", "Raj Mehta"], ["Sam Lee", "Vikram Rao"]), fsm("group-2", "Group 2", ["Nihar Shah", "Karan Patel"], ["Bo Li", "Guest Kumar", "Dev Kapoor"])];
    if (gt === "alt_shot") foursomes = (foursomes as { a: string[]; b: string[] }[]).map((x) => ({ ...x, a_first: x.a[0], b_first: x.b[0] }));
    if (gt === "trifecta") foursomes = (foursomes as Record<string, unknown>[]).map((x, i) => (i === 1 ? { ...x, swap: true } : x));
  } else {
    const usesMatchups = gt === "match" || (gt === "skins" && f.teamMode);
    if (usesMatchups) pairings = MATCHES.filter(([a, b]) => present([a, b]).length === 2).map(([a, b]) => ({ a: pk(a), b: pk(b) }));
    const order = usesMatchups ? MATCHES.flat() : ORDER;
    present(order).forEach((nm, i) => { group[rowId(nm)] = i < 4 ? 1 : 2; });   // v1.0's record grouped every field this way, four or fewer included
  }
  draft.oneStepLineup = { team, group, foursomes, pairings, ids };
  return { draft, f, people };
}

const cases = behaviourCases(reachableFormatKeys());   // 212.68: Ryder Cup sessions included, driven with the Cup's seed
(async () => {
  for (const c of cases) {
    const g = golden.find((x) => x.id === c.id);
    if (!g) { ok(false, `${c.id}: no golden record`); continue; }
    window.localStorage.clear();
    const { draft, f, people } = seed(c);
    saveSetupDraft(GROUP, c.session ? `cup-${c.session.competitionId}-1` : null, draft as never);   // a session keeps its draft under its own key
    const e = document.createElement("div"); document.body.appendChild(e);
    const r = createRoot(e);
    const cupSeed = c.session ? {
      playDate: "2026-10-24", course: null, memberIds: [BEHAVIOUR_CREATOR.id, ...BEHAVIOUR_ROSTER.map((m) => m.id), BEHAVIOUR_CUP_EXTRA.id], guests: [],
      name: `${c.session.cupName} · ${c.session.sessionName}`, gameType: c.session.format, teamNames: c.session.teams, participantTeams: sessionTeams(),
      competitionSession: { sessionId: c.session.sessionId, competitionId: c.session.competitionId, name: c.session.sessionName, sessionOrder: 1, format: c.session.format, scrambleTeamSize: c.session.scrambleTeamSize, playDate: "2026-10-24", pointsPerMatch: 1 },
    } : undefined;
    await act(async () => { r.render(<CreateGame user={ME} displayName={BEHAVIOUR_CREATOR.display_name} activeGroupId={GROUP} seed={cupSeed as never} onCancel={() => {}} onCreated={() => {}} />); });
    await flush();
    const txt = () => e.textContent || "";
    if (txt().includes("Resume")) await clickText(e, "Resume");
    if (g.blocked) {   // v1.0 refused this scenario (split skins with too many players): v2.0 must refuse it too, and save nothing
      if (!txt().includes("Create game")) await clickText(e, "Review");
      const before = createBodies.length;
      await clickText(e, "Create game");
      ok(txt().includes(g.blocked) && createBodies.length === before, `${c.id}: refused as in v1.0 ("${g.blocked.slice(0, 40)}…"), nothing saved — screen: ${txt().slice(0, 120)}`);
      r.unmount(); continue;
    }
    // walk through the line-up step as an organizer would (its effects — e.g. the scramble suggestion — run on a visit), then Review
    const stepName = ["Teams", "Matchups", "Groups"].find((nm) => [...e.querySelectorAll("button")].some((x) => (x.textContent || "").replace(/^[0-9]+/, "").trim() === nm));
    if (stepName) { await clickText(e, stepName); await flush(4); }
    await clickText(e, "Review");
    const before = createBodies.length;
    await clickText(e, "Create game");
    const b = createBodies[before] as { p_game?: Record<string, unknown>; p_players?: Record<string, unknown>[]; p_teams?: { player: string; team: string }[]; p_groups?: { player: string; group: number }[]; p_foursomes?: Record<string, unknown>[] | null } | undefined;
    if (!b) { ok(false, `${c.id}: the screen made no create call (screen says: ${txt().slice(0, 300)})`); r.unmount(); continue; }
    // ── 1. the game row, every column v1.0 stored (its random code and id aside; the structures are compared below) ──
    const skip = new Set(["id", "code", "pairings", "foursomes"]);
    const diffs: string[] = [];
    for (const k of Object.keys(g.game)) { if (skip.has(k)) continue; if (JSON.stringify(b.p_game?.[k]) !== JSON.stringify(g.game[k])) diffs.push(`game.${k}: v1.0 ${JSON.stringify(g.game[k])} → v2.0 ${JSON.stringify(b.p_game?.[k])}`); }
    for (const k of Object.keys(b.p_game ?? {})) { if (!skip.has(k) && !(k in g.game) && b.p_game?.[k] != null) diffs.push(`game.${k}: v2.0 adds ${JSON.stringify(b.p_game?.[k])}`); }
    // ── 2. every player row ──
    const byName = (rows: Record<string, unknown>[]) => Object.fromEntries(rows.map((p) => [p.display_name as string, p]));
    const teamOfRow = new Map((b.p_teams ?? []).map((t) => [t.player, t.team]));
    const gp = byName(g.players), vp = byName((b.p_players ?? []).map((row) => ({ ...row, team: teamOfRow.get(row.id as string) ?? (row.team as string | null | undefined) ?? null })));
    for (const nm of Object.keys(gp)) {
      if (!vp[nm]) { diffs.push(`player ${nm}: missing`); continue; }
      for (const k of Object.keys(gp[nm])) { if (["game_id", "id"].includes(k)) continue; if (JSON.stringify(vp[nm][k]) !== JSON.stringify(gp[nm][k])) diffs.push(`player ${nm}.${k}: v1.0 ${JSON.stringify(gp[nm][k])} → v2.0 ${JSON.stringify(vp[nm][k])}`); }
    }
    for (const nm of Object.keys(vp)) if (!gp[nm]) diffs.push(`player ${nm}: v2.0 adds`);
    // ── 3. the structures: teams, groups, foursomes, matchups — against v1.0's Manage Game record, by player name ──
    const st = structure[c.id];
    if (st) {
      // the structure record keys members by user id (…a0, …a1 …) and guests by row id; its rows are …0000, …0001 … in the same order
      const stName = (id: string): string => { const m = /a([0-9])$/.exec(id); const tail = m ? `00000000000${m[1]}` : null; return st.players.find((p) => p.id === id || (tail != null && p.id.endsWith(tail)))?.name ?? id; };
      const rowName = (rowIdOrKey: string): string => { const p = people.find((x) => (x.pkey || "") === rowIdOrKey); if (p) return p.name as string; const row = (b.p_players ?? []).find((x) => x.id === rowIdOrKey); return (row?.display_name as string | undefined) ?? rowIdOrKey; };
      const v1Teams = Object.fromEntries(st.players.map((p) => [p.name, p.team ?? null])), v2Teams = Object.fromEntries(Object.keys(gp).map((nm) => [nm, null as string | null]));
      (b.p_teams ?? []).forEach((t) => { v2Teams[rowName(t.player)] = t.team; });
      const v1Groups = Object.fromEntries(st.players.map((p) => [p.name, p.tee_group ?? null])), v2Groups = Object.fromEntries(Object.keys(gp).map((nm) => [nm, null as number | null]));
      (b.p_groups ?? []).forEach((x) => { v2Groups[rowName(x.player)] = x.group; });
      for (const nm of Object.keys(v1Teams)) { if (v1Teams[nm] !== (v2Teams[nm] ?? null)) diffs.push(`team of ${nm}: v1.0 ${v1Teams[nm]} → v2.0 ${v2Teams[nm]}`); if (v1Groups[nm] !== (v2Groups[nm] ?? null)) diffs.push(`group of ${nm}: v1.0 ${v1Groups[nm]} → v2.0 ${v2Groups[nm]}`); }
      const norm4 = (fsx: unknown, nameOf: (id: string) => string) => JSON.stringify(((fsx as Record<string, unknown>[] | null) ?? []).map((x) => ({ a: (x.a as string[]).map(nameOf), b: (x.b as string[]).map(nameOf), a_first: x.a_first ? nameOf(x.a_first as string) : undefined, b_first: x.b_first ? nameOf(x.b_first as string) : undefined, swap: x.swap ?? undefined })));
      const v1F = norm4(st.game.foursomes, stName), v2F = norm4(b.p_foursomes ?? (b.p_game?.foursomes as unknown), rowName);
      if (v1F !== v2F) diffs.push(`foursomes: v1.0 ${v1F} → v2.0 ${v2F}`);
      const normP = (pr: unknown, nameOf: (id: string) => string) => JSON.stringify(((pr as { a: string; b: string }[] | null) ?? []).map((x) => [nameOf(x.a), nameOf(x.b)]));
      const v1P = normP(st.game.pairings, stName), v2P = normP(b.p_game?.pairings, rowName);
      if (v1P !== v2P) diffs.push(`matchups: v1.0 ${v1P} → v2.0 ${v2P}`);
    }
    // ── 4. a session: the link to the session, exactly as v1.0 made it (only if the session is still unlinked) ──
    const gl = (g as { link?: { where: Record<string, unknown>; set: Record<string, unknown> } }).link;
    if (gl) {
      const lc = linkCalls[linkCalls.length - 1];
      const q = lc ? new URL(lc.url).searchParams : null;
      if (!lc || q?.get("id") !== `eq.${gl.where.id}` || q?.get("competition_id") !== `eq.${gl.where.competition_id}` || q?.get("game_id") !== "is.null" || typeof lc.body?.game_id !== "string")
        diffs.push(`session link: v1.0 ${JSON.stringify(gl)} → v2.0 ${lc ? `${new URL(lc.url).search} ${JSON.stringify(lc.body)}` : "no link call"}`);
    } else if (linkCalls.length) diffs.push("a session link was made for a club game");
    linkCalls.length = 0;
    ok(diffs.length === 0, `${c.id} (${f.gameType}${f.teamMode ? " · team" : ""}): v2.0's Create sends what v1.0 stored${diffs.length ? `\n      - ${diffs.join("\n      - ")}` : ""}`);
    r.unmount();
  }
  report("v1.0 parity");
})();
