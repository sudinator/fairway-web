import { buildGamePayload, buildPlayerRows, splitSkinsTooBig, postCreateDestination, postCreateDestinationLabel, gameTypeLabel, type GamePayloadOpts } from "./game-create";

let pass = 0, fail = 0; const fails: string[] = [];
function eq<T>(name: string, got: T, want: T) { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) pass++; else { fail++; fails.push(`${name} (got ${g}, want ${w})`); } }

const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const base: GamePayloadOpts = {
  code: "123456", activeGroupId: "grp", name: "", courseName: "Pine Valley", courseHoles: holes,
  teeYardages: Array(18).fill(400), coursePar: 72, matchDate: "2026-08-07", allowancePct: 100,
  gameType: "stableford", teamMode: false, team1: "", team2: "", skinsTeamStyle: "head_to_head",
  teamScoreMode: "best_ball", trifectaScoring: "per_hole", strokeBasis: "net", skinsMode: "carryover",
  flightsSupported: true, flightMode: "off", flightBands: null,
};

// labels
eq("label stableford", gameTypeLabel("stableford"), "Stableford");
eq("label fourball", gameTypeLabel("fourball"), "Four-Ball");

// payload branches
{
  const p = buildGamePayload(base);
  eq("auto name", p.name.startsWith("Stableford / Pine Valley / "), true);
  eq("teams null (no team mode)", p.teams, null);
  eq("foursomes null", p.foursomes, null);
  eq("team_score_mode default", p.team_score_mode, "best_ball");
  eq("stroke_basis null (not stroke)", p.stroke_basis, null);
  eq("skins_mode null (not skins)", p.skins_mode, null);
  eq("holes yards mapped", p.holes_meta[0].yards, 400);
}
eq("custom name kept", buildGamePayload({ ...base, name: "  My Game  " }).name, "My Game");
eq("teams on match+teamMode", buildGamePayload({ ...base, gameType: "match", teamMode: true, team1: " Reds " }).teams, [{ key: "A", name: "Reds" }, { key: "B", name: "Team 2" }]);
eq("trifecta always teams", buildGamePayload({ ...base, gameType: "trifecta" }).teams?.length, 2);
eq("fourball foursomes []", buildGamePayload({ ...base, gameType: "fourball" }).foursomes, []);
eq("fourball always teams", buildGamePayload({ ...base, gameType: "fourball", teamMode: false }).teams?.length, 2);
eq("alternate shot always teams", buildGamePayload({ ...base, gameType: "alt_shot", teamMode: false }).teams?.length, 2);
eq("alternate shot side game defaults off", (buildGamePayload({ ...base, gameType: "alt_shot" }) as any).leg_config?.scheme, "none");
eq("Ryder Cup session Group Results default off", (buildGamePayload({ ...base, gameType: "fourball", sideContestsEnabled: false }) as any).leg_config?.scheme, "none");
eq("skins bb foursomes []", buildGamePayload({ ...base, gameType: "skins", teamMode: true, skinsTeamStyle: "best_ball" }).foursomes, []);
eq("skins h2h foursomes null", buildGamePayload({ ...base, gameType: "skins", teamMode: true, skinsTeamStyle: "head_to_head" }).foursomes, null);
eq("stroke basis set", buildGamePayload({ ...base, gameType: "stroke", strokeBasis: "gross" }).stroke_basis, "gross");
eq("flights off when unsupported", buildGamePayload({ ...base, flightsSupported: false, flightMode: "oneoff" }).flight_mode, "off");
{
  const bands = [{ key: "A", name: "A", hi: 10 }] as any;
  const p = buildGamePayload({ ...base, flightMode: "oneoff", flightBands: bands });
  eq("flights carried", p.flights, bands);
  eq("no yardages -> null", buildGamePayload({ ...base, teeYardages: null }).holes_meta[3].yards, null);
}

// splitSkinsTooBig
eq("split skins >4 blocked", splitSkinsTooBig("skins", false, "split", 5), true);
eq("split skins 4 ok", splitSkinsTooBig("skins", false, "split", 4), false);
eq("team skins ok", splitSkinsTooBig("skins", true, "split", 9), false);
eq("carryover ok", splitSkinsTooBig("skins", false, "carryover", 9), false);
eq("non-skins ok", splitSkinsTooBig("stableford", false, "split", 9), false);
eq("stableford creates straight to play", postCreateDestination("stableford", false), { roomTab: "play" });
eq("stroke creates straight to play", postCreateDestination("stroke", false), { roomTab: "play" });
eq("individual match hands off to matchups", postCreateDestination("match", false), { roomTab: "setup", setupTab: "matchups" });
eq("team match hands off to teams", postCreateDestination("match", true), { roomTab: "setup", setupTab: "teams" });
eq("fourball hands off to teams even if legacy teamMode false", postCreateDestination("fourball", false), { roomTab: "setup", setupTab: "teams" });
eq("team fourball hands off to teams", postCreateDestination("fourball", true), { roomTab: "setup", setupTab: "teams" });
eq("trifecta hands off to teams", postCreateDestination("trifecta", false), { roomTab: "setup", setupTab: "teams" });
eq("alternate shot hands off to teams", postCreateDestination("alt_shot", false), { roomTab: "setup", setupTab: "teams" });
eq("individual skins hands off to groups", postCreateDestination("skins", false), { roomTab: "setup", setupTab: "groups" });
eq("team skins hands off to teams", postCreateDestination("skins", true), { roomTab: "setup", setupTab: "teams" });

eq("play destination label", postCreateDestinationLabel(postCreateDestination("stableford", false)), "Play");
eq("teams destination label", postCreateDestinationLabel(postCreateDestination("trifecta", false)), "Manage Game → Teams");
eq("matchups destination label", postCreateDestinationLabel(postCreateDestination("match", false)), "Manage Game → Matchups");
eq("groups destination label", postCreateDestinationLabel(postCreateDestination("skins", false)), "Manage Game → Groups");

// buildPlayerRows
const tee = { name: "Blue", rating: 71.0, slope: 130 };
const rosterBase = {
  gameId: "g1", userId: "me", displayName: "Me", idxVal: 10.0 as number | null,
  selectedPlayers: {} as Record<string, boolean>, groupRoster: [] as any[], guestPlayers: [] as any[],
  hcpOverrides: {} as Record<string, number | null>, tee, coursePar: 72, holesCount: 18,
  flightsSupported: true, flightMode: "off", flightBands: null as any,
};
{
  const rows = buildPlayerRows(rosterBase);
  eq("creator auto-included", rows.length, 1);
  eq("creator name", rows[0].display_name, "Me");
  eq("creator ch", rows[0].course_handicap, Math.round(10 * (130 / 113) + (71.0 - 72)));
  eq("creator bets", rows[0].bets, true);
  eq("small field tee_group", (rows[0] as any).tee_group, 1);
  eq("blank scores", rows[0].scores.length, 18);
}
{
  const rows = buildPlayerRows({ ...rosterBase, includeCreator: false });
  eq("Cup organizer can be excluded when not playing", rows.length, 0);
}
{
  const rows = buildPlayerRows({
    ...rosterBase,
    sideContestsEnabled: false,
    guestPlayers: [{ display_name: "Guest", handicap_index: 12, guest_of: "me" }],
  });
  eq("Ryder Cup session opts members out of money side contest", rows.find((r) => !r.is_guest)?.bets, false);
  eq("Ryder Cup session opts guests out of money side contest", rows.find((r) => r.is_guest)?.bets, false);
}
{
  const roster = [
    { id: "me", display_name: "Me", avatar_url: "a.png", handicap_index: 9.9 },
    { id: "p2", display_name: "Bob", avatar_url: null, handicap_index: 18.3 },
    { id: "p3", display_name: "Carl", avatar_url: null, handicap_index: null },
  ];
  const rows = buildPlayerRows({ ...rosterBase, groupRoster: roster, selectedPlayers: { p2: true, p3: true }, hcpOverrides: { p3: 24.0 }, guestPlayers: [{ display_name: "G", handicap_index: 12.0, guest_of: "me" }] });
  eq("all four rows", rows.length, 4);
  eq("creator idxVal wins over roster", rows[0].handicap_index, 10.0);
  eq("override used for p3", rows[2].handicap_index, 24.0);
  eq("guest flags", [rows[3].is_guest, rows[3].bets, (rows[3] as any).guest_of], [true, false, "me"]);
  eq("guest ch", rows[3].course_handicap, Math.round(12 * (130 / 113) + (71.0 - 72)));
  eq("<=4 grouped", rows.every((r) => (r as any).tee_group === 1), true);
}

{
  const rows = buildPlayerRows({ ...rosterBase, tgcBettingEnabled: false, guestPlayers: [{ display_name: "G", handicap_index: 12.0, guest_of: "me" }] });
  eq("non-TGC guest does not inherit TGC no-bet default", rows.find((r) => r.is_guest)?.bets, true);
}
{
  const roster = Array.from({ length: 5 }, (_, i) => ({ id: "p" + i, display_name: "P" + i, avatar_url: null, handicap_index: 10 }));
  const sel: Record<string, boolean> = {}; roster.forEach((r) => (sel[r.id] = true));
  const rows = buildPlayerRows({ ...rosterBase, userId: "p0", groupRoster: roster, selectedPlayers: sel });
  eq("5+ ungrouped", rows.some((r) => (r as any).tee_group != null), false);
}
{
  const bands = [{ key: "A", name: "A", hi: 12 }, { key: "B", name: "B", hi: null }] as any;
  const rows = buildPlayerRows({ ...rosterBase, flightMode: "oneoff", flightBands: bands });
  eq("flight assigned", rows[0].flight, "A");
}

{
  const tees = [tee, { name: "White", rating: 69.0, slope: 120 }, { name: "Red", rating: 67.0, slope: 112 }];
  const bands = [{ key: "A", name: "Flight A", hi: 12 }, { key: "B", name: "Flight B", hi: null }] as any;
  const roster = [
    { id: "me", display_name: "Me", avatar_url: null, handicap_index: 10 },
    { id: "p2", display_name: "Bob", avatar_url: null, handicap_index: 18 },
  ];
  const rows = buildPlayerRows({ ...rosterBase, groupRoster: roster, selectedPlayers: { p2: true }, tees, defaultTeeIdx: 0,
    flightMode: "oneoff", flightBands: bands, flightTeeIdx: { B: 1 }, playerTeeOverrides: { me: 2 } });
  eq("player tee override wins", rows.find((r) => r.user_id === "me")?.tee_name, "Red");
  eq("flight tee wins over default", rows.find((r) => r.user_id === "p2")?.tee_name, "White");
  eq("override CH uses override tee", rows.find((r) => r.user_id === "me")?.course_handicap, Math.round(10 * (112 / 113) + (67 - 72)));
}
{
  const tees = [tee, { name: "White", rating: 69.0, slope: 120 }];
  const rows = buildPlayerRows({ ...rosterBase, tees, defaultTeeIdx: 0, guestPlayers: [{ id: "guest-1", display_name: "G", handicap_index: 12, guest_of: "me" }], playerTeeOverrides: { "guest-1": 1 } });
  eq("guest override persisted", rows.find((r) => r.is_guest)?.tee_name, "White");
}

console.log(`game-create: ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
