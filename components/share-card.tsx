"use client";
import React, { useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { C, Hole, Round, stablefordPts, allocateStrokes, applyAllowance, fmtDate } from "@/lib/golf";
import { ScoreViewCard, btn } from "@/components/ui";

const FMT_LABEL: Record<string, string> = {
  stableford: "Stableford", stroke: "Stroke play", match: "Singles match play",
  fourball: "Four-ball", skins: "Skins", trifecta: "Trifecta",
};

// Share the CURRENT user's own scorecard from a game as the same vertical card
// shown under Rounds. Renders an on-screen preview (so they see exactly what's
// shared), then exports a PNG to the share sheet, with download + copy-text fallbacks.
export function ShareScorecardModal({ game, player, onClose }: { game: any; player: any; onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const { round, gross, net, pts, dateStr } = useMemo(() => {
    const meta = (game.holes_meta || []) as { n: number; par: number; si: number | null }[];
    const ch = player.course_handicap ?? 0;
    const playing = applyAllowance(ch, game.allowance_pct ?? 100);
    const alloc = allocateStrokes(meta.map((m) => ({ hole_number: m.n, stroke_index: m.si })), playing);
    const holes: Hole[] = meta.map((m, i) => ({
      hole_number: m.n,
      par: m.par,
      stroke_index: m.si ?? null,
      strokes: player.scores?.[i] ?? null,
      putts: player.putts?.[i] ?? null,
      fairway: player.fairways?.[i] ?? null,
      penalties: player.penalties?.[i] ?? 0,
      sand: player.sand?.[i] ?? false,
      recv: alloc[m.n] || 0,
    }));
    const gross = holes.reduce((s, h) => s + (h.strokes || 0), 0);
    const net = holes.reduce((s, h) => s + (h.strokes != null ? h.strokes - (h.recv || 0) : 0), 0);
    const pts = holes.reduce((s, h) => s + (stablefordPts(h.strokes, h.par, h.recv || 0) || 0), 0);
    let dateStr = "";
    try { dateStr = game.played_at ? fmtDate(game.played_at) : ""; } catch { dateStr = String(game.played_at || ""); }
    return { round: { holes } as unknown as Round, gross, net, pts, dateStr };
  }, [game, player]);

  const ended = game.status === "ended";
  const fmt = FMT_LABEL[game.game_type] || "Game";

  const buildText = () => {
    const lines: string[] = [];
    lines.push(game.name || "Scorecard");
    lines.push(`${game.course || ""}${dateStr ? ` · ${dateStr}` : ""}${game.course_par ? ` · Par ${game.course_par}` : ""}`);
    lines.push(`${player.display_name} — gross ${gross} · net ${net} · ${pts} pts`);
    lines.push("");
    const pad = (v: any, n: number) => String(v).padStart(n);
    lines.push(" H | Par | Score");
    round.holes.forEach((h) => {
      lines.push(`${pad(h.hole_number, 2)} | ${pad(h.par, 3)} | ${pad(h.strokes ?? "-", 5)}`);
    });
    lines.push("");
    lines.push("shared from Birdie Num Num");
    return lines.join("\n");
  };

  const shareImage = async () => {
    if (!cardRef.current) return;
    setBusy(true); setMsg(null);
    try {
      const dataUrl = await toPng(cardRef.current, { pixelRatio: 2, backgroundColor: C.green, cacheBust: true });
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], `${(game.name || "scorecard").replace(/[^a-z0-9]+/gi, "-")}.png`, { type: "image/png" });
      const navAny = navigator as any;
      if (navAny.canShare && navAny.canShare({ files: [file] }) && navAny.share) {
        await navAny.share({ files: [file], title: game.name || "Scorecard" });
        setMsg(null);
      } else {
        const a = document.createElement("a");
        a.href = dataUrl; a.download = file.name; a.click();
        setMsg("Image downloaded — attach it in your chat.");
      }
    } catch {
      setMsg("Couldn't make the image here. Try \u201cCopy as text\u201d instead.");
    }
    setBusy(false);
  };

  const copyText = async () => {
    try { await navigator.clipboard.writeText(buildText()); setMsg("Copied — paste it into your chat."); }
    catch { setMsg("Couldn't copy automatically on this device."); }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 16, zIndex: 1100, overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380, width: "100%", margin: "10px 0 40px" }}>

        {/* The exportable card */}
        <div ref={cardRef} style={{ background: C.green, borderRadius: 18, padding: "16px 14px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.4, padding: "3px 9px", borderRadius: 999, background: ended ? "#3F3414" : "#1f7a52", color: ended ? "#E4CF86" : "#CFF5E2" }}>{ended ? "FINAL" : "LIVE"}</span>
            <span style={{ color: C.gold, fontSize: 11, letterSpacing: 1.4, fontWeight: 700 }}>{fmt.toUpperCase()}</span>
          </div>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 800, color: C.cream, marginTop: 10 }}>{game.name}</div>
          <div style={{ color: C.sage, fontSize: 13, marginTop: 3 }}>{game.course}{dateStr ? ` · ${dateStr}` : ""}{game.course_par ? ` · Par ${game.course_par}` : ""}</div>
          <div style={{ color: C.cream, fontSize: 13.5, marginTop: 10, fontWeight: 700 }}>
            {player.display_name} <span style={{ color: C.sage, fontWeight: 500 }}>· gross {gross} · net {net} · {pts} pts</span>
          </div>
          <div style={{ marginTop: 12 }}>
            <ScoreViewCard round={round} />
          </div>
          <div style={{ textAlign: "center", color: C.sage, fontSize: 11, marginTop: 14, opacity: 0.85 }}>
            shared from <span style={{ fontFamily: "Georgia, serif", fontWeight: 800, color: C.cream }}>Birdie<span style={{ color: C.gold }}> Num Num</span></span>
          </div>
        </div>

        {/* Controls (not part of the exported image) */}
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button onClick={shareImage} disabled={busy} style={{ ...btn(true), flex: 1, minWidth: 130, padding: "10px 0", opacity: busy ? 0.6 : 1 }}>{busy ? "Preparing…" : "📤 Share image"}</button>
          <button onClick={copyText} style={{ ...btn(false), flex: 1, minWidth: 110, padding: "10px 0" }}>Copy as text</button>
        </div>
        {msg && <div style={{ color: C.sage, fontSize: 12.5, marginTop: 10, textAlign: "center" }}>{msg}</div>}
        <div style={{ textAlign: "center", marginTop: 10 }}>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.sage, fontSize: 13, cursor: "pointer" }}>Close</button>
        </div>
      </div>
    </div>
  );
}
