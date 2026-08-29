/**
 * The setup summary — a plain-text roster to paste into a group chat before teeing off.
 *
 * The point is CONFIRMATION: everyone sees the handicap, tee and team they have been given and can
 * say "that's not my tee" before the first drive rather than arguing on the 9th. Nothing here is
 * new information; it is the same data the setup screens hold, arranged so a person can scan it.
 *
 * WHY PLAIN TEXT
 * It has to survive being pasted into WhatsApp, iMessage and Slack. That rules out tables, box
 * drawing and anything relying on a monospace font — group chats render none of it reliably. Two
 * spaces after a name is a column in a monospace client and a readable gap everywhere else.
 *
 * WHY A PURE FUNCTION
 * The text is the deliverable, so it can be asserted directly. A React component rendering the same
 * strings could only be checked by scraping the DOM.
 */
import type { GameType } from "./game-shape";
import { gameTypeLabel } from "./game-create";

export type SummaryPlayer = {
  display_name: string;
  handicap_index?: number | null;
  course_handicap?: number | null;
  tee_name?: string | null;
  team?: string | null;
  tee_group?: number | null;
  no_show?: boolean | null;
};

export type SummaryGame = {
  name?: string | null;
  course?: string | null;
  game_type: GameType;
  allowance_pct?: number | null;
  played_at?: string | null;
  teams?: { key: string; name: string }[] | null;
  holes_meta?: { n: number }[] | null;
};

/** "—" rather than a blank, so a missing value is visibly missing rather than looking overlooked. */
const val = (v: unknown) => (v == null || v === "" ? "\u2014" : String(v));

/**
 * The holes being played, as a person would say them: "18 holes" or "9 holes (10–18)".
 * A nine is worth naming explicitly — someone turning up at the 1st tee for a back-nine match is
 * exactly the kind of mistake this report exists to prevent.
 */
function holesLine(game: SummaryGame): string | null {
  const meta = game.holes_meta;
  if (!Array.isArray(meta) || !meta.length) return null;
  if (meta.length === 18) return "18 holes";
  const first = meta[0]?.n;
  const last = meta[meta.length - 1]?.n;
  return first != null && last != null
    ? `${meta.length} holes (${first}\u2013${last})`
    : `${meta.length} holes`;
}



/**
 * The tee most players are on, and how many differ — so it can be stated once in the header rather
 * than repeated on every line.
 *
 * Keyed on the number of EXCEPTIONS, not a percentage. A flat "80%" has a bad edge: 3 of 4 players
 * is 75% and would not qualify, yet repeating a tee three times to flag one exception is exactly
 * the repetition worth removing.
 *
 * Returns null when no tee is a genuine majority — an even 2/2 split has no "main tee", and
 * calling one dominant would mislabel half the field.
 */
export function dominantTee(players: SummaryPlayer[]): { tee: string; exceptions: number } | null {
  const named = players.map((p) => p.tee_name).filter((t): t is string => !!t);
  if (!named.length) return null;
  const counts = new Map<string, number>();
  for (const t of named) counts.set(t, (counts.get(t) ?? 0) + 1);
  let top = ""; let n = 0;
  for (const [t, c] of counts) if (c > n) { top = t; n = c; }
  if (n <= named.length / 2) return null;
  const exceptions = named.length - n;
  if (exceptions === 0) return { tee: top, exceptions: 0 };
  // Few enough to list as exceptions: two or fewer, or at most a quarter of the field.
  if (exceptions <= 2 || exceptions <= named.length * 0.25) return { tee: top, exceptions };
  return null;
}

/** Alphabetical by display name — finding yourself is the job this ordering serves. */
const byName = (a: SummaryPlayer, b: SummaryPlayer) =>
  a.display_name.localeCompare(b.display_name);

/**
 * The report.
 *
 * Layout is deliberately flat: one line per player, so a long roster stays scannable on a phone
 * screen in a chat thread.
 */
export function buildSetupSummary(game: SummaryGame, players: SummaryPlayer[]): string {
  const lines: string[] = [];

  lines.push(game.name?.trim() || gameTypeLabel(game.game_type));
  const sub = [game.course, game.played_at].filter(Boolean).join(" \u00b7 ");
  if (sub) lines.push(sub);

  const meta: string[] = [gameTypeLabel(game.game_type)];
  const h = holesLine(game);
  if (h) meta.push(h);
  // Stated only when it is NOT the default, so the common case stays quiet — but a 50% or 85% game
  // says so, because that is the number people query afterwards.
  if (game.allowance_pct != null && game.allowance_pct !== 100) meta.push(`${game.allowance_pct}% allowance`);
  lines.push(meta.join(" \u00b7 "));

  // The tee, once, rather than on every line.
  const dom = dominantTee(players);
  if (dom) lines.push(dom.exceptions === 0 ? `All playing ${dom.tee} tees` : `${dom.tee} tees unless noted`);
  lines.push("");

  const teamName = (key: string | null | undefined) => {
    if (!key) return null;
    const t = (game.teams || []).find((x) => x.key === key);
    return t ? `Team ${t.name || t.key}` : `Team ${key}`;
  };
  // Tee groups are only worth stating when they actually differ — otherwise it is another column
  // of the same value.
  const groups = new Set(players.map((p) => p.tee_group ?? null));
  const showGroup = groups.size > 1;

  for (const p of [...players].sort(byName)) {
    const bits: string[] = [];
    const tn = teamName(p.team);
    if (tn) bits.push(tn);
    // BOTH numbers: the index is what a player recognises as "theirs", the course handicap is what
    // they will actually play off, and the gap between them is what surprises people mid-round.
    bits.push(`CH ${val(p.course_handicap)}`);
    bits.push(`idx ${val(p.handicap_index)}`);
    // The tee appears ONLY when it differs from the one named in the header.
    if (!dom || p.tee_name !== dom.tee) bits.push(`${val(p.tee_name)} tees`);
    if (showGroup && p.tee_group != null) bits.push(`Grp ${p.tee_group}`);
    if (p.no_show) bits.push("no-show");
    lines.push(`  ${p.display_name}  \u2014  ${bits.join(" \u00b7 ")}`);
  }

  lines.push("");
  lines.push("Check your handicap and tee before we start.");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
