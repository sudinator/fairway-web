function eq(a: unknown, b: unknown, m: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
import { parseAppLink } from "./app-links";
// 210.10 — the links the app understands.
const club = "3f6c1a2e-8a4b-4c1d-9e2f-0a1b2c3d4e5f";
eq(parseAppLink(`/?tab=groups&club=${club}`), { tab: "groups", club, game: null, teeTime: null, wrapped: null }, "an approved club: open Clubs WITH that club");
eq(parseAppLink(`/?club=${club}`).tab, "groups", "club= alone also opens Clubs");
eq(parseAppLink("/?tab=manage&manage=groups"), { tab: null, club: null, game: null, teeTime: null, wrapped: null }, "the old link (0195 / 0199) is NOT understood — the reported bug");
eq(parseAppLink("/?tab=groups&club=not-an-id").club, null, "a malformed club id is ignored");
eq(parseAppLink("/?game=123456").game, "123456", "a game link still works");
eq(parseAppLink("/?tt=abc").teeTime, "abc", "a tee-time link still works");
eq(parseAppLink("/?wrapped=2026").wrapped, 2026, "a Season Wrapped link still works");
eq(parseAppLink(null).tab, null, "no link: nothing");
console.log("app-links tests passed");
