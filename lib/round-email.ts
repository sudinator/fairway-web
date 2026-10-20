// Round-summary email (209.2), from the approved mock. Pure: round data in → subject, HTML, text and a content
// fingerprint out (the fingerprint lets the sender spot a later score correction and send "Updated:").
// Stats reuse the app's own rules: lib/round-stats (putts, greens in regulation, fairways) and the badge rules
// in lib/badges (sand save = greenside bunker, missed green, par or better; scramble = missed green, par or
// better). Owner decisions (Oct 2026): opt-out; all rounds; an hour after the round, then "Updated:" on change;
// round stats only when recorded on most holes; scorecard on cream with the app's circles and squares.
import type { Hole } from "@/lib/golf";
import { allocateStrokes } from "@/lib/golf";
import { roundStats, isGIR } from "@/lib/round-stats";
import { chBasis } from "@/lib/game-shape";

export type EmailRound = {
  id: string; course: string; tee_name?: string | null; played_at: string; course_handicap: number | null;
  handicap_index?: number | null; rating?: number | null; slope?: number | null;
  course_handicap_source?: "derived" | "manual" | null;
};
export type EmailGameContext = {
  name: string;
  headline?: string | null;       // "Red beat Blue 4½–3½"
  matchLine?: string | null;      // "You and your partner won 2&1"
  position?: { rank: number; of: number } | null;   // net position among finishers
  standoutBetter?: number | null; // how much better, when a standout
  /** 210.6: holes played when the member's round stopped early (9+ holes, not all) — it doesn't count toward
   *  positions or standout rounds, and the email says so. */
  shortenedHoles?: number | null;
  /** 210.2: what it was measured against — "field" (8+ players) or "own" (the player's handicap). */
  standoutBasis?: "field" | "own" | null;
  fieldNote?: string | null;      // "on a course that played 2 shots hard"
  sub?: string | null;            // the recap's second line ("6 of 10 singles went to the 18th")
  groupHtml?: string | null;      // the group's recap (lib/recap-email) — shown BEFORE the member's own round
};
export type RoundEmail = { subject: string; html: string; text: string; fingerprint: string };

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const ordinal = (n: number) => { const v = n % 100; const sfx = v >= 11 && v <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] || "th"; return `${n}${sfx}`; };
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const day = (iso: string) => new Date(String(iso).slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toUpperCase();

/** The app's ScoreMark rules (components/ui.tsx), drawn with borders — what email programs show reliably. */
function mark(strokes: number | null, par: number): string {
  if (strokes == null) return `<span style="color:#9aa59f">–</span>`;
  const d = strokes - par, B = "#B83A2E", G = "#2E5AB8";
  const one = (col: string, r: string) => `<span style="display:inline-block;width:22px;height:22px;line-height:19px;border:1.5px solid ${col};border-radius:${r};color:${col};font-weight:700;text-align:center">${strokes}</span>`;
  const two = (col: string, r1: string, r2: string, fill = "") => `<span style="display:inline-block;border:1.5px solid ${col};border-radius:${r1};padding:1.5px"><span style="display:inline-block;width:17px;height:17px;line-height:14px;border:1.5px solid ${col};border-radius:${r2};color:${col};font-weight:700;text-align:center;${fill}">${strokes}</span></span>`;
  if (d <= -2) return two(B, "50%", "50%");
  if (d === -1) return one(B, "50%");
  if (d >= 3) return two(G, "6px", "4px", "background:#D5DDF1;");
  if (d === 2) return two(G, "6px", "4px");
  if (d === 1) return one(G, "6px");
  return `<span style="font-weight:700;color:#1d2b24">${strokes}</span>`;
}

export function buildRoundEmail(o: {
  round: EmailRound; holes: Hole[]; firstName?: string | null; game?: EmailGameContext | null;
  /** 209.3 (owner): a game round shows the GROUP's recap first (lib/recap-email), then the member's own round. */
  groupHtml?: string | null;
  appUrl: string; recapUrl: string; unsubscribeUrl: string; isUpdate?: boolean;
}): RoundEmail {
  const holes = [...o.holes].sort((a, b) => a.hole_number - b.hole_number);
  const played = holes.filter((h) => h.strokes != null);
  const gross = played.reduce((s, h) => s + (h.strokes || 0), 0);
  // Course handicap through chBasis (standing rule): a manual figure is used as given, else the exact one.
  const coursePar = holes.reduce((s, h) => s + (h.par || 0), 0);
  const ch = Math.round(Number(chBasis(o.round, coursePar, holes.length >= 18 ? undefined : holes.length) ?? 0));   // whole number, as the recap
  const alloc = allocateStrokes(holes, ch);
  const netOf = (h: Hole) => (h.strokes == null ? null : h.strokes - (alloc[h.hole_number] || 0));
  const net = played.reduce((s, h) => s + (netOf(h) || 0), 0);
  const netBirdies = played.filter((h) => (netOf(h) as number) <= h.par - 1);

  // ---- round stats (only when recorded on most holes) ----
  const st = roundStats(holes);
  const n = played.length;
  const puttsTracked = st.withPutts >= (n >= 18 ? 14 : 7) && n >= 9;
  const fwEligible = played.filter((h) => h.par >= 4).length;
  const fwTracked = st.fwHoles > 0 && st.fwHoles >= Math.ceil(fwEligible * 0.8);
  const withPutts = played.filter((h) => h.putts != null);
  const threePutts = withPutts.filter((h) => (h.putts || 0) >= 3).length;
  const penalties = played.reduce((s, h) => s + (h.penalties || 0), 0);
  const girHoles = withPutts.filter((h) => isGIR(h));
  const puttsOnGir = girHoles.reduce((s, h) => s + (h.putts || 0), 0);
  const missedGreens = withPutts.filter((h) => !isGIR(h));
  const scrambles = missedGreens.filter((h) => (h.strokes as number) <= h.par).length;
  const sandHoles = missedGreens.filter((h) => !!h.sand);
  const sandSaves = sandHoles.filter((h) => (h.strokes as number) <= h.par).length;
  const byPar = (p: number) => { const hs = played.filter((h) => h.par === p); return hs.length ? (hs.reduce((s, h) => s + (h.strokes || 0), 0) / hs.length).toFixed(1) : null; };
  const parAvg = [3, 4, 5].map((p) => [p, byPar(p)] as const).filter(([, v]) => v != null);

  // ---- words ----
  const g = o.game;
  const pos = g?.position ? `, ${ordinal(g.position.rank)} of ${g.position.of}` : "";
  const subject = `${o.isUpdate ? "Updated: " : ""}Your round at ${o.round.course} — ${gross} (net ${net})${pos}`;
  const highlights: string[] = [];
  if (g?.shortenedHoles) highlights.push(`<b>Your round was shortened (${g.shortenedHoles} holes)</b> — only completed rounds count toward positions and standout rounds.`);
  if (g?.standoutBetter != null) highlights.push(g.standoutBasis === "own"
    ? `<b>Standout round</b> — ${g.standoutBetter.toFixed(1)} better than your handicap.`
    : `<b>Standout round</b> — ${g.standoutBetter.toFixed(1)} better than the field against your handicap${g.fieldNote ? `, ${esc(g.fieldNote)}` : ""}.`);
  const netEagles = netBirdies.filter((h) => (netOf(h) as number) <= h.par - 2);
  if (netEagles.length) highlights.push(`Net eagle${netEagles.length > 1 ? "s" : ""} on ${netEagles.map((h) => h.hole_number).join(", ")}.`);
  if (n === 18) {
    const front = played.filter((h) => h.hole_number <= 9).reduce((s, h) => s + (h.strokes || 0), 0);
    const back = gross - front;
    if (Math.abs(front - back) >= 3) highlights.push(back < front ? `Back nine ${back}, ${front - back} better than your front.` : `Front nine ${front}, ${back - front} better than your back.`);
  }

  // ---- HTML (email-safe: tables + inline styles) ----
  const box = (v: string, l: string) => `<td style="border:1px solid #e3e8e4;border-radius:12px;padding:10px;text-align:center;width:33%"><div style="font-family:Georgia,serif;font-size:24px;font-weight:800;color:#1d2b24">${v}</div><div style="font-size:11px;color:#5d6f66;letter-spacing:.5px;margin-top:2px">${l}</div></td>`;
  const row = (cells: string[]) => `<table role="presentation" width="100%" cellspacing="6" cellpadding="0" style="border-collapse:separate"><tr>${cells.join("")}</tr></table>`;
  const nums = g?.position
    ? [box(ordinal(g.position.rank), `NET, OF ${g.position.of}`), box(String(netBirdies.length), "NET BIRDIES"), g.standoutBetter != null ? box(g.standoutBetter.toFixed(1), g.standoutBasis === "own" ? "BETTER THAN YOUR HANDICAP" : "BETTER THAN THE FIELD") : box(String(net), "NET")]
    : [box(String(gross), "GROSS"), box(String(net), "NET"), box(String(netBirdies.length), "NET BIRDIES")];
  const statBlocks: string[] = [];
  const statRow1: string[] = [];
  if (fwTracked) statRow1.push(box(`${pct(st.fwHit, st.fwHoles)}%`, `FAIRWAYS · ${st.fwHit} OF ${st.fwHoles}`));
  if (puttsTracked) {
    statRow1.push(box(`${pct(st.girHit, st.withPutts)}%`, `GREENS · ${st.girHit} OF ${st.withPutts}`));
    statRow1.push(box(String(st.totalPutts), `PUTTS · ${threePutts} THREE-PUTT${threePutts === 1 ? "" : "S"}`));
    statRow1.push(box(String(penalties), `PENALT${penalties === 1 ? "Y" : "IES"}`));
  }
  if (statRow1.length) statBlocks.push(row(statRow1));
  const statRow2: string[] = [];
  if (parAvg.length) statRow2.push(box(parAvg.map(([, v]) => v).join(" · "), `AVG ON ${parAvg.map(([p]) => `PAR ${p}s`).join(" · ")}`));
  if (puttsTracked && girHoles.length) statRow2.push(box((puttsOnGir / girHoles.length).toFixed(2), "PUTTS PER GREEN HIT"));
  if (statRow2.length) statBlocks.push(row(statRow2));
  if (puttsTracked && (sandHoles.length || missedGreens.length)) statBlocks.push(row([
    ...(sandHoles.length ? [box(`${sandSaves} of ${sandHoles.length}`, "SAND SAVES")] : []),
    ...(missedGreens.length ? [box(`${scrambles} of ${missedGreens.length}`, "SCRAMBLES")] : []),
  ]));

  const nine = (from: number, label: string) => {
    const hs = holes.filter((h) => h.hole_number >= from && h.hole_number < from + 9);
    if (!hs.length) return "";
    const td = (c: string, extra = "") => `<td style="text-align:center;padding:4px 0;border-top:1px solid #e3dcc6;${extra}">${c}</td>`;
    const lab = (t: string) => `<td style="text-align:left;padding:4px 6px;border-top:1px solid #e3dcc6;color:#5d6f66;font-weight:700;width:42px">${t}</td>`;
    const sum = (f: (h: Hole) => number | null) => hs.reduce((s, h) => s + (f(h) || 0), 0);
    return `<tr style="background:#EDE7D3;color:#5d6f66;font-weight:700">${lab("Hole")}${hs.map((h) => td(String(h.hole_number))).join("")}${td(label)}</tr>`
      + `<tr>${lab("Par")}${hs.map((h) => td(String(h.par))).join("")}${td(String(sum((h) => h.par)))}</tr>`
      + `<tr style="background:#FBFAF4">${lab("You")}${hs.map((h) => td(mark(h.strokes, h.par))).join("")}${td(`<b>${sum((h) => h.strokes)}</b>`)}</tr>`
      + `<tr style="color:#5d6f66;font-size:11px">${lab("Net")}${hs.map((h) => td(netOf(h) == null ? "–" : String(netOf(h)))).join("")}${td(String(sum(netOf)))}</tr>`;
  };
  const card = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#F7F3E8;color:#1d2b24;font-size:12px;border-radius:10px;overflow:hidden">${nine(1, "Out")}${nine(10, "In")}</table>`;

  const sub = g ? [g.name, g.headline, o.groupHtml ? null : g.matchLine].filter(Boolean).map(esc).join(" · ") : [o.round.tee_name ? `${esc(o.round.tee_name)} tees` : null, `course handicap ${ch}`].filter(Boolean).join(" · ");
  const html = `<!doctype html><html><body style="margin:0;background:#e9ede9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d2b24">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:20px 10px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
${g?.groupHtml ? `<tr><td style="background:#0E3B2E;color:#F7F3E8;padding:20px 22px">
 <div style="color:#C9A227;font-weight:800;font-size:11px;letter-spacing:2px">${o.isUpdate ? "UPDATED · " : ""}${esc(g.name.toUpperCase())} · ${day(o.round.played_at)}</div>
 <div style="font-family:Georgia,serif;font-size:23px;font-weight:800;margin:6px 0 4px">${esc(g.headline || g.name)}</div>
 <div style="color:#B2CBBD;font-size:13.5px">${esc([g.sub, o.round.course].filter(Boolean).join(" · "))}</div></td></tr>
<tr><td style="padding:2px 22px 4px" data-email-group>${g.groupHtml}</td></tr>
<tr><td style="padding:16px 22px 0;border-top:6px solid #e9ede9"><div style="font-size:11px;font-weight:800;letter-spacing:1.5px;color:#C9A227">YOUR ROUND</div>
 <div style="font-family:Georgia,serif;font-size:21px;font-weight:800;margin:4px 0 2px">${gross} gross · net ${net}${g.position ? ` · ${ordinal(g.position.rank)} of ${g.position.of}` : ""}</div>
 ${g.matchLine ? `<div style="color:#5d6f66;font-size:13.5px">${esc(g.matchLine)}</div>` : ""}</td></tr>`
 : `<tr><td style="background:#0E3B2E;color:#F7F3E8;padding:20px 22px">
 <div style="color:#C9A227;font-weight:800;font-size:11px;letter-spacing:2px">${o.isUpdate ? "UPDATED · " : ""}YOUR ROUND · ${day(o.round.played_at)}</div>
 <div style="font-family:Georgia,serif;font-size:23px;font-weight:800;margin:6px 0 4px">${gross} gross · net ${net} at ${esc(o.round.course)}</div>
 <div style="color:#B2CBBD;font-size:13.5px">${sub}</div></td></tr>`}
${o.groupHtml ? `<tr><td style="padding:6px 22px 4px"><div style="font-family:Georgia,serif;font-size:17px;font-weight:800;margin-top:10px">The group</div>${o.groupHtml}</td></tr>
<tr><td style="padding:16px 22px 0"><div style="border-top:2px solid #0E3B2E;padding-top:12px;font-family:Georgia,serif;font-size:17px;font-weight:800">Your round</div>${g?.matchLine ? `<div style="font-size:13px;color:#5d6f66;margin-top:2px">${esc(g.matchLine)}</div>` : ""}</td></tr>` : ""}
<tr><td style="padding:12px 16px 6px">${row(nums)}</td></tr>
${statBlocks.length ? `<tr><td style="padding:6px 22px 0"><div style="font-size:11px;font-weight:800;letter-spacing:1.5px;color:#5d6f66">ROUND STATS</div></td></tr><tr><td style="padding:0 16px">${statBlocks.join("")}</td></tr>` : ""}
${highlights.length ? `<tr><td style="padding:12px 22px 0"><div style="font-size:11px;font-weight:800;letter-spacing:1.5px;color:#5d6f66">HIGHLIGHTS</div>${highlights.map((h) => `<div style="font-size:14px;line-height:1.45;margin-top:6px">⛳ ${h}</div>`).join("")}</td></tr>` : ""}
<tr><td style="padding:14px 22px 0"><div style="font-size:11px;font-weight:800;letter-spacing:1.5px;color:#5d6f66;margin-bottom:6px">YOUR SCORECARD</div>${card}
 <div style="font-size:11px;color:#5d6f66;margin-top:6px">Circle = birdie · square = bogey · double marks for eagle / double bogey — the same as your scorecard in the app</div></td></tr>
<tr><td style="padding:16px 22px"><a href="${esc(o.recapUrl)}" style="display:block;background:#C9A227;color:#1a1a1a;text-align:center;font-weight:800;padding:12px;border-radius:999px;text-decoration:none;font-size:14.5px">${g ? "Open the full recap" : "Open Birdie Num Num"}</a></td></tr>
<tr><td style="border-top:1px solid #e3e8e4;padding:14px 22px;font-size:11.5px;color:#5d6f66;line-height:1.5">You're getting this because round summaries are on. <a href="${esc(o.unsubscribeUrl)}" style="color:#5d6f66">Turn off round summaries</a> · <a href="${esc(o.appUrl)}" style="color:#5d6f66">Birdie Num Num</a></td></tr>
</table></td></tr></table></body></html>`;

  const text = [subject, "", sub.replace(/<[^>]+>/g, ""), `Gross ${gross} · Net ${net}${pos}`, ...highlights.map((h) => "• " + h.replace(/<[^>]+>/g, "")), "",
    o.recapUrl, "", `Turn off round summaries: ${o.unsubscribeUrl}`].join("\n");
  const fingerprint = JSON.stringify({ gross, net, pos: g?.position ?? null, headline: g?.headline ?? null, standout: g?.standoutBetter ?? null,
    holes: holes.map((h) => [h.hole_number, h.strokes, h.putts, h.fairway, h.penalties, h.sand ?? null]) });
  return { subject, html, text, fingerprint };
}
