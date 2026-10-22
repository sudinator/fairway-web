// The game recap as an email section (209.2). Owner (Oct 2026): a game round's summary email shows the
// GROUP's recap first — the same sections, in the same order, as the recap card (209.0) — then the member's
// own round. Built only from the shared recap data (lib/game-recap → Highlights + RecapSections); the wording
// of "how the field played" mirrors components/game/recap-body word for word, and
// lib/round-email-recap.test.tsx renders both from the same game and checks they read the same.
import type { Recap } from "@/lib/game-recap";
import { fmtPoints } from "@/lib/game-results";
import type { CupLine } from "@/lib/cup-standing";
import { shortenedNote } from "@/lib/round-rules";
import { scrambleRowValue } from "@/lib/scramble-game";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const sgn = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;

/** The "how the field played" lines, as plain text — identical to the recap card's lines. */
export function fieldLines(r: Recap): string[] {
  const h = r.highlights, s = r.sections, out: string[] = [];
  if (s.individualStats && (h.fieldNet != null || h.frontBack)) {
    const fb = h.frontBack ? (Math.abs(h.frontBack.front - h.frontBack.back) < 0.05 ? "even front and back"
      : `${h.frontBack.back < h.frontBack.front ? "back" : "front"} nine ${Math.abs(h.frontBack.front - h.frontBack.back).toFixed(1)} better`) : null;
    out.push([h.fieldNet != null ? `Field average net ${h.fieldNet.toFixed(1)}` : null, fb].filter(Boolean).join(" · "));
  }
  if (h.toughest) out.push(`Toughest: Hole ${h.toughest.n} · par ${h.toughest.par}${h.toughest.si ? `, stroke index ${h.toughest.si}` : ""} · field averaged ${h.toughest.avg.toFixed(1)} (${sgn(h.toughest.vsPar)})${h.toughest.parsOrBetter === 0 ? " — nobody made par" : ""}`);
  if (h.easiest && h.easiest.n !== h.toughest?.n) out.push(`Easiest: Hole ${h.easiest.n} · par ${h.easiest.par}${h.easiest.si ? `, stroke index ${h.easiest.si}` : ""} · field averaged ${h.easiest.avg.toFixed(1)} (${sgn(h.easiest.vsPar)})${h.easiest.birdies || h.easiest.pars ? ` — ${h.easiest.birdies} birdie${h.easiest.birdies === 1 ? "" : "s"}, ${h.easiest.pars} par${h.easiest.pars === 1 ? "" : "s"}` : ""}`);
  if (s.individualStats && h.netEagleHole) out.push(`Net eagles: ${h.netEagleHole.total} — ${h.netEagleHole.count} on hole ${h.netEagleHole.n} (par ${h.netEagleHole.par}${h.netEagleHole.si ? `, stroke index ${h.netEagleHole.si}` : ""})`);
  return out;
}

const H = (t: string, sub = "") => `<div style="font-size:11px;font-weight:800;letter-spacing:1.5px;color:#5d6f66;margin:14px 0 6px">${t}${sub ? `<span style="font-weight:500;letter-spacing:0"> · ${esc(sub)}</span>` : ""}</div>`;
const ROW = (l: string, r: string, strong = false) => `<tr><td style="padding:5px 0;border-top:1px solid #eef1ee;font-size:13.5px;${strong ? "font-weight:700;" : ""}">${l}</td><td style="padding:5px 0;border-top:1px solid #eef1ee;text-align:right;font-size:13.5px;font-weight:700;white-space:nowrap">${r}</td></tr>`;
const TABLE = (rows: string) => `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">${rows}</table>`;

/** The group's recap as email HTML, in the recap card's order. */
export function recapEmailHtml(r: Recap, cup?: CupLine | null): string {
  const h = r.highlights, s = r.sections, parts: string[] = [];
  // 0. a Cup session: the Cup's standing after it (209.5 — same wording as the recap card)
  if (cup) parts.push(`<div style="border:1px solid #C9A227;background:#FBF6E6;border-radius:10px;padding:10px 12px;margin-top:10px">`
    + `<div style="font-size:11px;font-weight:800;letter-spacing:1.5px;color:#9A7A12">${esc(cup.name.toUpperCase())} · ${cup.final ? "FINAL" : "AFTER THIS SESSION"}</div>`
    + `<div style="font-family:Georgia,serif;font-size:19px;font-weight:800;margin-top:2px">${esc(cup.aName)} ${esc(cup.a)} – ${esc(cup.bName)} ${esc(cup.b)}</div>`
    + `<div style="font-size:12.5px;color:#5d6f66;margin-top:3px">${esc(cup.detail)}</div></div>`);
  // 1. the format's own results
  if (s.matches?.rows.length) parts.push(H(s.matches.title.toUpperCase()) + TABLE(s.matches.rows.map((m) =>
    ROW(m.halved ? `${esc(m.winners.join(" & "))} halved with ${esc(m.losers.join(" & "))}` : `${esc(m.winners.join(" & "))} <span style="color:#5d6f66">beat</span> ${esc(m.losers.join(" & "))}`, esc(m.result))).join("")));
  if (s.skins?.length) parts.push(H("SKINS") + TABLE(s.skins.filter((k) => k.skins > 0).map((k) => ROW(esc(k.name), `${fmtPoints(k.skins)} · holes ${k.holes.map((x) => x.n).join(", ")}`)).join("")));
  if (s.skinMatches?.rows.length) parts.push(H(s.skinMatches.title.toUpperCase()) + TABLE(s.skinMatches.rows.map((m) => ROW(`${esc(m.a.join(" & "))} vs ${esc(m.b.join(" & "))}`, `${fmtPoints(m.aSkins)}–${fmtPoints(m.bSkins)}`)).join("")));
  // 211.1: a scramble's results — the recap card's wording (scrambleRowValue)
  if (s.scramble) parts.push(H(s.scramble.mode === "match" ? "SCRAMBLE · TEAM V TEAM" : `SCRAMBLE · ${s.scramble.gross ? "GROSS" : "NET"}`) + TABLE(s.scramble.mode === "match"
    ? s.scramble.matches.map((m) => ROW(esc(m), "")).join("")
    : s.scramble.rows.map((r) => ROW(`${esc(r.pos)} &nbsp;${esc(r.name)} <span style="color:#5d6f66;font-size:12px">${esc(r.members)}</span>`, esc(scrambleRowValue(r, s.scramble!.gross)))).join("")));
  if (s.leaderboard?.rows.length) parts.push(H(`LEADERBOARD · ${s.leaderboard.basis.toUpperCase()}`) + TABLE(s.leaderboard.rows.slice(0, 10).map((x) => ROW(`${esc(x.pos)} &nbsp;${esc(x.item.name)}`, String(x.item.score))).join("")));
  // 2. how the field played
  if (s.individualStats) {
    const strip = ([["birdies", h.scoring.birdies], ["pars", h.scoring.pars], ["bogeys", h.scoring.bogeys], ["doubles+", h.scoring.doublesPlus]] as const)
      .map(([l, v]) => `<td style="text-align:center;width:25%"><div style="font-family:Georgia,serif;font-size:20px;font-weight:800">${v}</div><div style="font-size:11px;color:#5d6f66">${l}</div></td>`).join("");
    parts.push(H("HOW THE FIELD PLAYED") + `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>${strip}</tr></table>`
      + fieldLines(r).map((l) => `<div style="font-size:13px;color:#33433b;margin-top:5px;line-height:1.45">${esc(l)}</div>`).join(""));
  }
  // 3. highlight tiles
  if (s.tiles.length) parts.push(H("HIGHLIGHTS") + `<table role="presentation" width="100%" cellspacing="6" cellpadding="0" style="border-collapse:separate">`
    + Array.from({ length: Math.ceil(s.tiles.length / 2) }, (_, i) => `<tr>${s.tiles.slice(i * 2, i * 2 + 2).map((t) =>
      `<td style="border:1px solid #e3e8e4;border-radius:10px;padding:8px 10px;width:50%;vertical-align:top"><div style="font-size:11px;color:#5d6f66;text-transform:uppercase;letter-spacing:.5px">${esc(t.label)}</div><div style="font-weight:700;font-size:13.5px">${esc(t.who)}</div><div style="color:#9A7A12;font-size:12px;font-weight:700">${esc(t.what)}</div></td>`).join("")}</tr>`).join("") + `</table>`);
  // 4. standout rounds
  if (s.individualStats && h.standouts?.rows.length) {
    const st = h.standouts;
    const sub = st.basis === "field" && st.fieldGap != null
      ? `best against their handicap, on a course that played ${Math.abs(Math.round(st.fieldGap - 3))} shot${Math.abs(Math.round(st.fieldGap - 3)) === 1 ? "" : "s"} ${st.fieldGap - 3 >= 0.5 ? "hard" : st.fieldGap - 3 <= -0.5 ? "easy" : "about normal"}`
      : "best against their own handicap";
    parts.push(H("STANDOUT ROUNDS", sub) + TABLE(st.rows.map((x, i) => ROW(esc(x.name) + (x.exceptional ? " · exceptional round" : ""), `${x.better.toFixed(1)} better${i === 0 && st.basis === "field" ? " than the field" : st.basis === "own" ? " than handicap" : ""}`)).join(""))
      + (st.basis === "field" && st.fieldGap != null ? `<div style="font-size:11px;color:#5d6f66;margin-top:4px">The field averaged ${st.fieldGap.toFixed(1)} over its handicaps (a normal day is about 3).</div>` : ""));
  }
  // 5. top 3 gross | net
  if (s.individualStats && !s.leaderboard && h.topGross.length) {
    const col = (title: string, rows: { pos: string; item: { name: string; score: number } }[]) =>
      `<td style="width:50%;vertical-align:top;padding-right:6px">${H(title)}${TABLE(rows.map((x) => ROW(`${esc(x.pos)} &nbsp;${esc(x.item.name)}`, String(x.item.score))).join(""))}</td>`;
    parts.push(`<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>${col("TOP 3 GROSS", h.topGross)}${col("TOP 3 NET", h.topNet)}</tr></table>`);
  }
  // 5b. 210.6 (owner): only completed rounds count toward exceptional play — the recap's own sentence
  const shortNote = shortenedNote(h.shortened);
  if (shortNote) parts.push(`<div style="font-size:12px;color:#5d6f66;line-height:1.45;margin-top:8px">${esc(shortNote)}</div>`);
  // 6. net birdies & eagles
  if (s.individualStats && h.netBirdies.players) parts.push(H("NET BIRDIES & EAGLES", `top ${Math.min(5, h.netBirdies.top.length)}`)
    + TABLE(`<tr><td style="font-size:11px;color:#5d6f66"></td><td style="font-size:11px;color:#5d6f66;text-align:right">Net birdies · Net eagles</td></tr>`
      + h.netBirdies.top.slice(0, 5).map((x) => ROW(`${esc(x.pos)} &nbsp;${esc(x.item.name)}`, `${x.item.birdies} · ${x.item.eagles}`)).join("")));
  return parts.join("");
}
