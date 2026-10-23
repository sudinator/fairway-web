/**
 * RENDERED CHECK — the live line-up page view and the per-group card, mounted for real with the 90%
 * Trifecta fixture. Asserts the text a player reads; writes both renders to .testout-screens/ so
 * they can be looked at before shipping (201.0).
 */
import { renderScreen, ok, report } from "./screen-harness";
import { scrambleLineupText } from "@/components/game/scramble-lineup";
import * as React from "react";
import { ShareLineupModal } from "@/components/share-card";
import { LiveLineupView } from "@/components/lineup-view";
import { writeFileSync, mkdirSync } from "node:fs";

const H = Array.from({ length: 18 }, (_, i) => ({ n: i + 1 }));
const P = (id: string, name: string, ch: number, idx: number, team: string, tee = "Blue") =>
  ({ id, user_id: id, display_name: name, course_handicap: ch, handicap_index: idx, team, tee_name: tee, scores: [] });
const base = {
  id: "g1", code: "LNUP", name: "Saturday Trifecta", course: "Essex County Country Club", played_at: "Sat Oct 11", game_type: "trifecta",
  allowance_pct: 90, course_par: 72, holes_meta: H, status: "active",
  teams: [{ key: "A", name: "Reds" }, { key: "B", name: "Blues" }],
  foursomes: [
    { id: "f1", name: "Group 1", a: ["u1", "u3"], b: ["u2", "u4"], swap: false },
    { id: "f2", name: "Group 2", a: ["u5", "u7"], b: ["u6", "u8"], swap: false },
  ],
};
const players = [
  P("u1", "Amit Sud", 15, 16.1, "A"), P("u2", "Bob Jones", 6, 7.0, "B"), P("u3", "Carl Diaz", 10, 11.4, "A"), P("u4", "Dan Lee", 12, 13.0, "B", "White"),
  P("u5", "Ed Park", 9, 10.2, "A"), P("u6", "Finn Roy", 18, 19.5, "B"), P("u7", "Gus Hale", 4, 4.8, "A"), P("u8", "Hal Ortiz", 22, 23.9, "B", "White"),
];
const tees = [{ name: "Blue", rating: 71.2, slope: 134, par: 72 }, { name: "White", rating: 69.0, slope: 130, par: 72 }];

mkdirSync(".testout-screens", { recursive: true });
const wrap = (title: string, note: string, html: string) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>${title}</title>` +
  `<style>:root{box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;background:#0E3B2E;padding:24px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;display:flex;flex-direction:column;align-items:center;gap:14px}.note{color:#CFC9B4;font-size:13px;max-width:402px;line-height:1.5}</style>` +
  `<body><div class="note"><b style="color:#C9A227">${title}</b> — ${note}</div><div style="width:402px;max-width:100%">${html}</div></body>`;

// 1. The live page (as the chat link opens it), with the payload get_live_lineup returns.
{
  const payload = { ...base, ended: false, players, course_tees: tees, as_of: "2026-10-11T11:30:00Z" };
  const s = renderScreen(<LiveLineupView data={payload} err={null} />);
  const t = s.text;
  ok(t.includes("Blue tees · 71.2 / 134") && t.includes("White tees · 69 / 130"), "page: tees with rating/slope");
  ok(t.includes("90% allowance — Playing Handicap = Course Handicap × 0.9, rounded (.5 up)"), "page: allowance rule");
  ok(t.includes("GROUP 1") && t.includes("GROUP 2") && t.indexOf("GROUP 1") < t.indexOf("GROUP 2"), "page: grouped by foursome, in the game's order");
  ok(t.includes("Singles vs Bob Jones — you get 9 strokes"), "page: Amit's single");
  ok(t.includes("Four-ball with Carl Diaz vs Bob Jones & Dan Lee — you get 9 strokes"), "page: Amit's team leg");
  ok(t.includes("Singles vs Amit Sud — you give 9 strokes"), "page: Bob gives");
  ok(t.includes("Tap for the handicap arithmetic") && !t.includes("× 90% = 13.7") && !t.includes("× 90% = 13.5"), "page: arithmetic collapsed by default");
  ok(!s.html.includes("border-left: 6px solid") && s.html.includes("background: rgb(") , "page: team shown as a tinted band, not side bars");
  ok((s.html.match(/data-arith-toggle/g) || []).length === 8, "page: the toggle is a real button on every row");
  // Tapping the BUTTON opens the arithmetic; the name is not a tap target.
  s.click("Tap for the handicap arithmetic");
  ok(s.text.includes("Hide the handicap arithmetic") && s.text.includes("→ plays off"), "page: tapping the text/chevron control reveals the arithmetic");
  ok(t.includes("Live line-up · updates as the organizer changes it"), "page: says it is live");
  ok((s.html.match(/data-lineup-row/g) || []).length === 8, "page: eight players rendered");
  ok(s.html.includes('data-open-app="navigate"') && s.html.includes('href="/?game=LNUP"'), "page (other platforms): the button deep-links to the game");
  ok(s.html.includes('class="live-scroll"'), "page: owns its scroll container (html/body are locked for the installed app)");
}
// 1b. iPhone in Safari: the button is an instruction, not a navigation that would open a second app.
{
  const payload = { ...base, ended: false, players, course_tees: tees };
  const s = renderScreen(<LiveLineupView data={payload} err={null} platform="ios-browser" />);
  ok(s.html.includes('data-open-app="ios-instruction"'), "page (iOS Safari): instruction button");
  ok(s.text.includes("Open the Birdie Num Num app from your Home Screen") && s.text.includes("this game is code LNUP"), "page (iOS Safari): tells the user what actually works");
  ok(!s.html.includes('data-open-app="navigate"'), "page (iOS Safari): no navigating button");
  writeFileSync(".testout-screens/lineup-page.html", wrap("Live line-up page (201.0)", "the real LiveLineupView mounted with the payload get_live_lineup returns: 8 players, two foursomes, 90% Trifecta. Rows expand on tap in the app; here they are collapsed as a visitor first sees them.", s.el.innerHTML));
}
// 2. Ended game: the link goes dark.
{
  const s = renderScreen(<LiveLineupView data={{ ended: true, name: "Saturday Trifecta" }} err={null} />);
  ok(s.text.includes("This game has finished, so the line-up is no longer shown."), "ended: no line-up shown");
  ok(s.html.includes('data-open-app='), "ended: still offers the app");
  ok(!s.text.includes("Amit"), "ended: no player data");
}
// 3. The per-group card in the share modal: Group 1 only, link control on top.
{
  const s = renderScreen(<ShareLineupModal game={base} players={players} courseTees={tees} currentUserId="u1"
    linkControl={<div data-link-control>Live line-up link (control rendered by the caller)</div>} onClose={() => {}} />);
  const t = s.text;
  ok(t.includes("LINE-UP · GROUP 1"), "card: titled with the group");
  ok(t.includes("Group 1 (you)") && t.includes("Group 2"), "card: group picker, own group marked");
  ok((s.html.match(/data-lineup-row/g) || []).length === 4, "card: one foursome, four rows");
  ok(t.includes("Index 16.1 → Course Handicap 15 × 90% = 13.5 → plays off 14"), "card: arithmetic shown in full");
  ok(t.includes("Share this group"), "card: share button is per group");
  ok(s.html.includes("data-link-control"), "card: link control rendered above the card");
  ok(!t.includes("\\u00b7") && !t.includes("\\u2014"), "no literal escapes");
  const card = s.el.querySelector("[data-lineup-row]")?.parentElement as HTMLElement | null;
  if (card) writeFileSync(".testout-screens/lineup-group-card.html", wrap("Per-group card (201.0)", "the real ShareLineupModal's image card for Group 1 — what 'Share this group' exports. One foursome per image.", card.outerHTML));
}
// 212.4 — a SCRAMBLE line-up: BY TEAM, each player's own handicap as an INPUT (index → course hcp), and the METHOD
// with its working; the share card shows the same card, and its text says the same.
{
  const holes = Array.from({ length: 18 }, (_, k) => ({ n: k + 1, par: 4, si: k + 1 }));
  const mk = (id: string, name: string, idx: number, ch: number) => ({ id, user_id: id, display_name: name, course_handicap: ch, course_handicap_source: "manual", handicap_index: idx, no_show: false });
  const payload: any = {
    ended: false, id: "g", code: "1", name: "Saturday Scramble", course: "Oak", played_on: "2026-10-25", game_type: "scramble", status: "active", course_par: 72, holes_meta: holes,
    scramble_mode: "field", scramble_handicap: "usga", scramble_allowance: null, scramble_team_size: null,
    foursomes: [{ id: "t1", name: "Team 1", a: ["p4", "p1", "p2", "p3"], b: [] }, { id: "t2", name: "Team 2", a: ["p5", "p6"], b: [] }],
    players: [mk("p1", "Raj", 3.8, 4.2), mk("p2", "Nihar", 8.9, 9.8), mk("p3", "Karan", 13.1, 14.6), mk("p4", "Sam", 20.2, 22.4), mk("p5", "Amit", 5.5, 6.1), mk("p6", "Vikram", 10.2, 11.3)],
  };
  const sc = renderScreen(<LiveLineupView data={payload} err={null} />);
  const txt = sc.el.textContent || "";
  ok(sc.el.querySelectorAll("[data-lineup-team]").length === 2 && txt.includes("Team 1") && txt.includes("Team 2"), "by team: two team cards");
  // 212.16: aligned columns — Index · Course · % · Counts — under a heading row
  ok(txt.includes("IndexCourse%Counts"), `the column headings (${txt.slice(0, 300)})`);
  ok(txt.includes("Raj3.84.2") && txt.includes("Sam20.222.4"), "each player's own handicap as an input: index, then course handicap");
  ok(txt.includes("Raj3.84.225%1.1") && txt.includes("Sam20.222.410%2.2"), "the USGA working per player, lowest first");
  ok(txt.includes("1.1 + 2.0 + 2.2 + 2.2 = 7.44 → 7"), "the sum line to the team handicap");
  ok(txt.includes("teams of 2: 35 / 15%") && txt.includes("teams of 4: 25 / 20 / 15 / 10%"), "the method, with the percentages actually used for each team size");
  ok(!txt.includes("PLAYING HCP") && !txt.includes("COURSE HCP"), "no individual playing-handicap layout");
  sc.unmount();
  const ag = renderScreen(<LiveLineupView data={{ ...payload, scramble_handicap: "agreed", foursomes: [{ ...payload.foursomes[0], a_hcp: 9 }, payload.foursomes[1]] }} err={null} />);
  const at = ag.el.textContent || "";
  ok(at.includes("Agreed handicaps") && at.includes("Agreed team handicap: 9") && at.includes("Raj3.84.2") && !at.includes("Counts"), "agreed: the agreed number, players' handicaps for reference (no percentages)");
  ag.unmount();
  const share = renderScreen(<ShareLineupModal game={{ ...payload, played_at: payload.played_on }} players={payload.players} onClose={() => {}} />);
  const st = share.el.textContent || "";
  ok(st.includes("TEAMS") && st.includes("1.1 + 2.0 + 2.2 + 2.2 = 7.44 → 7") && !st.includes("GROUP CARD"), "the share card shows the same team line-up, not the group card");
  share.unmount();
  const text = scrambleLineupText({ ...payload } as never, payload.players as never);
  ok(text.includes("Team 1 — team handicap 7") && text.includes("Raj: index 3.8 → course hcp 4.2 × 25% = 1.1"), `copy-as-text says the same (${text.slice(0, 200)})`);
}
report("lineup renders");
