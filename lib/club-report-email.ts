// The club report as an email (210.1) — the same sections as the club page (components/club-report-view).
import type { ClubReport } from "@/lib/club-report";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const day = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function clubReportEmail(r: ClubReport, o: { appUrl: string; unsubscribeUrl: string }): { subject: string; html: string; text: string } {
  const tiles: [string, string, string][] = [];
  if (r.bestGross) tiles.push(["Best gross", r.bestGross.name, `${r.bestGross.score} · ${r.bestGross.course}`]);
  if (r.bestNet) tiles.push(["Best net", r.bestNet.name, `net ${r.bestNet.score} · ${day(r.bestNet.date)}`]);
  if (r.standouts.count) tiles.push(["Standout rounds", `${r.standouts.count} this period`, r.standouts.best ? `best: ${r.standouts.best.name}, ${r.standouts.best.better.toFixed(1)} better than the field` : ""]);
  if (r.mostNetBirdies) tiles.push(["Most net birdies", r.mostNetBirdies.name, String(r.mostNetBirdies.count)]);
  if (r.mostImproved) tiles.push(["Most improved", r.mostImproved.name, `index ${r.mostImproved.from.toFixed(1)} → ${r.mostImproved.to.toFixed(1)}`]);
  if (r.mostRounds) tiles.push(["Most rounds", r.mostRounds.name, String(r.mostRounds.count)]);
  const tile = ([l, w, v]: [string, string, string]) => `<td style="border:1px solid #e3e8e4;border-radius:10px;padding:8px 10px;width:50%;vertical-align:top"><div style="font-size:11px;color:#5d6f66;text-transform:uppercase;letter-spacing:.5px">${esc(l)}</div><div style="font-weight:700;font-size:14px">${esc(w)}</div>${v ? `<div style="color:#9A7A12;font-size:12px;font-weight:700">${esc(v)}</div>` : ""}</td>`;
  const grid = tiles.length ? `<table role="presentation" width="100%" cellspacing="6" cellpadding="0" style="border-collapse:separate">${Array.from({ length: Math.ceil(tiles.length / 2) }, (_, i) => `<tr>${tiles.slice(i * 2, i * 2 + 2).map(tile).join("")}</tr>`).join("")}</table>` : "";
  const H = (t: string) => `<div style="font-size:11px;font-weight:800;letter-spacing:1.5px;color:#5d6f66;margin:14px 0 4px">${t}</div>`;
  const L = (t: string) => `<div style="font-size:13.5px;line-height:1.5;margin-top:3px">${t}</div>`;
  const courses = [
    r.toughestCourse ? L(`Toughest for the club: <b>${esc(r.toughestCourse.course)}</b> (field ${r.toughestCourse.fieldGap >= 0 ? "+" : ""}${r.toughestCourse.fieldGap.toFixed(1)} over handicaps)`) : "",
    r.nemesisHole ? L(`The club's nemesis hole: <b>${esc(r.nemesisHole.course)} ${r.nemesisHole.hole}</b> (par ${r.nemesisHole.par}) — ${r.nemesisHole.vsPar >= 0 ? "+" : ""}${r.nemesisHole.vsPar.toFixed(1)} a round`) : "",
    r.mostBirdiedHole ? L(`Most birdied: <b>${esc(r.mostBirdiedHole.course)} ${r.mostBirdiedHole.hole}</b> — ${r.mostBirdiedHole.birdies} birdie${r.mostBirdiedHole.birdies === 1 ? "" : "s"}`) : "",
  ].join("");
  const rivals = [
    r.closestRivalry ? L(`Closest rivalry: <b>${esc(r.closestRivalry.a)} v ${esc(r.closestRivalry.b)}</b> — ${r.closestRivalry.aWins}–${r.closestRivalry.bWins}${r.closestRivalry.halved ? `, ${r.closestRivalry.halved} halved` : ""}`) : "",
    r.longestStreak ? L(`Longest streak: <b>${esc(r.longestStreak.name)}</b> — ${r.longestStreak.weeks} weeks in a row`) : "",
  ].join("");
  const subject = `${r.club} — your club report for ${r.period.label}`;
  const html = `<!doctype html><html><body style="margin:0;background:#e9ede9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d2b24">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:20px 10px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#0E3B2E;color:#F7F3E8;padding:20px 22px">
 <div style="color:#C9A227;font-weight:800;font-size:11px;letter-spacing:2px">${esc(r.club.toUpperCase())} · ${esc(r.period.label.toUpperCase())}</div>
 <div style="font-family:Georgia,serif;font-size:22px;font-weight:800;margin-top:6px">${r.games} games · ${r.rounds} rounds · ${r.members} members played</div></td></tr>
<tr><td style="padding:12px 16px 0">${grid}</td></tr>
<tr><td style="padding:0 22px">${courses ? H("THE COURSES") + courses : ""}${rivals ? H("RIVALRIES & ATTENDANCE") + rivals : ""}</td></tr>
<tr><td style="padding:18px 22px"><a href="${esc(o.appUrl)}" style="display:block;background:#C9A227;color:#1a1a1a;text-align:center;font-weight:800;padding:12px;border-radius:999px;text-decoration:none;font-size:14.5px">Open Birdie Num Num</a></td></tr>
<tr><td style="border-top:1px solid #e3e8e4;padding:14px 22px;font-size:11.5px;color:#5d6f66;line-height:1.5">You're getting this because club report emails are on. <a href="${esc(o.unsubscribeUrl)}" style="color:#5d6f66">Turn off club report emails</a></td></tr>
</table></td></tr></table></body></html>`;
  const text = [subject, "", `${r.games} games · ${r.rounds} rounds · ${r.members} members played`, ...tiles.map(([l, w, v]) => `${l}: ${w}${v ? ` (${v})` : ""}`), "", o.appUrl, "", `Turn off club report emails: ${o.unsubscribeUrl}`].join("\n");
  return { subject, html, text };
}
