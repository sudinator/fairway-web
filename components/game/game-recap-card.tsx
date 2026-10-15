"use client";
// The completed-game recap (207.2): the first thing on a finished game's Play screen. Built ONLY from
// lib/game-recap (the shared results functions), so it agrees with the Results cards below it and
// with the completion notification. No money amounts — the money STATUS only.
import React, { useEffect, useMemo, useState } from "react";
import { C, effectiveGroupId, TGC_GROUP_ID } from "@/lib/golf";
import { btn } from "@/components/ui";
import { createClient } from "@/lib/supabase";
import { pkey } from "@/lib/game-shape";
import { buildRecap } from "@/lib/game-recap";
import { fmtMatchDate } from "@/lib/lineup-meta";
import type { AltShotScoreRow } from "@/lib/alt-shot-side-scores";
import type { Game, Player } from "@/lib/game-types";

const FORMAT: Record<string, string> = { match: "Singles match play", fourball: "Four-ball", alt_shot: "Alternate shot", trifecta: "Trifecta", stableford: "Stableford", stroke: "Stroke play", skins: "Skins" };

export function GameRecapCard({ game, players, altShotScores, userId, betStale, competition, onOpenCompetition }: {
  game: Game; players: Player[]; altShotScores: AltShotScoreRow[]; userId: string; betStale: boolean;
  competition?: { competition_id: string; name: string } | null; onOpenCompetition?: (id: string) => void;
}) {
  const recap = useMemo(() => buildRecap(game, players, altShotScores), [game, players, altShotScores]);
  const supabase = useMemo(() => createClient(), []);
  const hasBet = effectiveGroupId((game as any).group_id) === TGC_GROUP_ID;
  const [posted, setPosted] = useState<boolean | null>(null);
  useEffect(() => {
    if (!hasBet) return;
    let live = true;
    supabase.from("expenses").select("id").eq("source_game_id", game.id).eq("source_kind", "tgc_bet").is("deleted_at", null).maybeSingle()
      .then(({ data, error }) => { if (live && !error) setPosted(!!data); });
    return () => { live = false; };
  }, [supabase, game.id, hasBet]);
  const me = players.find((p) => p.user_id === userId);
  const mine = me ? recap.personal[pkey(me)] : null;
  const holes = game.holes_meta?.length ?? 18;
  const playedTo = Math.max(0, ...players.map((p) => (p.scores || []).filter((x) => x != null && x > 0).length));
  const money = !hasBet || posted === null ? null : betStale ? "Winnings need review — scores changed after posting" : posted ? "Winnings posted in Money" : "Winnings not posted yet";
  return (
    <div data-game-recap style={{ background: C.greenLight, borderRadius: 14, padding: 16, marginBottom: 12 }}>
      <div style={{ color: C.gold, fontSize: 11, letterSpacing: 2, fontWeight: 800 }}>{recap.endedEarly ? "FINAL · ENDED EARLY" : "FINAL"}</div>
      <div data-recap-headline style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 800, marginTop: 4, lineHeight: 1.2 }}>{recap.headline}</div>
      {mine ? <div style={{ color: C.cream, fontSize: 14, marginTop: 6 }}>{mine.charAt(0).toUpperCase() + mine.slice(1)}.</div> : null}
      {recap.notes.map((n, i) => <div key={i} style={{ color: C.gold, fontSize: 12.5, marginTop: 4 }}>{n}</div>)}
      {(game as any).recap_signature && (game as any).recap_signature !== recap.signature ? (
        <div data-recap-changed style={{ color: C.gold, fontSize: 12.5, marginTop: 4, fontWeight: 700 }}>Results changed since they were announced — scores were corrected.</div>
      ) : null}
      <div style={{ color: C.sage, fontSize: 12.5, marginTop: 8 }}>
        {[game.course, (game as any).played_at ? fmtMatchDate(String((game as any).played_at).slice(0, 10)) : null, FORMAT[game.game_type] || game.game_type,
          playedTo < holes ? `${playedTo} of ${holes} holes played` : `${holes} holes`].filter(Boolean).join(" · ")}
      </div>
      {money ? <div data-recap-money style={{ color: betStale ? C.gold : C.sage, fontSize: 12.5, marginTop: 4 }}>{money}</div> : null}
      {competition && onOpenCompetition ? (
        <button type="button" style={{ ...btn(false), fontSize: 12, marginTop: 10 }} onClick={() => onOpenCompetition(competition.competition_id)}>View {competition.name} standings</button>
      ) : null}
    </div>
  );
}
