"use client";
// The completed-game recap on a finished game's Play screen (207.2), with "Share with the group":
// every player can send the 9:16 image (RecapBody in share mode) through the phone's share sheet.
// One recap (lib/game-recap) drives both, so the in-app recap and the image never disagree.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { C, effectiveGroupId, TGC_GROUP_ID } from "@/lib/golf";
import { btn } from "@/components/ui";
import { createClient } from "@/lib/supabase";
import { loadCupForGame } from "@/lib/cup-load";
import { cupStandingAfter, type CupLine } from "@/lib/cup-standing";
import { pkey, chBasis } from "@/lib/game-shape";
import { buildRecap } from "@/lib/game-recap";
import { contestLeaderboard, fmtContestValue, type Contest, type ContestEntry } from "@/lib/contests";
import { useCardExport } from "@/components/share-card";
import { RecapBody, type RecapContest } from "@/components/game/recap-body";
import type { AltShotScoreRow } from "@/lib/alt-shot-side-scores";
import type { Game, Player } from "@/lib/game-types";

export function GameRecapCard({ game, players, altShotScores, userId, betStale, competition, onOpenCompetition }: {
  game: Game; players: Player[]; altShotScores: AltShotScoreRow[]; userId: string; betStale: boolean;
  competition?: { competition_id: string; name: string } | null; onOpenCompetition?: (id: string) => void;
}) {
  const recap = useMemo(() => buildRecap(game, players, altShotScores), [game, players, altShotScores]);
  const supabase = useMemo(() => createClient(), []);
  const hasBet = effectiveGroupId((game as any).group_id) === TGC_GROUP_ID;
  const [posted, setPosted] = useState<boolean | null>(null);
  const [contests, setContests] = useState<RecapContest[]>([]);
  useEffect(() => {
    let live = true;
    if (hasBet) supabase.from("expenses").select("id").eq("source_game_id", game.id).eq("source_kind", "tgc_bet").is("deleted_at", null).maybeSingle()
      .then(({ data, error }) => { if (live && !error) setPosted(!!data); });
    (async () => {
      // bounded: one game's contests
      const { data: cs, error } = await supabase.from("game_contests").select("*").eq("game_id", game.id);
      if (error || !cs?.length) return;
      // bounded: one game's contest entries
      const { data: es } = await supabase.from("game_contest_entries").select("*").in("contest_id", cs.map((c: any) => c.id));
      const out: RecapContest[] = [];
      (cs as Contest[]).forEach((c) => contestLeaderboard(c, ((es || []) as ContestEntry[]).filter((e) => e.contest_id === c.id && !e.voided))
        .forEach((w) => { if (w.best) out.push({ label: c.label, hole: w.hole, name: w.best.player_name, value: fmtContestValue(c.unit, w.best.value) }); }));
      if (live) setContests(out);
    })();
    return () => { live = false; };
  }, [supabase, game.id, hasBet]);
  // 209.5: a Cup session shows the Cup's standing after it (shared loader + lib/cup-standing — the Cup page's numbers).
  const [cup, setCup] = useState<CupLine | null>(null);
  const competitionId = competition?.competition_id ?? null;
  useEffect(() => {
    if (!competitionId) { setCup(null); return; }
    let live = true;
    // A failed load shows no Cup box (rather than partial numbers); the recap itself is unaffected.
    loadCupForGame(supabase, game.id).then((c) => { if (live) setCup(c ? cupStandingAfter(c.competition, c.sessions, game.id) : null); })
      .catch(() => { if (live) setCup(null); });
    return () => { live = false; };
  }, [supabase, game.id, competitionId, players]);

  const me = players.find((p) => p.user_id === userId);
  const myLine = me ? recap.personal[pkey(me)] ?? null : null;
  const myScore = (() => {
    if (!me || !recap.sections.individualStats) return null;
    const holes = game.holes_meta?.length ?? 18;
    const sc = (me.scores || []).filter((x): x is number => typeof x === "number" && x > 0);
    if (sc.length < holes) return null;
    const gross = sc.reduce((s, x) => s + x, 0), net = gross - Math.round(Number(chBasis(me, game.course_par, holes) ?? 0));
    const nb = recap.highlights.netBirdies.all.find((r) => r.key === pkey(me));
    return `You shot ${gross} (net ${net})${nb ? ` · ${nb.birdies} net birdie${nb.birdies === 1 ? "" : "s"}${nb.eagles ? `, ${nb.eagles} net eagle${nb.eagles === 1 ? "" : "s"}` : ""}` : ""}.`;
  })();
  const money = !hasBet || posted === null ? null : betStale ? "Winnings need review — scores changed after posting" : posted ? "Winnings posted in Money" : "Winnings not posted yet";
  const changed = (game as any).recap_signature && (game as any).recap_signature !== recap.signature;
  const shown = { ...game, players_count: players.filter((p) => !p.no_show).length } as Game;

  const shareRef = useRef<HTMLDivElement>(null);
  const caption = `${game.name || game.course || "Game"} — ${recap.headline} 🏆`;
  const { busy, msg, shareImage } = useCardExport(shareRef, `recap-${(game as any).code || game.id}`, caption, () => caption);

  return (
    <div data-game-recap style={{ background: C.greenLight, borderRadius: 14, padding: 16, marginBottom: 12 }}>
      <RecapBody game={shown} recap={recap} mode="app" contests={contests} myLine={myLine} myScore={myScore} money={money} cup={cup} />
      {changed ? <div data-recap-changed style={{ color: C.gold, fontSize: 12.5, marginTop: 8, fontWeight: 700 }}>Results changed since they were announced — scores were corrected.</div> : null}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button type="button" data-recap-share onClick={shareImage} disabled={busy} style={{ ...btn(true), flex: 1, fontSize: 14 }}>{busy ? "Preparing…" : "📤 Share with the group"}</button>
        {competition && onOpenCompetition ? <button type="button" style={{ ...btn(false), fontSize: 13 }} onClick={() => onOpenCompetition(competition.competition_id)}>{competition.name} standings</button> : null}
      </div>
      {msg ? <div style={{ color: C.sage, fontSize: 12, marginTop: 6 }}>{msg}</div> : null}
      {/* The share image: the same recap in share mode, 9:16, rendered off-screen and exported as a picture. */}
      <div aria-hidden style={{ position: "absolute", left: -10000, top: 0 }}>
        <div ref={shareRef} data-recap-share-image style={{ width: 402, minHeight: 715, boxSizing: "border-box", background: C.green, padding: 16, display: "flex", flexDirection: "column" }}>
          <RecapBody game={shown} recap={recap} mode="share" contests={contests} cup={cup} />
        </div>
      </div>
    </div>
  );
}
