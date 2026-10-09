"use client";
// Presentational half of the live line-up page (201.0): everything after the fetch. Kept apart from
// the route so it can be mounted in the render harness with a fixture payload and looked at before
// shipping, and so the per-group card and this page cannot drift — both draw from lib/lineup.ts.
import React, { useState } from "react";
import { C } from "@/lib/golf";
import { buildLineup, strokesPhrase, type LineupRow } from "@/lib/lineup";
import { lineupTitle, fmtMatchDate } from "@/lib/lineup-meta";
import { APP_VERSION } from "@/lib/app-version";
import { tint } from "@/lib/team-tint";

// Where the "open the app" button leads depends on the platform, and the page must say the truth:
//   ios-browser  — iOS gives web apps no way to claim their links, so a tap from WhatsApp always lands
//                  in Safari even with the app installed. Navigating from here would open a SECOND copy
//                  of the app in Safari (and trigger the primary-device prompt). The button therefore
//                  gives the instruction instead of navigating.
//   other        — Android WebAPK intercepts in-scope links and opens the installed app; desktop and
//                  the in-app case navigate normally. Both land on the game via /?game=<code>.
export type LineupPlatform = "ios-browser" | "other";
export function detectLineupPlatform(): LineupPlatform {
  try {
    const ua = navigator.userAgent || "";
    const standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || (navigator as any).standalone === true;
    return /iPhone|iPad|iPod/.test(ua) && !standalone ? "ios-browser" : "other";
  } catch { return "other"; }
}

// Team-colour treatment of a row (202.4 options): "bars" = 6px side bars (current); "band" = a light
// red/blue band behind the name row, text stays dark; "frame" = the whole card framed in the team
// colour, body neutral; "chip" = a small RED/BLUE chip beside the name, no colour elsewhere.
export type TeamStyle = "bars" | "band" | "frame" | "chip";
export function LiveLineupView({ data, err, platform = "other", teamStyle = "band" }: { data: any; err: string | null; platform?: LineupPlatform; teamStyle?: TeamStyle }) {
  const [q, setQ] = useState("");
  React.useEffect(() => { try { if (data) document.title = lineupTitle(data); } catch { /* ignore */ } }, [data]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const shell = (inner: React.ReactNode) => (
    // PUBLIC ROUTE RULE (app/globals.css, "live-scroll"): html/body are locked (overflow hidden,
    // body position:fixed) so the installed app never rubber-bands. A page outside .app-shell must
    // therefore be its own scroll container, as /live/[token] is. 201.2 shipped this page without
    // one: nothing scrolled and taps below the fold hit nothing (production, 2026-10-07).
    <div className="live-scroll" style={{ position: "fixed", inset: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", background: C.green, color: C.cream, fontFamily: "-apple-system, Segoe UI, Roboto, sans-serif" }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "16px", paddingTop: "max(16px, env(safe-area-inset-top, 0px))", paddingBottom: "max(16px, env(safe-area-inset-bottom, 0px))" }}>{inner}</div>
    </div>
  );

  if (data === undefined && !err) return shell(<div style={{ color: C.sage, textAlign: "center", marginTop: 40 }}>Loading the line-up…</div>);
  if (err) return shell(<div style={{ color: C.gold, textAlign: "center", marginTop: 40 }}>Couldn't load this line-up: {err}</div>);
  if (data === null) return shell(<div style={{ textAlign: "center", marginTop: 40 }}><div style={{ fontSize: 18, fontWeight: 800 }}>This link isn't active.</div><div style={{ color: C.sage, marginTop: 6 }}>The organizer may have turned sharing off, or the link is wrong.</div></div>);
  if (data.ended) {
    return shell(
      <div style={{ textAlign: "center", marginTop: 40 }}>
        <div style={{ color: C.gold, fontSize: 11, letterSpacing: 2.4, fontWeight: 700 }}>LINE-UP</div>
        <div style={{ fontSize: 19, fontWeight: 800, fontFamily: "Georgia, serif", marginTop: 4 }}>{data.name || "Game"}</div>
        <div style={{ color: C.sage, marginTop: 10, lineHeight: 1.5 }}>This game has finished, so the line-up is no longer shown.<br />Open Birdie Num Num for the results.</div>
        <OpenAppButton code={data.code} platform={platform} />
      </div>
    );
  }

  const lineup = buildLineup(data, data.players || [], data.course_tees || []);
  const pct = lineup.allowancePct;
  const teams: { key: string; name: string }[] = Array.isArray(data.teams) ? data.teams : [];
  const teamColor = (key: string | null) => key == null ? null : key === (teams[0]?.key ?? "A") ? "#B05B5B" : "#5271B0";
  const needle = q.trim().toLowerCase();
  const rows = needle ? lineup.rows.filter((r) => r.name.toLowerCase().includes(needle)) : lineup.rows;
  // Group the rows by foursome/group so a player sees their own group together.
  const groups = new Map<string, LineupRow[]>();
  for (const g of lineup.groups) groups.set(g, []);
  for (const r of rows) { const k = r.group || "Players"; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(r); }
  for (const [k, v] of Array.from(groups.entries())) if (!v.length) groups.delete(k);
  const asOf = data.as_of ? new Date(data.as_of).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : null;

  return shell(
    <>
      <div style={{ textAlign: "center" }}>
        <div style={{ color: C.gold, fontSize: 11, letterSpacing: 2.4, fontWeight: 700 }}>LINE-UP</div>
        <div style={{ fontSize: 21, fontWeight: 800, fontFamily: "Georgia, serif", marginTop: 3 }}>{data.name || "Game"}</div>
        <div style={{ color: C.sage, fontSize: 13, marginTop: 2 }}>{[data.course, fmtMatchDate(data.played_on) || data.played_at].filter(Boolean).join(" · ")}</div>
        {lineup.tees.length ? (
          <div style={{ marginTop: 8, display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            {lineup.tees.map((t) => (
              <span key={t.name} style={{ fontSize: 13, fontWeight: 700 }}>{t.name} tees{t.rating != null ? <span style={{ color: C.sage, fontWeight: 500 }}> · {t.rating} / {t.slope ?? "—"}</span> : null}</span>
            ))}
          </div>
        ) : null}
        {pct !== 100 ? <div style={{ color: C.gold, fontSize: 12, marginTop: 6 }}>{pct}% allowance — Playing Handicap = Course Handicap × {pct / 100}, rounded (.5 up)</div> : null}
        {teams.length ? (
          <div style={{ marginTop: 8, display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
            {teams.map((t) => <span key={t.key} style={{ display: "inline-flex", alignItems: "center", gap: 5, color: C.sage, fontSize: 12 }}><span style={{ width: 14, height: 8, borderRadius: 6, background: teamColor(t.key) as string, display: "inline-block" }} />Team {t.name || t.key}</span>)}
          </div>
        ) : null}
      </div>

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find your name" inputMode="search"
        style={{ width: "100%", boxSizing: "border-box", marginTop: 14, padding: "11px 20px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: C.cream, fontSize: 15 }} />

      {Array.from(groups.entries()).map(([gname, grows]) => (
        <div key={gname} style={{ marginTop: 14 }}>
          {groups.size > 1 || gname !== "Players" ? <div style={{ color: C.gold, fontSize: 11, letterSpacing: 1.6, fontWeight: 800, marginBottom: 6 }}>{gname.toUpperCase()}</div> : null}
          {grows.map((r) => {
            const col = teamColor(r.team);
            const isOpen = !!open[r.key];
            return (
              <div key={r.key} data-lineup-row style={{
                background: C.cell, borderRadius: 10, marginBottom: 6, overflow: "hidden",
                padding: teamStyle === "band" ? 0 : "8px 12px", paddingBottom: teamStyle === "band" ? 8 : undefined,
                borderLeft: teamStyle === "bars" && col ? `6px solid ${col}` : "none",
                borderRight: teamStyle === "bars" && col ? `6px solid ${col}` : "none",
                border: teamStyle === "frame" && col ? `3px solid ${col}` : undefined,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10,
                  ...(teamStyle === "band" ? { background: col ? tint(col) : "transparent", padding: "8px 12px", marginBottom: 2 } : {}) }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: C.green, fontSize: 15, fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
                      {teamStyle === "chip" && col ? <span style={{ background: col, color: "#FBFAF4", fontSize: 11, fontWeight: 800, letterSpacing: 1, padding: "4px 10px", borderRadius: 999 }}>{r.team === (teams[0]?.key ?? "A") ? (teams[0]?.name || "A").toUpperCase() : (teams[1]?.name || "B").toUpperCase()}</span> : null}
                      <span>{r.name}{r.noShow ? <span style={{ color: "#676253", fontWeight: 500 }}> · no-show</span> : null}</span>
                    </div>
                    <div style={{ color: "#676253", fontSize: 12, marginTop: 1 }}>{[r.tee ? `${r.tee} tees` : null, r.teamName].filter(Boolean).join(" · ")}</div>
                  </div>
                  <div style={{ textAlign: "right", flex: "none" }}>
                    <div style={{ color: C.green, fontSize: 19, fontWeight: 800, fontFamily: "Georgia, serif", lineHeight: 1 }}>{r.playingHandicap ?? "—"}</div>
                    <div style={{ color: "#676253", fontSize: 11, letterSpacing: 0.6, marginTop: 2 }}>{pct === 100 ? "COURSE HCP" : "PLAYING HCP"}</div>
                  </div>
                </div>
                {r.contests.map((c, i) => (
                  <div key={i} style={{ marginTop: 6, marginLeft: teamStyle === "band" ? 12 : 0, marginRight: teamStyle === "band" ? 12 : 0, padding: "4px 10px", background: "rgba(0,0,0,0.05)", borderRadius: 6, color: C.green, fontSize: 13 }}>
                    <b>{c.label}</b>{c.partner ? ` with ${c.partner}` : ""} vs {c.opponents.join(" & ")} — <b style={{ color: c.strokes == null ? "#676253" : c.strokes > 0 ? "#2E7D32" : c.strokes < 0 ? "#9E4A4A" : C.green }}>{strokesPhrase(c.strokes)}</b>
                  </div>
                ))}
                {/* The arithmetic toggle is a BUTTON: "Tap for…" was plain text, and the real tap target was
                    the name row above it, which nobody could know (202.3). */}
                <button type="button" onClick={() => setOpen((o) => ({ ...o, [r.key]: !isOpen }))} aria-expanded={isOpen}
                  data-arith-toggle
                  // appearance:none — iOS draws a bordered pill around any <button> otherwise, even with border:none (202.5).
                  style={{ marginTop: 6, marginLeft: teamStyle === "band" ? 12 : 0, background: "transparent", border: "none", WebkitAppearance: "none", appearance: "none", outline: "none", boxShadow: "none", padding: 0, font: "inherit", color: "#676253", fontSize: 12, cursor: "pointer", minHeight: 24, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span aria-hidden style={{ display: "inline-block", width: 14, textAlign: "center", fontSize: 11, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 120ms" }}>▶</span>
                  {isOpen ? "Hide the handicap arithmetic" : "Tap for the handicap arithmetic"}
                </button>
                {isOpen ? (
                  <div style={{ color: "#676253", fontSize: 12, marginTop: 4, marginLeft: teamStyle === "band" ? 12 : 0, marginRight: teamStyle === "band" ? 12 : 0 }}>
                    {r.courseHandicap == null ? `Index ${r.index ?? "—"} · course handicap not set`
                      : pct === 100 ? `Index ${r.index ?? "—"} → Course Handicap ${r.courseHandicap}`
                      : `Index ${r.index ?? "—"} → Course Handicap ${r.courseHandicapExact} × ${pct}% = ${r.playingExact} → plays off ${r.playingHandicap}`}
                    {r.contests.filter((c) => c.strokes).map((c, i) => <div key={i}>{c.label}: {c.basis}</div>)}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}

      <div style={{ textAlign: "center", color: C.sage, fontSize: 12, marginTop: 24, lineHeight: 1.6 }}>
        Live line-up · updates as the organizer changes it{asOf ? ` · as of ${asOf}` : ""}
        <div style={{ marginTop: 10 }}><OpenAppButton code={data.code} platform={platform} /></div>
        <div style={{ marginTop: 10, fontSize: 11, opacity: 0.7 }} data-lineup-version>Birdie Num Num {APP_VERSION}</div>
      </div>
    </>
  );
}

function OpenAppButton({ code, platform }: { code?: string | null; platform: LineupPlatform }) {
  const href = code ? `/?game=${encodeURIComponent(code)}` : "/";
  const style: React.CSSProperties = { display: "inline-block", background: C.gold, color: C.green, fontWeight: 800, padding: "11px 20px", borderRadius: 999, textDecoration: "none" };
  if (platform === "ios-browser") {
    // No navigation: it would open a second copy of the app in Safari. Say what actually works.
    return (
      <div>
        <div style={style} data-open-app="ios-instruction">Open the Birdie Num Num app from your Home Screen</div>
        <div style={{ color: C.sage, fontSize: 12, marginTop: 6 }}>Then go to Games{code ? ` — this game is code ${code}` : ""}. If you haven't installed it, <a href={href} style={{ color: C.gold }}>open it in Safari</a>.</div>
      </div>
    );
  }
  return <a href={href} style={style} data-open-app="navigate">Open in Birdie Num Num</a>;
}
