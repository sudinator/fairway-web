function ok(c: unknown, m: string) { if (!c) throw new Error(m); }
function eq(a: unknown, b: unknown, m: string) { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
import { buildRoundEmail } from "./round-email";
import type { Hole } from "./golf";
// 209.2: the round-summary email.
const pars = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 5, 3, 4, 4, 5, 3, 4, 4];
const strokes = [5, 6, 3, 4, 5, 7, 4, 5, 7, 4, 4, 3, 5, 5, 6, 4, 5, 5];
const holes = (withPutts: number): Hole[] => pars.map((par, i) => ({ hole_number: i + 1, par, stroke_index: i + 1, strokes: strokes[i],
  putts: i < withPutts ? 2 : null, fairway: par >= 4 ? (i % 2 ? "hit" : "left") : null, penalties: i === 5 ? 1 : 0, sand: i === 8 })) as Hole[];
const base = { round: { id: "r", course: "Oak & Hollow", tee_name: "White", played_at: "2026-10-18", course_handicap: 14 }, firstName: "Amit",
  appUrl: "https://x", recapUrl: "https://x/r", unsubscribeUrl: "https://x/u" };
const game = { name: "Saturday Four-Ball", headline: "Red beat Blue 4½–3½", position: { rank: 2, of: 16 }, standoutBetter: 2.4, fieldNote: "on a course that played 2 shots hard" };

const e = buildRoundEmail({ ...base, holes: holes(18), game });
eq(e.subject, "Your round at Oak & Hollow — 87 (net 73), 2nd of 16", "subject carries the result and position");
ok(e.html.includes("Oak &amp; Hollow") && !e.html.includes("Oak & Hollow at"), "course name is escaped in the HTML");
ok(e.html.includes("GREENS ·") && e.html.includes("PUTTS ·") && e.html.includes("PUTTS PER GREEN HIT") && e.html.includes("SCRAMBLES") && e.html.includes("SAND SAVES"), "full stats when putts are recorded");
ok(e.html.includes("FAIRWAYS ·"), "fairways when recorded");
ok(e.html.includes("AVG ON PAR 3s · PAR 4s · PAR 5s"), "scoring by hole type");
ok(e.html.includes("<b>Standout round</b> — 2.4 better than the field"), "the standout line");
ok(e.html.includes("border:1.5px solid #B83A2E;border-radius:50%"), "a birdie gets the app's red circle");
ok(e.html.includes("border:1.5px solid #2E5AB8;border-radius:6px"), "a bogey gets the app's blue square");
ok(e.html.includes("Turn off round summaries") && e.html.includes("https://x/u"), "one-click turn-off link");

const few = buildRoundEmail({ ...base, holes: holes(10) });
ok(!few.html.includes("GREENS ·") && !few.html.includes("PUTTS PER GREEN HIT") && !few.html.includes("SCRAMBLES"), "no putting stats from putts on only 10 holes");
ok(few.html.includes("AVG ON PAR"), "scoring by hole type still shown — it needs only scores");
eq(few.subject, "Your round at Oak & Hollow — 87 (net 73)", "a solo round has no position");

const upd = buildRoundEmail({ ...base, holes: holes(18), game, isUpdate: true });
ok(upd.subject.startsWith("Updated: ") && upd.html.includes("UPDATED ·"), "an update says so");
const corrected = holes(18); corrected[1] = { ...corrected[1], strokes: 5 };
ok(buildRoundEmail({ ...base, holes: corrected, game }).fingerprint !== e.fingerprint, "a score correction changes the fingerprint");
eq(buildRoundEmail({ ...base, holes: holes(18), game }).fingerprint, e.fingerprint, "the same round gives the same fingerprint");
// Owner (Oct 2026): a game round shows the GROUP's recap first, then the member's own round.
const withGroup = buildRoundEmail({ ...base, holes: holes(18), game: { ...game, groupHtml: "<div>HOW THE FIELD PLAYED · group block</div>", sub: "6 of 10 singles went to the 18th" } });
ok(withGroup.html.includes("RED BEAT BLUE") || withGroup.html.includes("Red beat Blue 4½–3½"), "the banner carries the group's result");
ok(withGroup.html.indexOf("group block") > 0 && withGroup.html.indexOf("group block") < withGroup.html.indexOf("YOUR ROUND"), "the group comes first, then YOUR ROUND");
ok(withGroup.html.indexOf("YOUR ROUND") < withGroup.html.indexOf("ROUND STATS") && withGroup.html.indexOf("ROUND STATS") < withGroup.html.indexOf("YOUR SCORECARD"), "then the member's stats and scorecard");
console.log("round-email tests passed");
