import { gameTypeLabel, type GameTypeOpt } from "./game-create";
// The ONE wording for the line-up link's title and preview (201.5): used by the server metadata
// (what iMessage/WhatsApp show when the link is pasted) and by the page's own document.title.
// Before: every preview read "Birdie Num Num" — the root metadata — so a chat full of links were
// indistinguishable. Now: "Line-up · Saturday Trifecta · Sat Oct 11".
// "Sat, Oct 10, 2026" from a YYYY-MM-DD match date, built as a LOCAL date so it never shifts a day
// across the UTC boundary (the 196.3 lesson). Weekday and year included: a link read on Thursday for
// Saturday's game must not look like today's game.
export function fmtMatchDate(ymd: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || "");
  if (!m) return ymd || null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

/** 212.109 (owner, Nov 14: the line-up description "includes the date twice"): an AUTOMATIC game name already ends with
 *  the date ("Stableford / Oak Hollow / Nov 14, 2026"), so the title must not add it again. Matched by shape — a
 *  month name followed by a day — because dates are written differently on differently set-up phones. */
export function nameCarriesDate(name: string | null | undefined): boolean {
  return /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.? \d{1,2}(,? \d{4})?\b|\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/i.test(name || "");
}

export function lineupTitle(d: { ended?: boolean; name?: string | null; played_on?: string | null; played_at?: string | null } | null | undefined): string {
  if (!d) return "Line-up · Birdie Num Num";
  const name = (d.name || "Game").trim();
  if (d.ended) return `${name} · finished · Birdie Num Num`;
  const date = nameCarriesDate(name) ? null : (fmtMatchDate(d.played_on) || d.played_at || null);   // 212.109: never the date twice
  return ["Line-up", name, date].filter(Boolean).join(" · ");
}

/** 212.109: the live scores link's title and description — the same shape as the line-up's, for chat previews. */
export function liveTitle(d: { ended?: boolean; name?: string | null; played_on?: string | null; played_at?: string | null } | null | undefined): string {
  if (!d) return "Live scores · Birdie Num Num";
  const name = (d.name || "Game").trim();
  if (d.ended) return `${name} · final · Birdie Num Num`;
  const date = nameCarriesDate(name) ? null : (fmtMatchDate(d.played_on) || d.played_at || null);
  return ["Live scores", name, date].filter(Boolean).join(" · ");
}
export function liveDescription(d: { ended?: boolean; course?: string | null; players?: unknown[]; game_type?: string | null } | null | undefined): string {
  if (!d) return "The scorecard and leaderboard as they happen.";
  if (d.ended) return "This game has finished — the final scorecard and leaderboard.";
  const n = Array.isArray(d.players) ? d.players.length : 0;
  const bits = [d.course || null, n ? `${n} player${n === 1 ? "" : "s"}` : null, d.game_type ? gameTypeLabel(d.game_type as GameTypeOpt) : null].filter(Boolean);
  return `${bits.join(" · ")}${bits.length ? " — " : ""}the scorecard and leaderboard as they happen.`;
}

export function lineupDescription(d: { ended?: boolean; course?: string | null; players?: unknown[]; allowance_pct?: number | null; game_type?: string | null } | null | undefined): string {
  if (!d) return "Tees, playing handicaps, opponents and strokes — live until the game ends.";
  if (d.ended) return "This game has finished. Open Birdie Num Num for the results.";
  const n = Array.isArray(d.players) ? d.players.length : 0;
  const bits = [d.course || null, n ? `${n} player${n === 1 ? "" : "s"}` : null, d.game_type ? gameTypeLabel(d.game_type as GameTypeOpt) : null,   // 212.23: "Stroke play", not the raw "stroke"
    d.allowance_pct != null && d.allowance_pct !== 100 ? `${d.allowance_pct}% allowance` : null].filter(Boolean);
  return `${bits.join(" · ")}${bits.length ? " — " : ""}tees, playing handicaps, opponents and strokes. Live until the game ends.`;
}
