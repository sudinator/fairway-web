/** Personal bests (owner, Oct 30: variant C) — the engine, the dashboard card, the celebration in recap and email. */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { personalBests, newBestsOf, beatLine } from "@/lib/personal-bests";
import { PersonalBestsCard } from "@/components/personal-bests-card";
import { pbEmailHtml } from "@/lib/round-email-server";
import type { Round } from "@/lib/golf";

const PAR = [4, 5, 3, 4, 4, 3, 4, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4];
const round = (id: string, playedAt: string, rel: number[], o: Partial<Round> & { putts?: number[] } = {}): Round => ({
  id, course: o.course ?? "Oak Hollow", tee_name: o.tee_name ?? "Blue", rating: 72.3, slope: 133, course_par: rel.length === 9 ? 36 : 72, handicap_index: 14.7, course_handicap: o.course_handicap ?? 16,
  played_at: playedAt, status: "final", game_id: o.game_id ?? null,
  holes: rel.map((r, i) => ({ hole_number: (o.holes?.[0]?.hole_number ?? 1) + i, par: PAR[((o.holes?.[0]?.hole_number ?? 1) - 1 + i) % 18], stroke_index: i + 1, strokes: PAR[((o.holes?.[0]?.hole_number ?? 1) - 1 + i) % 18] + r, putts: o.putts?.[i] ?? null })),
} as unknown as Round);
const now = new Date("2026-10-30T12:00:00Z");
const r1 = round("r1", "2026-07-20", [1, 0, 1, 1, 0, 1, 1, 2, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0], { putts: Array(18).fill(2) });                       // 86 gross · 70 net
const r2 = round("r2", "2026-09-14", [0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1], { course: "Galloping Hill", tee_name: "White", course_handicap: 15 });   // 81 · 66 net
const r3 = round("r3", "2026-10-25", [0, 0, -1, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 1, 1], { putts: [...Array(17).fill(2), 1], game_id: "g-494730" });   // 78 · 62 net · a birdie
const nine = round("n1", "2026-10-28", [0, 0, 0, 1, 0, 0, 1, 0, 0], { holes: [{ hole_number: 10 }] as never });                                           // back nine 38
const inProg = { ...round("ip", "2026-10-29", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), status: "in_progress" } as Round;

const pb = personalBests([r1, r2, r3, nine, inProg], now);
const by = Object.fromEntries(pb.bests.map((b) => [b.key, b]));
ok(pb.rounds === 3 && by.gross?.value === 78 && by.gross.roundId === "r3" && by.gross.prev?.value === 81, `lowest gross 78 (r3), beat 81 (got ${by.gross?.value} prev ${by.gross?.prev?.value}; ${pb.rounds} rounds)`);
ok(by.net?.value === 62 && by.net.prev?.value === 66, `lowest net 62, beat 66 (got ${by.net?.value} / ${by.net?.prev?.value})`);
ok(by.birdies?.value === 1 && by.birdies.roundId === "r3" && by.birdies.prev == null, "most birdies: 1 (r3), the first");
ok(by.putts?.value === 35 && by.putts.roundId === "r3" && by.putts.prev?.value === 36, `fewest putts 35, beat 36 (got ${by.putts?.value} / ${by.putts?.prev?.value})`);
ok(by.nine?.value === 37 || by.nine?.value === 38, `best nine from an 18 or the 9-hole round (got ${by.nine?.value} · ${by.nine?.detail})`);
ok(!pb.bests.some((b) => b.roundId === "ip"), "an in-progress round sets nothing");
ok(by.gross.isNew && !by.points?.isNew === (by.points?.roundId !== "r3"), "a best from the last 30 days is NEW; older ones are not");
ok(pb.newest?.key != null && pb.newest.roundId === "r3", `the newest new best comes from r3 (got ${pb.newest?.key})`);
ok(newBestsOf([r1, r2, r3], "r3").map((b) => b.key).sort().join(",") === ["gross", "net", "birdies", "putts", ...(by.points?.roundId === "r3" ? ["points"] : []), ...(by.streak?.roundId === "r3" ? ["streak"] : []), ...(by.nine?.roundId === "r3" ? ["nine"] : [])].sort().join(","), `the bests r3 set (got ${newBestsOf([r1, r2, r3], "r3").map((b) => b.key).join(",")})`);
ok(beatLine(by.gross) === "beat your 81 by three shots" && beatLine(by.birdies) === "your first", `beat lines (got "${beatLine(by.gross)}" / "${beatLine(by.birdies)}")`);
ok(personalBests([], now).bests.length === 0, "no rounds: no bests");
// ── the card: hero when something is new, rows only otherwise; a best opens its round ──
const opened: string[] = [];
let t = renderScreen(<PersonalBestsCard rounds={[r1, r2, r3, nine]} onOpen={(r) => opened.push(r.id)} now={now} />);
ok(!!t.el.querySelector("[data-pb-hero]") && (t.el.textContent || "").includes("New lowest") && (t.el.textContent || "").includes("beat your"), "card: the hero shows the newest best and what it beat");
(t.el.querySelector("[data-pb-row=net]") as HTMLButtonElement).click();
ok(opened[0] === "r3", `card: tapping a best opens its round (got ${opened[0]})`);
t.unmount();
t = renderScreen(<PersonalBestsCard rounds={[r1, r2]} onOpen={() => {}} now={now} />);
ok(!t.el.querySelector("[data-pb-hero]") && !t.el.querySelector("[data-pb-new]") && t.el.querySelectorAll("[data-pb-row]").length >= 4, "card: nothing new in 30 days — rows only, no NEW tags");
t.unmount();
// ── the email celebration ──
const html = pbEmailHtml(newBestsOf([r1, r2, r3], "r3"));
ok(html.includes("NEW PERSONAL BESTS") && html.includes("Lowest gross") && html.includes("beat your 81"), "email: the recipient's new bests, with what they beat");
ok(pbEmailHtml([]) === "", "email: nothing when no new best");
report("personal bests");
