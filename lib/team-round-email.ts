// 212.7 — the recap email for a TEAM round (scramble / alternate shot): one score per team, so no personal round email
// exists for it. The member's own line, then the game's recap (recapEmailHtml — the app's recap, word for word), in
// the same plain wrapper as the other BNN emails.
import type { Recap } from "@/lib/game-recap";
import { recapEmailHtml } from "@/lib/recap-email";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export function teamRoundEmail(o: {
  format: "scramble" | "alt_shot"; course: string; recap: Recap; personalLine: string | null; firstName: string | null; gameUrl: string; unsubscribeUrl: string;
}): { subject: string; html: string; text: string } {
  const label = o.format === "scramble" ? "Scramble" : "Alternate shot";
  const subject = `${label} at ${o.course || "the course"} — ${o.personalLine || o.recap.headline}`;
  const html = `<!doctype html><html><body style="margin:0;background:#e9ede9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d2b24">
<div style="max-width:560px;margin:0 auto;padding:18px 14px">
  <div style="color:#0E3B2E;font-weight:800;letter-spacing:2px;font-size:12px">BIRDIE NUM NUM · ${esc(label.toUpperCase())}</div>
  <div style="background:#fff;border-radius:12px;padding:16px;margin-top:10px">
    <div style="font-size:15px">${o.firstName ? `Hi ${esc(o.firstName)},` : "Hi,"}</div>
    <div style="font-family:Georgia,serif;font-size:20px;font-weight:800;color:#0E3B2E;margin-top:8px">${esc(o.recap.headline)}</div>
    ${o.personalLine ? `<div style="font-size:14px;margin-top:6px"><b>${esc(o.personalLine)}</b></div>` : ""}
    <div style="color:#5d6f66;font-size:13px;margin-top:4px">${esc(o.course)}</div>
    ${recapEmailHtml(o.recap)}
    <div style="color:#5d6f66;font-size:12px;margin-top:14px;line-height:1.5">${label} scores belong to the team — this counts as a round played, not in your personal stats.</div>
    <div style="margin-top:14px"><a href="${o.gameUrl}" style="background:#0E3B2E;color:#F7F3E8;text-decoration:none;font-weight:700;padding:10px 16px;border-radius:999px;display:inline-block">Open the game</a></div>
  </div>
  <div style="color:#5d6f66;font-size:11px;margin-top:12px;text-align:center">Round emails are on for your account. <a href="${o.unsubscribeUrl}" style="color:#5d6f66">Turn them off</a>.</div>
</div></body></html>`;
  const text = [`${label} at ${o.course}`, o.recap.headline, o.personalLine || "", "", `${label} scores belong to the team — this counts as a round played, not in your personal stats.`, `Open the game: ${o.gameUrl}`, `Turn off round emails: ${o.unsubscribeUrl}`].filter((x, i) => i < 2 || x !== "").join("\n");
  return { subject, html, text };
}
