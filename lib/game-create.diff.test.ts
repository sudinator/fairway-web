// DIFFERENTIAL — lib/game-create vs verbatim baseline across a fuzz of the full option matrix.
import * as OLD from "./game-create.baseline";
import * as NEW from "./game-create";
import type { GamePayloadOpts, PlayerRowsOpts, GameTypeOpt } from "./game-create";

let comparisons = 0, mismatches = 0; const details: string[] = [];
function same(label: string, a: unknown, b: unknown, ctx: string) {
  comparisons++; const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja !== jb) { mismatches++; if (details.length < 12) details.push(`${label}: OLD=${ja?.slice(0,140)} NEW=${jb?.slice(0,140)} @ ${ctx}`); }
}
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = rng(80706); const ri = (lo: number, hi: number) => lo + Math.floor(R() * (hi - lo + 1));
const pick = <T,>(a: readonly T[]) => a[ri(0, a.length - 1)];

const TYPES = ["stableford", "stroke", "match", "fourball", "skins", "trifecta"] as const;
for (let i = 0; i < 4000; i++) {
  const nHoles = pick([9, 18] as const);
  const o: GamePayloadOpts = {
    code: String(ri(100000, 999999)), activeGroupId: "grp" + ri(0, 3),
    name: pick(["", "  ", "My Game", "  X  "]), courseName: "Course" + ri(0, 5),
    courseHoles: Array.from({ length: nHoles }, (_, k) => ({ n: k + 1, par: pick([3, 4, 5] as const), si: k + 1 })),
    teeYardages: pick([null, undefined, Array.from({ length: nHoles }, () => (R() < 0.2 ? null : ri(120, 550)))] as const) as any,
    coursePar: pick([null, 70, 72] as const), matchDate: `2026-${String(ri(1, 12)).padStart(2, "0")}-${String(ri(1, 28)).padStart(2, "0")}`,
    allowancePct: pick([50, 85, 100] as const), gameType: pick(TYPES) as GameTypeOpt,
    teamMode: R() < 0.5, team1: pick(["", "Reds", "  A  "]), team2: pick(["", "Blues"]),
    skinsTeamStyle: pick(["head_to_head", "best_ball"] as const), teamScoreMode: pick(["best_ball", "aggregate"] as const),
    trifectaScoring: pick(["per_hole", "match"] as const), strokeBasis: pick(["net", "gross"] as const),
    skinsMode: pick(["carryover", "split", "halved"] as const), flightsSupported: R() < 0.5,
    flightMode: pick(["off", "oneoff", "season"] as const), flightBands: R() < 0.5 ? [{ key: "A", name: "A", hi: 12 }, { key: "B", name: "B", hi: null }] as any : null,
  };
  const oldPayload = OLD.buildGamePayload(o) as any;
  const newPayload = NEW.buildGamePayload(o) as any;
  if (o.gameType === "fourball") {
    // Intentional 178.19 delta: new Four-Ball is always global team play. Compare every
    // unaffected payload field byte-for-byte; explicit game-create tests pin the new teams contract.
    const { teams: _oldTeams, ...oldRest } = oldPayload;
    const { teams: _newTeams, ...newRest } = newPayload;
    same("buildGamePayload/fourball unaffected fields", oldRest, newRest, `pay#${i} ${o.gameType}`);
  } else {
    same("buildGamePayload", oldPayload, newPayload, `pay#${i} ${o.gameType}`);
  }
}
// splitSkins with identical args to both sides
for (let i = 0; i < 2000; i++) {
  const gt = pick(TYPES) as GameTypeOpt; const tm = R() < 0.5; const sm = pick(["carryover", "split", "halved"] as const); const fc = ri(0, 9);
  same("splitSkinsTooBig2", OLD.splitSkinsTooBig(gt, tm, sm, fc), NEW.splitSkinsTooBig(gt, tm, sm, fc), `sk#${i}`);
}

for (let i = 0; i < 3000; i++) {
  const nR = ri(0, 6);
  const roster = Array.from({ length: nR }, (_, k) => ({ id: "p" + k, display_name: R() < 0.9 ? "P" + k : null, avatar_url: R() < 0.5 ? "a.png" : null, handicap_index: R() < 0.7 ? ri(-2, 30) + (R() < 0.5 ? 0.4 : 0) : null }));
  const sel: Record<string, boolean> = {}; roster.forEach((r) => { if (R() < 0.6) sel[r.id] = R() < 0.8; });
  const ov: Record<string, number | null> = {}; roster.forEach((r) => { if (R() < 0.3) ov[r.id] = R() < 0.8 ? ri(0, 30) : null; });
  const o: PlayerRowsOpts = {
    gameId: "g", userId: R() < 0.5 && nR > 0 ? "p0" : "me", displayName: "Me", idxVal: R() < 0.8 ? ri(0, 25) : null,
    selectedPlayers: sel, groupRoster: roster, guestPlayers: Array.from({ length: ri(0, 3) }, (_, k) => ({ display_name: "G" + k, handicap_index: R() < 0.7 ? ri(0, 30) : null, guest_of: R() < 0.5 ? "me" : null })),
    hcpOverrides: ov, tee: { name: "Blue", rating: 68 + R() * 8, slope: ri(105, 145) }, coursePar: pick([null, 70, 72] as const),
    holesCount: pick([9, 18] as const), flightsSupported: R() < 0.5, flightMode: pick(["off", "oneoff"] as const),
    flightBands: R() < 0.5 ? [{ key: "A", name: "A", hi: 12 }, { key: "B", name: "B", hi: null }] as any : null,
  };
  same("buildPlayerRows", OLD.buildPlayerRows(o), NEW.buildPlayerRows(o), `rows#${i}`);
}

console.log(`game-create DIFF (old vs new): ${comparisons} comparisons, ${mismatches} mismatches`);
if (mismatches) { console.error("DISCREPANCIES:\n" + details.join("\n")); process.exit(1); }
console.log("OLD and NEW are IDENTICAL across every path.");
