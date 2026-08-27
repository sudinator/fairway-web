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
 * Group players for display: by team when the game has them, else by tee group, else one flat list.
 *
 * Ordering within a group is the order the organiser built it in, NOT alphabetical — for foursomes
 * that order carries meaning, since the first partner listed tees off first.
 */
function grouped(game: SummaryGame, players: SummaryPlayer[]): { label: string | null; rows: SummaryPlayer[] }[] {
  const teams = game.teams;
  if (Array.isArray(teams) && teams.length) {
    const out = teams.map((t) => ({
      label: t.name || t.key,
      rows: players.filter((p) => p.team === t.key),
    }));
    // Anyone not on a team still has to appear, or the roster is silently incomplete.
    const spare = players.filter((p) => !teams.some((t) => t.key === p.team));
    return out.filter((g) => g.rows.length).concat(spare.length ? [{ label: "Not on a team", rows: spare }] : []);
  }
  const groups = [...new Set(players.map((p) => p.tee_group ?? null))].filter((g) => g != null) as number[];
  if (groups.length > 1) {
    return groups
      .sort((a, b) => a - b)
      .map((g) => ({ label: `Group ${g}`, rows: players.filter((p) => p.tee_group === g) }));
  }
  return [{ label: null, rows: players }];
}

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
  // The allowance is stated only when it is NOT the default, so the common case stays quiet — but
  // a 50% or 85% game says so, because that is the number people query afterwards.
  if (game.allowance_pct != null && game.allowance_pct !== 100) meta.push(`${game.allowance_pct}% allowance`);
  lines.push(meta.join(" \u00b7 "));
  lines.push("");

  for (const g of grouped(game, players)) {
    if (g.label) lines.push(`${g.label}:`);
    for (const p of g.rows) {
      // Index and course handicap are BOTH shown: the index is what a player recognises as "their"
      // handicap, the course handicap is what they will actually play off, and the gap between them
      // is the thing that surprises people.
      const bits = [
        `idx ${val(p.handicap_index)}`,
        `CH ${val(p.course_handicap)}`,
        val(p.tee_name),
      ];
      if (p.tee_group != null && !g.label?.startsWith("Group")) bits.push(`Grp ${p.tee_group}`);
      const flag = p.no_show ? "  (no-show)" : "";
      lines.push(`  ${p.display_name}  \u2014  ${bits.join(" \u00b7 ")}${flag}`);
    }
    lines.push("");
  }

  lines.push("Check your handicap and tee before we start.");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
