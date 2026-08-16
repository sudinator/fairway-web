import { resolveCreateGameTee, sanitizeTeeIndexMap, teeSourceLabel } from "./game-tee-assignment";

let pass = 0;
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) throw new Error(`${name}: got ${g}, want ${w}`);
  pass++;
}
const tees = [
  { name: "Blue", rating: 72, slope: 130 },
  { name: "White", rating: 70, slope: 122 },
  { name: "Red", rating: 68, slope: 115 },
];
const bands = [{ key: "A", name: "Flight A", hi: 10 }, { key: "B", name: "Flight B", hi: null }];

eq("game default", resolveCreateGameTee({ participantKey: "p1", handicapIndex: 8, tees, defaultTeeIdx: 0 })?.tee.name, "Blue");
eq("flight wins over game", resolveCreateGameTee({ participantKey: "p1", handicapIndex: 18, tees, defaultTeeIdx: 0, flightMode: "oneoff", flightBands: bands, flightTeeIdx: { B: 1 } })?.tee.name, "White");
eq("player wins over flight", resolveCreateGameTee({ participantKey: "p1", handicapIndex: 18, tees, defaultTeeIdx: 0, playerTeeOverrides: { p1: 2 }, flightMode: "oneoff", flightBands: bands, flightTeeIdx: { B: 1 } })?.tee.name, "Red");
eq("player source", resolveCreateGameTee({ participantKey: "p1", handicapIndex: 18, tees, defaultTeeIdx: 0, playerTeeOverrides: { p1: 2 }, flightMode: "oneoff", flightBands: bands, flightTeeIdx: { B: 1 } })?.source, "player");
eq("flight source", resolveCreateGameTee({ participantKey: "p1", handicapIndex: 18, tees, defaultTeeIdx: 0, flightMode: "oneoff", flightBands: bands, flightTeeIdx: { B: 1 } })?.source, "flight");
eq("fallback invalid default", resolveCreateGameTee({ participantKey: "p1", handicapIndex: null, tees, defaultTeeIdx: 99 })?.tee.name, "Blue");
eq("invalid override ignored", resolveCreateGameTee({ participantKey: "p1", handicapIndex: null, tees, defaultTeeIdx: 1, playerTeeOverrides: { p1: 99 } })?.tee.name, "White");
eq("no tees", resolveCreateGameTee({ participantKey: "p1", handicapIndex: null, tees: [], defaultTeeIdx: 0 }), null);
eq("source label player", teeSourceLabel("player", null), "Player override");
eq("source label flight", teeSourceLabel("flight", "B"), "Flight B");
eq("sanitize", sanitizeTeeIndexMap({ a: 0, b: 3, c: -1, d: 2 }, 3), { a: 0, d: 2 });

// Model the core product rule across a broad matrix: explicit player choice always wins;
// otherwise a configured flight tee wins; otherwise the field default wins.
for (let i = 0; i < 5000; i++) {
  const idx = i % 31;
  const flight = idx <= 10 ? "A" : "B";
  const playerOverride: Record<string, number> = i % 4 === 0 ? { p: 2 } : {};
  const flightMap: Record<string, number> = i % 3 === 0 ? { A: 1, B: 1 } : {};
  const got = resolveCreateGameTee({ participantKey: "p", handicapIndex: idx, tees, defaultTeeIdx: 0, playerTeeOverrides: playerOverride, flightMode: "oneoff", flightBands: bands, flightTeeIdx: flightMap });
  const want = playerOverride.p != null ? 2 : flightMap[flight as "A" | "B"] != null ? 1 : 0;
  eq(`precedence ${i}`, got?.teeIdx, want);
}

console.log(`game-tee-assignment: ${pass}/${pass} assertions passed`);
