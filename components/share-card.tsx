"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { C, Hole, Round, stablefordPts, allocateStrokes, applyAllowance, fmtDate, girStats, firStats, fracPct } from "@/lib/golf";
import { ScoreViewCard, btn } from "@/components/ui";
import { createClient } from "@/lib/supabase";
import { loadCoursesForGroup, type CourseTee } from "@/lib/courses";

const supabase = createClient();

const FMT_LABEL: Record<string, string> = {
  stableford: "Stableford", stroke: "Stroke play", match: "Singles match play",
  fourball: "Four-ball", skins: "Skins", trifecta: "Trifecta",
};

// Shared presentation + share/copy logic for both the game card and the solo-round
// card. Renders an on-screen preview (so the player sees exactly what's shared),
// exports a PNG to the share sheet, with download + copy-text fallbacks.
function useCardExport(cardRef: React.RefObject<HTMLDivElement>, fileBase: string, title: string, buildText: () => string) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const shareImage = async () => {
    if (!cardRef.current) return;
    setBusy(true); setMsg(null);
    try {
      const dataUrl = await toPng(cardRef.current, { pixelRatio: 2, backgroundColor: C.green, cacheBust: true });
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], `${(fileBase || "scorecard").replace(/[^a-z0-9]+/gi, "-")}.png`, { type: "image/png" });
      const navAny = navigator as any;
      if (navAny.canShare && navAny.canShare({ files: [file] }) && navAny.share) {
        await navAny.share({ files: [file], title });
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
  return { busy, msg, shareImage, copyText };
}

function ShareModalInner({ round, statusFinal, fmtLabel, title, subtitle, summaryLine, statsLine, fileBase, buildText, onClose }: {
  round: Round; statusFinal: boolean; fmtLabel: string;
  title: string; subtitle: string; summaryLine: React.ReactNode; statsLine?: React.ReactNode; fileBase: string;
  buildText: () => string; onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const { busy, msg, shareImage, copyText } = useCardExport(cardRef, fileBase, title, buildText);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 16, zIndex: 1100, overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380, width: "100%", margin: "10px 0 40px" }}>
        {/* The exportable card */}
        <div ref={cardRef} style={{ background: C.green, borderRadius: 18, padding: "16px 14px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.4, padding: "3px 9px", borderRadius: 999, background: statusFinal ? "#3F3414" : "#1f7a52", color: statusFinal ? "#E4CF86" : "#CFF5E2" }}>{statusFinal ? "FINAL" : "LIVE"}</span>
            <span style={{ color: C.gold, fontSize: 11, letterSpacing: 1.4, fontWeight: 700 }}>{fmtLabel}</span>
          </div>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 800, color: C.cream, marginTop: 10 }}>{title}</div>
          <div style={{ color: C.sage, fontSize: 13, marginTop: 3 }}>{subtitle}</div>
          <div style={{ color: C.cream, fontSize: 13.5, marginTop: 10, fontWeight: 700 }}>{summaryLine}</div>
          {statsLine && <div style={{ color: C.sage, fontSize: 12, marginTop: 4, fontWeight: 600 }}>{statsLine}</div>}
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

// Share the CURRENT user's own scorecard from a GAME.
export function ShareScorecardModal({ game, player, onClose }: { game: any; player: any; onClose: () => void }) {
  // Load the course's per-tee yardages so the card shows THIS player's tee.
  const [courseTees, setCourseTees] = useState<CourseTee[]>([]);
  useEffect(() => {
    if (!game?.group_id) return;
    loadCoursesForGroup(supabase, game.group_id).then((rows: any[]) => {
      const found = rows.find((r) => r.name === game.course) || rows.find((r) => (r.data?.name) === game.course);
      const tees = (found?.tees || found?.data?.tees || []) as CourseTee[];
      setCourseTees(Array.isArray(tees) ? tees : []);
    }).catch(() => {});
  }, [game?.group_id, game?.course]);

  const { round, gross, net, pts, dateStr, statsTxt, hasDetail } = useMemo(() => {
    const meta = (game.holes_meta || []) as { n: number; par: number; si: number | null }[];
    const ch = player.course_handicap ?? 0;
    const playing = applyAllowance(ch, game.allowance_pct ?? 100);
    const alloc = allocateStrokes(meta.map((m) => ({ hole_number: m.n, stroke_index: m.si })), playing);
    const myTee = courseTees.find((t) => t.name === player.tee_name);
    const holes: Hole[] = meta.map((m, i) => ({
      hole_number: m.n,
      par: m.par,
      stroke_index: m.si ?? null,
      yardage: myTee?.yardages?.[i] ?? (m as any).yards ?? null,
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
    const r = { holes } as unknown as Round;
    const puttsT = holes.reduce((s, h) => s + (h.putts || 0), 0);
    const pensT = holes.reduce((s, h) => s + (h.penalties || 0), 0);
    const hasDetail = holes.some((h) => h.putts != null || h.fairway != null);
    const statsTxt = `GIR ${fracPct(girStats([r]))} · FW ${fracPct(firStats([r]))} · ${puttsT} putts${pensT ? ` · ${pensT} pen` : ""}`;
    let dateStr = "";
    try { dateStr = game.played_at ? fmtDate(game.played_at) : ""; } catch { dateStr = String(game.played_at || ""); }
    return { round: { holes } as unknown as Round, gross, net, pts, dateStr, statsTxt, hasDetail };
  }, [game, player, courseTees]);

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
    round.holes.forEach((h) => { lines.push(`${pad(h.hole_number, 2)} | ${pad(h.par, 3)} | ${pad(h.strokes ?? "-", 5)}`); });
    lines.push(""); lines.push("shared from Birdie Num Num");
    return lines.join("\n");
  };

  return (
    <ShareModalInner
      round={round} statusFinal={ended} fmtLabel={fmt.toUpperCase()}
      title={game.name || "Scorecard"}
      subtitle={`${game.course || ""}${dateStr ? ` · ${dateStr}` : ""}${game.course_par ? ` · Par ${game.course_par}` : ""}`}
      summaryLine={<>{player.display_name} <span style={{ color: C.sage, fontWeight: 500 }}>· gross {gross} · net {net} · {pts} pts</span></>}
      statsLine={hasDetail ? statsTxt : undefined}
      fileBase={game.name || "scorecard"} buildText={buildText} onClose={onClose}
    />
  );
}

// Share a SOLO round from the round summary. The round already carries its holes
// (with per-tee yardage and recv), so no course lookup is needed.
export function ShareRoundModal({ round, playerName, onClose }: { round: any; playerName?: string; onClose: () => void }) {
  const { gross, net, pts, dateStr, statsTxt, hasDetail } = useMemo(() => {
    const holes = (round.holes || []) as Hole[];
    const gross = holes.reduce((s, h) => s + (h.strokes || 0), 0);
    const net = holes.reduce((s, h) => s + (h.strokes != null ? h.strokes - (h.recv || 0) : 0), 0);
    const pts = holes.reduce((s, h) => s + (stablefordPts(h.strokes, h.par, h.recv || 0) || 0), 0);
    const r = { holes } as unknown as Round;
    const puttsT = holes.reduce((s, h) => s + (h.putts || 0), 0);
    const pensT = holes.reduce((s, h) => s + (h.penalties || 0), 0);
    const hasDetail = holes.some((h) => h.putts != null || h.fairway != null);
    const statsTxt = `GIR ${fracPct(girStats([r]))} · FW ${fracPct(firStats([r]))} · ${puttsT} putts${pensT ? ` · ${pensT} pen` : ""}`;
    let dateStr = "";
    try { dateStr = round.played_at ? fmtDate(round.played_at) : ""; } catch { dateStr = String(round.played_at || ""); }
    return { gross, net, pts, dateStr, statsTxt, hasDetail };
  }, [round]);

  const subtitle = `${round.tee_name ? `${round.tee_name} tees · ` : ""}${dateStr}${round.course_par ? ` · Par ${round.course_par}` : ""}`;
  const buildText = () => {
    const lines: string[] = [];
    lines.push(round.course || "Round");
    lines.push(subtitle);
    lines.push(`${playerName ? `${playerName} — ` : ""}gross ${gross} · net ${net} · ${pts} pts`);
    lines.push("");
    const pad = (v: any, n: number) => String(v).padStart(n);
    lines.push(" H | Par | Score");
    (round.holes || []).forEach((h: Hole) => { lines.push(`${pad(h.hole_number, 2)} | ${pad(h.par, 3)} | ${pad(h.strokes ?? "-", 5)}`); });
    lines.push(""); lines.push("shared from Birdie Num Num");
    return lines.join("\n");
  };

  return (
    <ShareModalInner
      round={round as Round} statusFinal={true} fmtLabel="ROUND"
      title={round.course || "Round"} subtitle={subtitle}
      summaryLine={<>{playerName ? `${playerName} ` : ""}<span style={{ color: C.sage, fontWeight: 500 }}>{playerName ? "· " : ""}gross {gross} · net {net} · {pts} pts</span></>}
      statsLine={hasDetail ? statsTxt : undefined}
      fileBase={round.course || "round"} buildText={buildText} onClose={onClose}
    />
  );
}


// ---- Compact group scorecard share: leaderboard + two nine-hole grids (players as rows) ----
const sgNm: React.CSSProperties = { textAlign: "left", width: 52, fontSize: 11, padding: "3px 2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const sgCell: React.CSSProperties = { textAlign: "center", fontSize: 11, padding: "3px 0" };
const sgTot: React.CSSProperties = { textAlign: "center", width: 28, fontSize: 11, fontWeight: 800, color: C.green, borderLeft: `1px solid ${C.line}` };

export function ShareGameModal({ game, players, courseTees, onClose }: { game: any; players: any[]; courseTees?: CourseTee[]; onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const meta = (game.holes_meta || []) as { n: number; par: number; si: number | null; yards?: number }[];
  const n = meta.length || 18;

  const rows = useMemo(() => {
    return (players || []).filter((p: any) => !p.no_show).map((p: any) => {
      const ch = p.course_handicap ?? 0;
      const playing = applyAllowance(ch, game.allowance_pct ?? 100);
      const alloc = allocateStrokes(meta.map((m) => ({ hole_number: m.n, stroke_index: m.si })), playing);
      const tee = (courseTees || []).find((t) => t.name === p.tee_name);
      const holes: Hole[] = meta.map((m, i) => ({
        hole_number: m.n, par: m.par, stroke_index: m.si ?? null,
        yardage: tee?.yardages?.[i] ?? (m as any).yards ?? null,
        strokes: p.scores?.[i] ?? null, putts: p.putts?.[i] ?? null,
        fairway: p.fairways?.[i] ?? null, penalties: p.penalties?.[i] ?? 0, sand: p.sand?.[i] ?? false,
        recv: alloc[m.n] || 0,
      }));
      const gross = holes.reduce((s, h) => s + (h.strokes || 0), 0);
      const net = holes.reduce((s, h) => s + (h.strokes != null ? h.strokes - (h.recv || 0) : 0), 0);
      const pts = holes.reduce((s, h) => s + (stablefordPts(h.strokes, h.par, h.recv || 0) || 0), 0);
      const r = { holes } as unknown as Round;
      const puttsT = holes.reduce((s, h) => s + (h.putts || 0), 0);
      const played = holes.some((h) => h.strokes != null);
      return { id: p.id, name: p.display_name || "Player", hcp: ch, holes, gross, net, pts, gir: girStats([r]), fw: firStats([r]), puttsT, played };
    });
  }, [players, courseTees, game]);

  const stab = game.game_type === "stableford";
  const board = useMemo(() => {
    const arr = rows.filter((r) => r.played).slice();
    arr.sort((a, b) => stab ? b.pts - a.pts : a.net - b.net);
    return arr;
  }, [rows, stab]);

  let dateStr = ""; try { dateStr = game.played_at ? fmtDate(game.played_at) : ""; } catch { dateStr = ""; }
  const subtitle = `${game.course || ""}${dateStr ? ` · ${dateStr}` : ""}${game.course_par ? ` · Par ${game.course_par}` : ""}`;
  const fmt = (FMT_LABEL[game.game_type] || "Game").toUpperCase();
  const ended = game.status === "ended";

  const buildText = () => {
    const L: string[] = [];
    L.push(game.name || "Scorecard");
    L.push(subtitle);
    L.push("");
    board.forEach((r, i) => L.push(`${i + 1}. ${r.name} — ${stab ? `${r.pts} pts` : `net ${r.net}`} (gross ${r.gross})`));
    L.push(""); L.push("shared from Birdie Num Num");
    return L.join("\n");
  };
  const { busy, msg, shareImage, copyText } = useCardExport(cardRef, game.name || "scorecard", game.name || "Scorecard", buildText);

  const scoreColor = (val: number | null, par: number) => {
    if (val == null) return C.faint;
    const d = val - par;
    if (d <= -1) return C.birdie;
    if (d === 0) return C.ink;
    return C.bogey;
  };

  const Grid = ({ from, to, totLbl, label }: { from: number; to: number; totLbl: string; label: string }) => {
    const slice = meta.slice(from, to);
    return (
      <div style={{ background: C.card, borderRadius: 12, padding: "8px 8px 10px", marginTop: 8 }}>
        <div style={{ color: C.greenMid, fontSize: 10, letterSpacing: 1.5, fontWeight: 800, margin: "0 2px 6px" }}>{label}</div>
        <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}><tbody>
          <tr style={{ borderBottom: `1px solid ${C.line}` }}>
            <td style={{ ...sgNm, color: C.faint, fontWeight: 700, fontSize: 10 }}>Hole</td>
            {slice.map((m) => <td key={m.n} style={{ ...sgCell, color: C.faint, fontWeight: 700, fontSize: 10 }}>{m.n}</td>)}
            <td style={{ ...sgTot, color: C.greenMid, fontSize: 10 }}>{totLbl}</td>
          </tr>
          <tr style={{ borderBottom: `1px solid ${C.line}` }}>
            <td style={{ ...sgNm, color: C.faint, fontWeight: 700, fontSize: 10 }}>Par</td>
            {slice.map((m) => <td key={m.n} style={{ ...sgCell, color: C.faint, fontWeight: 700, fontSize: 10 }}>{m.par}</td>)}
            <td style={{ ...sgTot, color: C.faint, fontSize: 10 }}>{slice.reduce((s, m) => s + m.par, 0)}</td>
          </tr>
          {rows.map((r) => {
            let sum = 0;
            return (
              <tr key={r.id} style={{ borderTop: "1px solid #F0EBDA" }}>
                <td style={{ ...sgNm, color: C.ink, fontWeight: 800 }}>{r.name.split(" ")[0]}</td>
                {slice.map((m, idx) => {
                  const i = from + idx; const val = r.holes[i]?.strokes ?? null; if (val != null) sum += val;
                  return <td key={m.n} style={{ ...sgCell, color: scoreColor(val, m.par), fontWeight: (val != null && Math.abs(val - m.par) >= 1) ? 800 : 600 }}>{val ?? "·"}</td>;
                })}
                <td style={{ ...sgTot }}>{sum || "·"}</td>
              </tr>
            );
          })}
        </tbody></table>
      </div>
    );
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 16, zIndex: 1100, overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 430, width: "100%", margin: "10px 0 40px" }}>
        <div ref={cardRef} style={{ background: C.green, borderRadius: 18, padding: "16px 14px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.4, padding: "3px 9px", borderRadius: 999, background: ended ? "#3F3414" : "#1f7a52", color: ended ? "#E4CF86" : "#CFF5E2" }}>{ended ? "FINAL" : "LIVE"}</span>
            <span style={{ color: C.gold, fontSize: 11, letterSpacing: 1.4, fontWeight: 700 }}>{fmt}</span>
          </div>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 800, color: C.cream, marginTop: 10 }}>{game.name || "Scorecard"}</div>
          <div style={{ color: C.sage, fontSize: 13, marginTop: 3 }}>{subtitle}</div>

          <div style={{ background: C.card, borderRadius: 12, marginTop: 12 }}>
            {board.map((r, i) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 11px", borderBottom: i < board.length - 1 ? "1px solid #EEE8D6" : "none" }}>
                <span style={{ width: 14, color: C.faint, fontWeight: 800, fontSize: 13 }}>{i + 1}</span>
                <span style={{ flex: 1, fontWeight: 800, fontSize: 14, color: C.ink }}>{r.name} <span style={{ color: C.faint, fontWeight: 600, fontSize: 10.5 }}>· hcp {r.hcp}</span></span>
                <span style={{ fontFamily: "Georgia, serif", fontWeight: 800, fontSize: 16, color: i === 0 ? "#1f8f54" : C.faint }}>{stab ? `${r.pts} pts` : `net ${r.net}`}</span>
              </div>
            ))}
          </div>

          <Grid from={0} to={Math.min(9, n)} totLbl="OUT" label="FRONT 9" />
          {n > 9 && <Grid from={9} to={n} totLbl="IN" label="BACK 9" />}

          <div style={{ background: C.card, borderRadius: 12, marginTop: 8, padding: "8px 11px" }}>
            {board.map((r) => (
              <div key={r.id} style={{ color: C.ink, fontSize: 11.5, padding: "2px 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                <b>{r.name.split(" ")[0]}</b> <span style={{ color: C.faint }}>gross {r.gross} · net {r.net} · {r.pts} pts · GIR {fracPct(r.gir)} · FW {fracPct(r.fw)} · {r.puttsT} putts</span>
              </div>
            ))}
          </div>

          <div style={{ textAlign: "center", color: C.sage, fontSize: 11, marginTop: 14, opacity: 0.85 }}>
            shared from <span style={{ fontFamily: "Georgia, serif", fontWeight: 800, color: C.cream }}>Birdie<span style={{ color: C.gold }}> Num Num</span></span>
          </div>
        </div>

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
