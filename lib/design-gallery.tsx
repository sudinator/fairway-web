/**
 * 212.16 — DESIGN GALLERY (owner, Oct 22: "these are basic design choices that you should be proactively looking to
 * implement"). Renders the screens built recently with realistic sample data to HTML, one file per screen, for
 * scripts/design-gallery.mjs to photograph at phone width (390px). Every new or changed screen gets a gallery entry
 * and is reviewed as a member would see it before it ships (HANDOFF.md). Not a test — it has no assertions.
 *   node .testout-screens/lib/design-gallery.js <outDir>
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as fs from "fs";
import * as path from "path";
import type { Game, Player } from "@/lib/game-types";
import { ScrambleTeamsBuilder } from "@/components/game/scramble-teams-builder";
import { ScrambleSettings } from "@/components/game/scramble-settings";
import { GroupScorecard, TeamGroupsBuilder } from "@/components/game/scorecard-views";
import { ScrambleView } from "@/components/game/scramble-view";
import { RecapBody } from "@/components/game/recap-body";
import { ScrambleLineupCard } from "@/components/game/scramble-lineup";
import { TeamRoundsList } from "@/components/rounds-list";
import { SeasonCardView } from "@/components/season-story";
import { buildRecap } from "@/lib/game-recap";
import { teamRoundEmail } from "@/lib/team-round-email";
import { InsightsCard, InsightsScreen } from "@/components/insights";
import { YourCourses, CourseDetail } from "@/components/your-courses";
import { IndivSegmentChoice } from "@/components/game/segment-views";
import { SaveTraceToggle } from "@/components/save-trace-view";
import { StorageMeter } from "@/components/storage-meter";
import { CreateGameWorkspace } from "@/components/game/setup/create-game-workspace";
import { PlayerCountHint, OneStepReview, DraftBanner, ShareLinks } from "@/components/game/setup/one-step";
import { createSectionsFor, SECTION_LABEL, playerCountHint } from "@/lib/one-step-create";
import { balanceScrambleTeams, scrambleTeeGroups } from "@/lib/scramble-teams";
import { pkey as galleryPkey, chBasis } from "@/lib/game-shape";
import { SkinsView } from "@/components/game/scoring-views";
import { computeInsights } from "@/lib/insights";
import { yourCourses } from "@/lib/your-courses";
import { round as mkRound, PARS as RP, SIS as RS } from "@/lib/test-fixtures/messy-rounds";

const outDir = process.argv[2] || "/tmp/design-gallery";
fs.mkdirSync(outDir, { recursive: true });

const PAR = [4, 5, 3, 4, 4, 3, 4, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4], SI = [7, 3, 17, 1, 11, 15, 5, 9, 13, 8, 2, 18, 4, 12, 6, 16, 10, 14];
const holes = PAR.map((p, i) => ({ n: i + 1, par: p, si: SI[i], yards: 340 + (i * 23) % 120 }));
const NAMES = ["Raj Mehta", "Nihar Shah", "Karan Patel", "Sam Lee", "Amit Sud", "Vikram Rao", "Probir Das", "Harsh Parikh", "Ashutosh Jain", "Jigar Shukla", "Vimal Joshi", "Dev Kapoor"];
const CH = [4.2, 9.8, 14.6, 22.4, 6.1, 11.3, 16.9, 24.8, 3.4, 12.2, 18.5, 27.0];
const players = (team?: (i: number) => "A" | "B") => NAMES.map((n, i) => ({ id: `u${i}`, user_id: `u${i}`, display_name: n, course_handicap: CH[i], course_handicap_source: "manual", handicap_index: CH[i] * 0.9, scores: [], no_show: false, tee_group: Math.floor(i / 4) + 1, team: team ? team(i) : null } as unknown as Player));
const base = { id: "g", code: "109487", name: "Saturday Scramble", course: "Oak Hollow", holes_meta: holes, course_par: 72, played_at: "2026-10-25", created_by: "u0", status: "active", scramble_handicap: "usga" };
const field = (extra: Record<string, unknown> = {}) => ({ ...base, game_type: "scramble", scramble_mode: "field", scramble_team_size: null,
  foursomes: [0, 1, 2].map((t) => ({ id: `t${t + 1}`, name: `Team ${t + 1}`, a: [0, 1, 2, 3].map((k) => `u${t * 4 + k}`), b: [] })), ...extra } as unknown as Game);
const match = (extra: Record<string, unknown> = {}) => ({ ...base, game_type: "scramble", scramble_mode: "match", scramble_team_size: 2, scramble_min_drives: 3,
  teams: [{ key: "A", name: "Reds" }, { key: "B", name: "Blues" }], foursomes: [{ id: "m1", name: "Match 1", a: ["u0", "u1"], b: ["u2", "u3"] }, { id: "m2", name: "Match 2", a: ["u4", "u5"], b: ["u6", "u7"] }], ...extra } as unknown as Game);
const S = [[4, 4, 3, 3, 4, 3, 4, 4, 4, 3, 4, 3, 4, 4, 3, 3, 4, 4], [4, 4, 2, 4, 3, 3, 4, 5, 3, 4, 3, 3, 4, 3, 4, 2, 4, 4], [3, 4, 3, 3, 4, 2, 4, 4, 4, 4, 4, 2, 4, 4, 4, null, null, null]];
const fieldRows = S.flatMap((arr, t) => arr.map((s, i) => ({ game_id: "g", foursome_id: `t${t + 1}`, side: "a", hole_index: i, strokes: s })).filter((r) => r.strokes != null));
const matchRows = ["m1", "m2"].flatMap((fid, mi) => (["a", "b"] as const).flatMap((side, si) => S[(mi + si) % 2].slice(0, 14).map((s, i) => ({ game_id: "g", foursome_id: fid, side, hole_index: i, strokes: s, drive_key: `u${mi * 4 + si * 2 + (i % 2)}` }))));
const noop = () => {};
const page = (inner: string, light = false) => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:${light ? "#e9ede9" : "#0A2A20"};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;width:390px"><div style="padding:12px">${inner}</div></body></html>`;
const shots: Record<string, string> = {};
const add = (name: string, node: React.ReactElement, light = false) => { shots[name] = page(renderToStaticMarkup(node), light); };

// setup
add("01-teams-usga", <ScrambleTeamsBuilder game={field({ foursomes: [{ id: "t1", name: "Team 1", a: ["u0", "u1", "u2", "u3"], b: [] }, { id: "t2", name: "Team 2", a: ["u4", "u5", "u6"], b: [] }] })} players={players()} readOnly={false} onSave={noop} />);
add("02-teams-captains-agreed", <ScrambleTeamsBuilder game={field({ scramble_team_size: 1, scramble_handicap: "agreed", foursomes: [0, 1, 2, 3].map((t) => ({ id: `c${t}`, name: `Team ${t + 1}`, a: [`u${t}`], b: [], ...(t < 2 ? { a_hcp: 6 + t * 3 } : {}) })) })} players={players().slice(0, 5)} readOnly={false} onSave={noop} />);
add("03-format-settings", <ScrambleSettings game={field({ scramble_allowance: { "4": [30, 20, 15, 10] } })} locked={false} onSave={noop} />);
add("04-cup-groups", <TeamGroupsBuilder game={match({ scramble_team_size: 3 }) as never} players={players((i) => (i % 2 ? "B" : "A")).slice(0, 10).map((p, i) => ({ ...p, tee_group: i < 4 ? 1 : null })) as never}
  onSetTeamGroupSlot={async () => {}} onRandomize={async () => {}} onBalanceMatchups={async () => {}} canRandomize randomizeReason="" randomizing={false} />);
// play
const four = players().slice(0, 4);
add("05-scorecard-team", <GroupScorecard game={field({ foursomes: [{ id: "t1", name: "Team 1", a: ["u0", "u1", "u2", "u3"], b: [] }] })} players={four} allPlayers={four} user={{ id: "u0" } as never} isMarker markerName={null} onTakeOver={noop} onRelease={noop} onSetHole={noop} altShotScores={fieldRows.filter((r) => r.foursome_id === "t1").slice(0, 12) as never} />);
const mp = players((i) => (i % 4 < 2 ? "A" : "B")).slice(0, 4);
add("06-scorecard-match", <GroupScorecard game={match({ foursomes: [{ id: "m1", name: "Match 1", a: ["u0", "u1"], b: ["u2", "u3"] }] })} players={mp} allPlayers={mp} user={{ id: "u0" } as never} isMarker markerName={null} onTakeOver={noop} onRelease={noop} onSetHole={noop} altShotScores={matchRows.filter((r) => r.foursome_id === "m1") as never} />);
add("07-leaderboard-live", <ScrambleView game={field()} players={players()} altShotScores={fieldRows as never} />);
add("08-matches-live", <ScrambleView game={match()} players={players((i) => (i % 4 < 2 ? "A" : "B"))} altShotScores={matchRows as never} />);
// after
const ended = field({ status: "ended" });
add("09-recap-final", <RecapBody game={ended} recap={buildRecap(ended, players(), fieldRows as never)} mode="share" />);
const endedM = match({ status: "ended" });
add("10-recap-matches", <RecapBody game={endedM} recap={buildRecap(endedM, players((i) => (i % 4 < 2 ? "A" : "B")), matchRows as never)} mode="share" />);
add("11-lineup", <ScrambleLineupCard game={field()} players={players()} />);
// 212.33 (owner, staging game 386503): a no-show keeps their team place — listed below the players, marked in the team,
// named by the setup check; the line-up card marks them too (its team handicap matches scoring's)
const noShowGame = field({ foursomes: [{ id: "t1", name: "Team 1", a: ["u2", "u4"], b: [] }, { id: "t2", name: "Team 2", a: ["u5", "u0"], b: [] }, { id: "t3", name: "Team 3", a: ["u1", "u3"], b: [] }] });
const noShowPlayers = players().slice(0, 6).map((p) => (p.user_id === "u2" ? { ...p, no_show: true } : p));
add("11b-teams-noshow", <ScrambleTeamsBuilder game={noShowGame} players={noShowPlayers} readOnly={false} onSave={noop} />);
add("11c-lineup-noshow", <ScrambleLineupCard game={noShowGame} players={noShowPlayers} />);
// 212.34 (owner): small teams share a tee group — one card, one scorer. Teams of 2 pair up; captains one each, combinable.
const pairsGame = field({ scramble_team_size: 2, foursomes: [0, 1, 2].map((t) => ({ id: `t${t + 1}`, name: `Team ${t + 1}`, a: [`u${t * 2}`, `u${t * 2 + 1}`], b: [] })) });
add("11d-teams-groups-pairs", <ScrambleTeamsBuilder game={pairsGame} players={players().slice(0, 6).map((p, i) => ({ ...p, tee_group: i < 4 ? 1 : 2 }))} readOnly={false} onSave={noop} />);
const capsGame = field({ scramble_team_size: 1, scramble_handicap: "agreed", foursomes: [0, 1, 2, 3].map((t) => ({ id: `c${t}`, name: `Team ${t + 1}`, a: [`u${t}`], b: [], tee: t < 2 ? 1 : t })) });
add("11e-teams-groups-captains", <ScrambleTeamsBuilder game={capsGame} players={players().slice(0, 4).map((p, i) => ({ ...p, tee_group: i < 2 ? 1 : i }))} readOnly={false} onSave={noop} />);
// 212.35: 1:1 team skins with ties halved — a tied hole reads "Halved · ½ each" (it used to carry regardless)
{
  const sc = [[4, 4, 5, 4, 3, 5], [5, 4, 4, 4, 4, 5], [4, 5, 4, 3, 4, 4], [4, 4, 4, 5, 4, 4]];
  const sk = players((i) => (i % 2 ? "B" : "A")).slice(0, 4).map((p, i) => ({ ...p, scores: [...sc[i], ...Array(12).fill(null)] }));
  const skGame = { ...base, game_type: "skins", skins_mode: "split", foursomes: null, teams: [{ key: "A", name: "Reds" }, { key: "B", name: "Blues" }],
    pairings: [{ a: "u0", b: "u1" }, { a: "u2", b: "u3" }], status: "active" } as unknown as Game;
// 212.41 — ONE-STEP CREATE (phase 3, scramble first), for the owner's approval: Format before Players, a Teams step
// inside Create, a Review that saves everything at once. The draft has no saved rows yet; the Teams step opens on balanced
// teams (teams of 2 pair into foursomes, 212.34) that the organizer can change.
{
  const steps = (active: "players" | "teams" | "review", child: React.ReactNode, teamsDone = true) => (
    <CreateGameWorkspace activeSection={active} onSectionChange={noop}
      sections={createSectionsFor("scramble").map((k) => ({ key: k, label: SECTION_LABEL[k], done: k === "game" || k === "format" || (k === "players" && active !== "players") || (k === "teams" && active === "review" && teamsDone) }))}>
      {child}
    </CreateGameWorkspace>
  );
  const draftPlayers = players().slice(0, 8).map((p) => ({ ...p, tee_group: null, team: null }));
  const draftGame = field({ scramble_team_size: 2, foursomes: [] });
  const balanced = balanceScrambleTeams(draftPlayers.map((p) => ({ key: galleryPkey(p), ch: Number(chBasis(p as Player, 72) ?? 0) })), 2, "field") ?? [];
  const tee = scrambleTeeGroups(balanced, "field", false);
  const withGroups = draftPlayers.map((p) => { const t = balanced.find((g) => g.a.includes(galleryPkey(p)) || g.b.includes(galleryPkey(p))); return { ...p, tee_group: t ? tee.get(t.id) ?? null : null }; });
  add("14a-create-players-hint", steps("players", <div>
    <PlayerCountHint hint={playerCountHint("scramble", { players: 8 })} />
  </div>));
  add("14b-create-teams-step", steps("teams", <ScrambleTeamsBuilder game={{ ...draftGame, foursomes: balanced } as Game} players={withGroups as Player[]} readOnly={false} onSave={noop} />));
  const lines = [
    { ok: true, label: "Course", value: "Oak Hollow · Blue tees" }, { ok: true, label: "Date", value: "Sun, Oct 25" },
    { ok: true, label: "Format", value: "Scramble · Leaderboard · teams of 2" }, { ok: true, label: "Players", value: "8" },
    { ok: true, label: "Teams", value: "4 teams of 2" }, { ok: true, label: "Groups", value: "2 groups — Teams 1+2, Teams 3+4" },
  ];
  add("14c-create-review-ready", steps("review", <OneStepReview lines={lines} problem={null} busy={false} onCreate={noop} onCreateLater={noop} onCancel={noop} />));
  add("14d-create-review-blocked", steps("review", <OneStepReview lines={lines.map((l) => (l.label === "Teams" ? { ok: false, label: "Teams", value: "Karan Patel isn't on a team" } : l))}
    problem="Put every player on a team before creating the game — or create now and finish later." busy={false} onCreate={noop} onCreateLater={noop} onCancel={noop} />, false));
  add("14e-manage-game-draft", <div><DraftBanner onSend={async () => {}} /><div style={{ color: "#B8CFC4", fontSize: 12 }}>(the rest of Manage Game, as today — the line-up link is offered once the game is sent)</div></div>);
  // 212.41 (owner, Oct 25): Manage Game → Review — the two share links, one switch; only once the game is created
  add("14f-review-share-off", <div style={{ background: "#1B5A46", borderRadius: 12, padding: 14 }}><ShareLinks lineupToken={null} liveToken={null} onShare={async () => {}} /></div>);
  add("14g-review-share-on", <div style={{ background: "#1B5A46", borderRadius: 12, padding: 14 }}><ShareLinks lineupToken="oak-hollow-oct25-ab12cd" liveToken="k3J9xQ2mP7vL0aB4" onShare={async () => {}} /></div>);
}
  add("12-skins-11-halved", <SkinsView game={skGame} players={sk as Player[]} user={{ id: "u0" }} isCreator mode="view" onChanged={noop} />);
}
// 212.37: individual skins, ties halved, three players — tied holes split three ways, printed ⅓ ⅔ (were "0" and "½")
{
  const th = players().slice(0, 3).map((p, i) => ({ ...p, course_handicap: 0, handicap_index: 0, scores: [i === 0 ? 3 : 4, 4, 4, 4, i === 1 ? 3 : 4, 4, ...Array(12).fill(null)] }));
  const thGame = { ...base, game_type: "skins", skins_mode: "split", foursomes: null, teams: null, pairings: [], status: "active" } as unknown as Game;
  add("12b-skins-thirds", <SkinsView game={thGame} players={th as Player[]} user={{ id: "u0" }} isCreator mode="view" onChanged={noop} />);
}
add("12-team-rounds", <TeamRoundsList items={[
  { gameId: "a", date: "2026-10-25", course: "Oak Hollow", format: "scramble", team: "Team 2", holes: 18, result: "1st of 3" },
  { gameId: "b", date: "2026-10-11", course: "Fairmount CC", format: "scramble", team: "Reds", holes: 18, result: "Reds won 2&1" },
  { gameId: "c", date: "2026-09-20", course: "Hanover", format: "alt_shot", team: "with Raj Mehta", holes: 14, result: null },
]} onOpenGame={noop} />);
add("13-season-headline", <SeasonCardView card={{ kind: "headline", rounds: 27, holes: 462, hours: null, courses: 9, teamRounds: 3 } as never} name="Amit" year={2026} />);
const rc = buildRecap(ended, players(), fieldRows as never);
shots["14-team-round-email"] = teamRoundEmail({ format: "scramble", course: "Oak Hollow", recap: rc, personalLine: rc.personal["u4"] ?? null, firstName: "Amit", gameUrl: "https://example.com/?tab=games&game=109487", unsubscribeUrl: "https://example.com/u" }).html;

// 212.18 — Insights and Your courses: a realistic season (bogeys on the hardest holes, a double or two, a strong finish)
const seasonRounds = Array.from({ length: 16 }, (_, k) => mkRound(`r${k}`, `2026-${String(4 + Math.floor(k / 3)).padStart(2, "0")}-${String(3 + (k % 3) * 9).padStart(2, "0")}`,
  RP.map((p, i) => p + (RS[i] <= 6 ? (k % 3 === 0 && i === 3 ? 3 : 1) : RS[i] >= 13 ? 0 : (i + k) % 4 === 0 ? 1 : 0) - (i >= 15 && k % 2 === 0 ? 1 : 0)),
  { course: k % 4 === 0 ? "Fairmount CC" : "Oak Hollow" }, (i) => ({ putts: (i + k) % 7 === 0 ? 3 : 2 })));
add("15-insights-card", <InsightsCard rounds={seasonRounds} />);
add("16-insights-card-new", <InsightsCard rounds={seasonRounds.slice(0, 3)} />);
add("17-insights-screen", <InsightsScreen ins={computeInsights(seasonRounds)} onClose={noop} />);
add("18-your-courses", <YourCourses rounds={seasonRounds} loadField={async () => null} />);
const oakRec = yourCourses(seasonRounds).find((c) => c.key === "oak hollow")!;
add("19-course-detail", <div style={{ background: "#1B5A46", borderRadius: 12, paddingTop: 12 }}><CourseDetail c={oakRec} loadField={async () => null}
  initialField={{ enough: true, rounds: 41, holes: oakRec.holes.map((h) => ({ hole: h.hole, par: h.par, avg_to_par: Math.round((h.hole === 4 ? 0.9 : h.hole === 13 ? 1.6 : h.avgToPar * 0.8 + 0.3) * 10) / 10 })) }} /></div>);

// 212.21 — a stroke-play group on two tees: each tee's yardage on every hole
{
  const tees = [{ name: "Blue", rating: 72.4, slope: 131, par: 72, yardages: holes.map((h) => (h.yards as number) + 25) },
                { name: "White", rating: 70.1, slope: 125, par: 72, yardages: holes.map((h) => h.yards as number) }];
  const grp = players().slice(0, 4).map((p, i) => ({ ...p, tee_name: i < 2 ? "Blue" : "White", tee_group: 1, scores: [4, 5, 3, 4, 4, null, null, null, null, null, null, null, null, null, null, null, null, null] })) as never;
  add("20-scorecard-mixed-tees", <GroupScorecard game={{ ...base, game_type: "stroke", stroke_basis: "net" } as unknown as Game} players={grp} allPlayers={grp} user={{ id: "u0" } as never} isMarker markerName={null} onTakeOver={noop} onRelease={noop} onSetHole={noop} courseTees={tees as never} />);
}

// 212.24 — the segment choice for an individual game, and for a TGC money game
add("21-segment-choice", <div><IndivSegmentChoice game={{ ...base, game_type: "stableford", leg_config: { scheme: "nines", metric: "pts", points: {} } } as unknown as Game} moneyGame={false} onSave={noop} />
  <IndivSegmentChoice game={{ ...base, game_type: "stableford" } as unknown as Game} moneyGame onSave={noop} /></div>);

// 212.27 — the score-save trace switch (Admin → Diagnostics)
add("22-save-trace-toggle", <SaveTraceToggle />);

// 212.28 — Admin → Diagnostics: phone storage
add("23-storage-meter", <StorageMeter sample={{ bytes: 1_310_000, items: 214, kinds: [{ label: "Score backups", bytes: 620_000 }, { label: "Game copies for offline use", bytes: 410_000 }, { label: "Recovery archive", bytes: 180_000 }, { label: "Settings & other", bytes: 100_000 }] }} />);

for (const [name, html] of Object.entries(shots)) fs.writeFileSync(path.join(outDir, `${name}.html`), html);
console.log(`design gallery: ${Object.keys(shots).length} screens → ${outDir}`);
