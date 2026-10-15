// POST /api/games/[id]/completed — announce a finished game (207.2).
//
// Called by the app right after ending a game. Builds the recap with the SAME results functions as
// the Results screen (lib/game-recap) — the notification can never disagree with what players see —
// and announces it: "final" the first time; after a reopen and re-end, "results updated" only if the
// outcome changed; otherwise nothing (claim_game_recap, 0188). No money amounts. Links to the game.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createRouteClient } from "@/lib/supabase-route";
import { buildRecap } from "@/lib/game-recap";
import { pkey } from "@/lib/game-shape";
import type { Game, Player } from "@/lib/game-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Bad game id." }, { status: 400 });
  const supabase = await createRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  // Read as the caller (RLS), and require the organizer or an admin of the game's club.
  const { data: game, error: gErr } = await supabase.from("games").select("*").eq("id", id).maybeSingle();
  if (gErr || !game) return NextResponse.json({ error: "Game not found." }, { status: 404 });
  let allowed = game.created_by === user.id;
  if (!allowed && game.group_id) {
    const { data: m } = await supabase.from("group_members").select("role").eq("group_id", game.group_id).eq("user_id", user.id).eq("status", "active").maybeSingle();
    allowed = m?.role === "admin";
  }
  if (!allowed) return NextResponse.json({ error: "Only the organizer can announce this game." }, { status: 403 });
  if (game.status !== "ended") return NextResponse.json({ announced: "not_ended" });

  const [{ data: players, error: pErr }, { data: alt, error: aErr }] = await Promise.all([
    supabase.from("game_players").select("*").eq("game_id", id),
    supabase.from("game_alt_shot_scores").select("*").eq("game_id", id),
  ]);
  if (pErr || aErr) return NextResponse.json({ error: "Couldn't read the game's scores." }, { status: 502 });
  const recap = buildRecap(game as Game, (players || []) as Player[], (alt || []) as never);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "Server isn't configured to send announcements." }, { status: 503 });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: claim, error: cErr } = await admin.rpc("claim_game_recap", { p_game: id, p_signature: recap.signature });
  if (cErr) return NextResponse.json({ error: "Couldn't record the announcement." }, { status: 502 });
  if (claim !== "final" && claim !== "updated") return NextResponse.json({ announced: claim });

  const name = game.name || game.course || "Your game";
  const rows = ((players || []) as Player[]).filter((p) => p.user_id && !p.no_show).map((p) => {
    const mine = recap.personal[pkey(p)];
    const lead = claim === "final" ? `"${name}" is final${recap.endedEarly ? " (ended early)" : ""}: ${recap.headline}.` : `"${name}" results updated: ${recap.headline}.`;
    return {
      user_id: p.user_id, group_id: game.group_id ?? null, type: "game_finished",
      message: `${lead}${mine ? ` ${mine.charAt(0).toUpperCase()}${mine.slice(1)}.` : ""} Tap to view results.`,
      link: game.code ? `/?game=${game.code}` : "/?tab=games",
      detail: recap.notes.length ? recap.notes.join(" · ") : null,
    };
  });
  if (rows.length) {
    const { error: nErr } = await admin.from("notifications").insert(rows);
    if (nErr) return NextResponse.json({ error: "Announcement recorded but notifications failed.", announced: claim }, { status: 502 });
  }
  return NextResponse.json({ announced: claim, recipients: rows.length });
}
