// Server helpers for the round-summary email (209.3): the game context for one member's round, and the signed
// one-click "turn off" link. Server only (uses node:crypto and the service key).
import crypto from "node:crypto";
import { buildRecap } from "@/lib/game-recap";
import { recapEmailHtml } from "@/lib/recap-email";
import { chBasis, pkey } from "@/lib/game-shape";
import type { Game, Player } from "@/lib/game-types";
import type { EmailGameContext } from "@/lib/round-email";
import type { CupLine } from "@/lib/cup-standing";
import { isFullCard } from "@/lib/round-rules";

/** The member's game context: the group's result, their line, their net position, their standout. */
export function gameContextFor(game: Game, players: Player[], userId: string, cup?: CupLine | null): { context: EmailGameContext; groupHtml: string } | null {
  const me = players.find((p) => (p as any).user_id === userId);
  if (!me) return null;
  const recap = buildRecap(game, players);
  const nh = Array.isArray(game.holes_meta) ? game.holes_meta.length : 18;
  // Net position among finishers, on the full course handicap (the recap's standing rule).
  const nets = players.filter((p) => !p.no_show && isFullCard(p.scores, nh))
    .map((p) => ({ key: pkey(p), net: (p.scores as number[]).slice(0, nh).reduce((a, b) => a + Number(b), 0) - Math.round(Number(chBasis(p as any, game.course_par, nh >= 18 ? undefined : nh) ?? 0)) }));
  const mine = nets.find((x) => x.key === pkey(me));
  const position = mine ? { rank: 1 + nets.filter((x) => x.net < mine.net).length, of: nets.length } : null;
  const st = recap.highlights.standouts;
  const myStandout = st?.rows.find((r) => r.name === me.display_name) ?? null;
  const fieldNote = st && st.basis === "field" && st.fieldGap != null
    ? `on a course that played ${Math.abs(Math.round(st.fieldGap - 3))} shot${Math.abs(Math.round(st.fieldGap - 3)) === 1 ? "" : "s"} ${st.fieldGap - 3 >= 0.5 ? "hard" : st.fieldGap - 3 <= -0.5 ? "easy" : "about normal"}` : null;
  return {
    context: { name: game.name || "Game", headline: recap.headline, matchLine: recap.personal[pkey(me)] ?? null, position,
      standoutBetter: myStandout ? myStandout.better : null, standoutBasis: st?.basis ?? null,
      fieldNote: st?.basis === "field" ? fieldNote : null },
    groupHtml: recapEmailHtml(recap, cup),
  };
}

const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY || "";
/** Signed one-click "turn off" token: only the server can make one, and it only works for that member. */
export type EmailKind = "round" | "club";
const purpose = (kind: EmailKind) => (kind === "club" ? "club-reports" : "round-emails");
/** A token only works for its own member AND its own kind of email (210.1: club reports have their own switch). */
export const unsubscribeToken = (userId: string, kind: EmailKind = "round") => crypto.createHmac("sha256", key()).update(`${purpose(kind)}:${userId}`).digest("hex").slice(0, 32);
export const validUnsubscribe = (userId: string, token: string, kind: EmailKind = "round") => {
  const a = Buffer.from(unsubscribeToken(userId, kind)), b = Buffer.from(String(token || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
