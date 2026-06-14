"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  C, Round, Hole, courseHandicap, strokesReceived, allocateStrokes, stablefordPts, validateStrokeIndexes,
  played, strokesOf, diffOf, puttsOf, pensOf, ptsOf, toParStr, fmtDate, isGrossOnly, hasHoleDetail,
  girStats, firStats, pct, fracPct, holeBuckets, avgByPar, roundDifferential, runningHandicap, threePuttsPerRound, estimatedStablefordPts, hasEstimatedStableford, stablefordDisplay, adjustedHoleScore, puttDistribution,
} from "@/lib/golf";
import { aiUsesLeft, recordAiUse, AI_DAILY_LIMIT_VALUE } from "@/lib/draft";
import { createClient } from "@/lib/supabase";

const supabase = createClient();
import { btn, inputStyle, Eyebrow, StatCard, NumPicker, ScoreEntryCard, ScoreViewCard, Wordmark } from "@/components/ui";

export function RoundDetail({ round, ghinNumber, playerName, priorRounds, userEmail, onBack, onEdit, onDelete }: {
  round: Round; ghinNumber?: string | null; playerName?: string; priorRounds?: Round[]; userEmail?: string | null; onBack: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const gross = isGrossOnly(round);
  const [showGhin, setShowGhin] = useState(false);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button style={btn(false)} onClick={onBack}>‹ Back</button>
        <div>
          <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 700 }}>
            {round.course}{round.tee_name ? ` · ${round.tee_name}` : ""}
          </div>
          <div style={{ color: C.sage, fontSize: 13 }}>
            {fmtDate(round.played_at)} · {strokesOf(round)} ({toParStr(diffOf(round))})
            {gross ? ` · ${stablefordDisplay(round)} · total score only${round.course_handicap != null ? ` · CH ${round.course_handicap}` : ""}` : ` · ${stablefordDisplay(round)}${round.course_handicap != null ? ` · CH ${round.course_handicap}` : ""} · GIR ${fracPct(girStats([round]))} · FW ${fracPct(firStats([round]))} · ${puttsOf(round)} putts · ${pensOf(round)} pen`}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button style={btn(true)} onClick={() => setShowGhin((v) => !v)}>{showGhin ? "Hide GHIN" : "Post to GHIN"}</button>
        <button style={btn(false)} onClick={onEdit}>Edit round</button>
        <button style={{ ...btn(false), background: "#7A2F28" }}
          onClick={() => { if (confirm("Delete this round?")) onDelete(); }}>Delete</button>
      </div>


      {showGhin && <GhinPanel round={round} ghinNumber={ghinNumber} playerName={playerName} />}

      {gross ? (
        <div style={{ background: C.greenLight, borderRadius: 14, padding: 20, marginTop: 14 }}>
          <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 40, fontWeight: 800 }}>{round.gross_score}</div>
          <div style={{ color: C.sage, fontSize: 13, marginTop: 4 }}>
            Total score · {toParStr(diffOf(round))} vs par{round.rating != null && round.slope != null ? ` · differential ${roundDifferential(round)?.toFixed(1) ?? "—"}` : ""}
          </div>
          <div style={{ color: C.sage, fontSize: 12, marginTop: 12 }}>
            This round was logged as a total only — it counts toward your handicap and scoring average. Stableford is estimated from total score, par, and course handicap. Add hole-by-hole detail to get exact Stableford, GIR, putts, and par-type stats.
          </div>
          <button style={{ ...btn(true), marginTop: 12 }} onClick={onEdit}>＋ Add hole-by-hole detail</button>
        </div>
      ) : (
        <>
          <RoundStats round={round} />
          <AiAnalysis round={round} priorRounds={priorRounds || []} userEmail={userEmail} />
          <div style={{ marginTop: 14 }}><ScoreViewCard round={round} /></div>
        </>
      )}
    </div>
  );
}

// Assisted GHIN posting (Tier 2): formats the round for quick manual entry in the GHIN app/site.
// Posting hole-by-hole lets GHIN apply net double bogey automatically; for a total-only round we
// supply the already-adjusted total so the user doesn't have to do the math.
function GhinPanel({ round, ghinNumber, playerName }: { round: Round; ghinNumber?: string | null; playerName?: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const detail = hasHoleDetail(round);

  // Per-hole gross + net-double-bogey-adjusted figures (only for hole-by-hole rounds).
  const holeRows = detail
    ? played(round).map((h) => ({ n: h.hole_number, par: h.par, gross: h.strokes ?? 0, adj: adjustedHoleScore(h) ?? h.strokes ?? 0 }))
    : [];
  const grossTotal = detail ? holeRows.reduce((s, r) => s + r.gross, 0) : (round.gross_score || 0);
  const adjTotal = detail ? holeRows.reduce((s, r) => s + r.adj, 0) : (round.gross_score || 0);

  const holesLine = detail ? holeRows.map((r) => r.gross).join(", ") : "";
  const copy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(null), 1500); }).catch(() => {});
  };

  const summary = [
    playerName ? `Player: ${playerName}` : "",
    ghinNumber ? `GHIN #: ${ghinNumber}` : "",
    `Course: ${round.course}${round.tee_name ? ` (${round.tee_name})` : ""}`,
    round.rating != null && round.slope != null ? `Rating/Slope: ${round.rating} / ${round.slope}` : "",
    `Date: ${fmtDate(round.played_at)}`,
    `Holes: ${detail ? holeRows.length : 18}`,
    detail ? `Hole-by-hole: ${holesLine}` : "",
    detail ? `Gross total: ${grossTotal}` : `Total score: ${grossTotal}`,
    `Adjusted gross (net dbl bogey): ${adjTotal}`,
  ].filter(Boolean).join("\n");

  const field = (label: string, value: string, key: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: `1px solid ${C.greenMid}` }}>
      <div style={{ color: C.cream, opacity: 0.85, fontSize: 13, width: 120 }}>{label}</div>
      <div style={{ color: "#FFFFFF", fontSize: 15, fontWeight: 800, flex: 1 }}>{value}</div>
      <button style={{ ...btn(false), fontSize: 11, padding: "4px 10px" }} onClick={() => copy(key, value)}>{copied === key ? "✓ Copied" : "Copy"}</button>
    </div>
  );

  return (
    <div style={{ background: C.greenLight, borderRadius: 14, padding: 16, marginTop: 14 }}>
      <Eyebrow>POST THIS ROUND TO GHIN</Eyebrow>

      {/* Recommended: one-number total post — fastest, no hole-by-hole typing. */}
      <div style={{ background: C.green, borderRadius: 12, padding: 16, marginTop: 10 }}>
        <div style={{ color: "#FFE08A", fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>FASTEST · POST AS A TOTAL SCORE</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
          <div style={{ color: "#FFFFFF", fontFamily: "Georgia, serif", fontSize: 46, fontWeight: 800, lineHeight: 1 }}>{adjTotal}</div>
          <div style={{ color: C.cream, fontSize: 13 }}>adjusted gross<br/>(net double bogey applied)</div>
          <div style={{ flex: 1 }} />
          <button style={{ ...btn(true), fontSize: 14 }} onClick={() => copy("adj", String(adjTotal))}>{copied === "adj" ? "✓ Copied" : "Copy number"}</button>
        </div>
        <div style={{ color: C.cream, fontSize: 12, marginTop: 10, lineHeight: 1.5 }}>
          In the GHIN app, choose <b>Post Score → Total Score</b>, pick the course/date, and enter this one number. That's it — one field, no hole-by-hole entry.
        </div>
      </div>

      {/* Round details, all high-contrast. */}
      <div style={{ background: C.card, borderRadius: 10, padding: "4px 14px", marginTop: 12 }}>
        {playerName ? field("Player", playerName, "name") : null}
        {ghinNumber ? field("GHIN #", String(ghinNumber), "ghin") : null}
        {field("Course", `${round.course}${round.tee_name ? ` (${round.tee_name})` : ""}`, "course")}
        {round.rating != null && round.slope != null ? field("Rating / Slope", `${round.rating} / ${round.slope}`, "rs") : null}
        {field("Date", fmtDate(round.played_at), "date")}
        {detail ? field("Gross total", String(grossTotal), "gross") : null}
      </div>

      {!ghinNumber && (
        <div style={{ color: "#FFC9C2", fontSize: 12, marginTop: 10 }}>
          Tip: add your GHIN number in your Profile and it'll show here for easy reference.
        </div>
      )}

      {detail && (
        <div style={{ marginTop: 14 }}>
          <div style={{ color: C.cream, fontSize: 11, fontWeight: 800, letterSpacing: 1, marginBottom: 6 }}>
            PREFER HOLE-BY-HOLE? READ THESE OFF AS YOU TYPE
          </div>
          <div style={{ overflowX: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${holeRows.length}, 1fr)`, gap: 4, minWidth: holeRows.length * 34 }}>
              {holeRows.map((r) => <div key={r.n} style={{ color: C.cream, opacity: 0.8, fontSize: 10, textAlign: "center", fontWeight: 700 }}>{r.n}</div>)}
              {holeRows.map((r) => <div key={r.n} style={{ color: "#16201C", background: C.cream, fontSize: 17, fontWeight: 800, textAlign: "center", borderRadius: 5, padding: "6px 0" }}>{r.gross}</div>)}
            </div>
          </div>
          <div style={{ color: C.cream, fontSize: 11, marginTop: 6, opacity: 0.85 }}>
            GHIN's hole-by-hole screen has a separate box per hole, so these are typed in one at a time — the big numbers above are easy to read while you do. (No app can paste all 18 into GHIN at once; only the Total Score above is a single field.)
          </div>
        </div>
      )}

      <button style={{ ...btn(false), marginTop: 14, fontSize: 12 }} onClick={() => copy("all", summary)}>{copied === "all" ? "✓ Copied full summary" : "Copy full summary (for notes/text)"}</button>
    </div>
  );
}

// Per-round stats summary: putt distribution (1-putts, 3+-putts) and scoring
// breakdown (pars, bogeys, doubles-or-worse), shown above the scorecard.
function RoundStats({ round }: { round: Round }) {
  const b = holeBuckets([round]);
  const pd = puttDistribution([round]);
  const gir = girStats([round]);
  const fir = firStats([round]);
  const stat = (label: string, value: string | number, hint?: string, size = 22) => (
    <div style={{ flex: "1 1 80px", background: C.greenLight, borderRadius: 10, padding: "10px 12px", minWidth: 80 }}>
      <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: size, fontWeight: 800 }}>{value}</div>
      <div style={{ color: C.sage, fontSize: 11, marginTop: 2 }}>{label}</div>
      {hint ? <div style={{ color: C.faint, fontSize: 10, marginTop: 1 }}>{hint}</div> : null}
    </div>
  );
  return (
    <div style={{ marginTop: 14 }}>
      <Eyebrow>GREENS & FAIRWAYS</Eyebrow>
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        {stat("Greens in reg.", gir.total ? `${gir.hit}/${gir.total} · ${pct(gir)}` : "—", undefined, 19)}
        {stat("Fairways hit", fir.total ? `${fir.hit}/${fir.total} · ${pct(fir)}` : "—", undefined, 19)}
      </div>
      <div style={{ marginTop: 14 }}><Eyebrow>PUTTING</Eyebrow></div>
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        {stat("Total putts", pd.withPutts ? pd.total : "—")}
        {stat("1-putts", pd.withPutts ? pd.one : "—", pd.withPutts ? `of ${pd.withPutts} holes` : "")}
        {stat("3+ putts", pd.withPutts ? pd.three : "—", pd.withPutts ? `of ${pd.withPutts} holes` : "")}
      </div>
      <div style={{ marginTop: 14 }}><Eyebrow>SCORING</Eyebrow></div>
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        {stat("Eagles+", b.eagle)}
        {stat("Birdies", b.birdie)}
        {stat("Pars", b.par)}
        {stat("Bogeys", b.bogey)}
        {stat("Double+", b.double, "dbl bogey or worse")}
      </div>
    </div>
  );
}

// Compact, numbers-only summary of a round for the AI coach (keeps the payload
// small and the analysis grounded in real stats).
function roundSummary(r: Round) {
  const b = holeBuckets([r]);
  const pd = puttDistribution([r]);
  return {
    date: fmtDate(r.played_at),
    course: r.course,
    handicapIndex: r.handicap_index ?? null,
    score: strokesOf(r),
    toPar: toParStr(diffOf(r)),
    putts: pd.withPutts ? pd.total : null,
    onePutts: pd.withPutts ? pd.one : null,
    threePuttsPlus: pd.withPutts ? pd.three : null,
    gir: fracPct(girStats([r])),
    fairways: fracPct(firStats([r])),
    eagles: b.eagle, birdies: b.birdie, pars: b.par, bogeys: b.bogey, doublesOrWorse: b.double,
  };
}

// AI coach: analyzes this round vs. prior rounds. Calls our server route, which
// keeps the API key secret. Opt-in (button) so it only runs when the user wants it.
function AiAnalysis({ round, priorRounds, userEmail }: { round: Round; priorRounds: Round[]; userEmail?: string | null }) {
  // The app owner's account is exempt from the daily cap (for testing).
  const UNLIMITED_EMAIL = "amitsud@gmail.com";
  const unlimited = (userEmail || "").trim().toLowerCase() === UNLIMITED_EMAIL;
  // If this round already has a saved analysis, show it straight away.
  const saved = (round.ai_analysis || "").trim();
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">(saved ? "done" : "idle");
  const [text, setText] = useState(saved);
  const [err, setErr] = useState("");
  const [left, setLeft] = useState<number>(AI_DAILY_LIMIT_VALUE);
  useEffect(() => { setLeft(aiUsesLeft()); }, []);

  const run = async () => {
    if (!unlimited && aiUsesLeft() <= 0) { setErr(`You've used your ${AI_DAILY_LIMIT_VALUE} AI analyses for today. Try again tomorrow.`); setState("error"); return; }
    setState("loading"); setErr("");
    try {
      const history = priorRounds
        .filter((r) => hasHoleDetail(r))
        .slice(0, 10)
        .map(roundSummary);
      const resp = await fetch("/api/analyze-round", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current: roundSummary(round), history }),
      });
      const data = await resp.json();
      if (!resp.ok) { setErr(data.error || "Couldn't analyze this round."); setState("error"); return; }
      if (!unlimited) { recordAiUse(); setLeft(aiUsesLeft()); }
      const analysis = data.analysis || "";
      setText(analysis); setState("done");
      // Persist on the round so it survives navigating away / reopening / other devices.
      if (analysis && round.id) {
        supabase.from("rounds").update({ ai_analysis: analysis }).eq("id", round.id).then(() => {});
        round.ai_analysis = analysis; // keep the in-memory object in sync this session
      }
    } catch {
      setErr("Couldn't reach the analysis service. Check your connection and try again.");
      setState("error");
    }
  };

  const noneLeft = !unlimited && left <= 0;
  return (
    <div style={{ marginTop: 16, background: C.greenLight, borderRadius: 14, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Eyebrow>AI COACH</Eyebrow>
        <div style={{ flex: 1 }} />
        {state !== "loading" && !noneLeft && (
          <button style={{ ...btn(true), fontSize: 12 }} onClick={run}>
            {state === "done" ? "↻ Re-analyze" : "✦ Analyze this round"}
          </button>
        )}
      </div>
      {state === "idle" && !noneLeft && (
        <div style={{ color: C.sage, fontSize: 12, marginTop: 8 }}>
          Get a quick read on what went well and what to work on — compared to your recent rounds and your handicap level.{unlimited ? " (unlimited)" : ` (${left} left today)`}
        </div>
      )}
      {noneLeft && state !== "done" && (
        <div style={{ color: C.sage, fontSize: 12, marginTop: 8 }}>
          You've used your {AI_DAILY_LIMIT_VALUE} AI analyses for today. Come back tomorrow for more.
        </div>
      )}
      {state === "loading" && (
        <div style={{ color: C.gold, fontSize: 13, marginTop: 10 }}>Analyzing your round…</div>
      )}
      {state === "error" && (
        <div style={{ color: "#E8A199", fontSize: 13, marginTop: 10 }}>{err}</div>
      )}
      {state === "done" && (
        <>
          <div style={{ color: C.cream, fontSize: 14, marginTop: 10, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{text}</div>
          <div style={{ color: C.faint, fontSize: 11, marginTop: 10 }}>AI-generated from your round stats{unlimited ? "" : ` · ${left} analyses left today`}</div>
        </>
      )}
    </div>
  );
}
