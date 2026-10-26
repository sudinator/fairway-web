"use client";
/**
 * 212.41 — ONE-STEP GAME CREATION, PHASE 3: the pieces of the new Create flow (scramble first). Presentational only:
 * the Create screen owns the draft and calls create_game_complete (0219). Shown in the design gallery for the owner's
 * approval before the flow is wired in.
 */
import React from "react";
import { C } from "@/lib/golf";
import { btn } from "@/components/ui";

/** Players step: what this many players makes in the chosen format. */
export function PlayerCountHint({ hint }: { hint: { text: string; ok: boolean } | null }) {
  if (!hint) return null;
  return (
    <div data-player-count-hint style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, background: C.greenLight, borderRadius: 10, padding: "8px 12px", border: `1px solid ${hint.ok ? C.borderGreen : C.gold}` }}>
      <span style={{ color: hint.ok ? "#5BD08A" : C.gold, fontWeight: 800 }}>{hint.ok ? "✓" : "!"}</span>
      <span style={{ color: C.cream, fontSize: 12.5, lineHeight: 1.45 }}>{hint.text}</span>
    </div>
  );
}

export type ReviewLine = { ok: boolean; label: string; value: string };
/** Review step: everything that will be saved, and the two ways to create. Nothing is saved before this. */
export function OneStepReview({ lines, problem, busy, onCreate, onCreateLater, onCancel }: {
  lines: ReviewLine[]; problem: string | null; busy: boolean;
  onCreate: () => void; onCreateLater: () => void; onCancel: () => void;
}) {
  const ready = lines.every((l) => l.ok) && !problem;
  return (
    <div data-one-step-review>
      <div style={{ background: C.greenLight, borderRadius: 12, padding: 14, border: `1px solid ${C.borderGreen}` }}>
        {lines.map((l, i) => (
          <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 12px", borderBottom: i < lines.length - 1 ? "1px solid rgba(255,255,255,.08)" : "none" }}>
            <span style={{ color: l.ok ? "#5BD08A" : C.gold, fontWeight: 800 }}>{l.ok ? "✓" : "!"}</span>
            <span style={{ color: C.sage, fontSize: 12, minWidth: 76 }}>{l.label}</span>
            <span style={{ color: C.cream, fontSize: 12.5, fontWeight: 700, marginLeft: "auto", textAlign: "right" }}>{l.value}</span>
          </div>
        ))}
      </div>
      {problem ? <div data-one-step-problem style={{ color: C.gold, fontSize: 12.5, lineHeight: 1.45, marginTop: 10 }}>{problem}</div> : null}
      <div style={{ color: C.sage, fontSize: 11.5, lineHeight: 1.45, marginTop: 10 }}>
        <b style={{ color: C.cream }}>Create game</b> saves everything at once and tells each player their team and group.{" "}
        <b style={{ color: C.cream }}>Save draft</b> keeps it to yourself — players can&apos;t see it until you send it.
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button style={btn(false)} onClick={onCancel} disabled={busy}>Cancel</button>
        <button data-save-draft style={btn(false)} onClick={onCreateLater} disabled={busy}>Save draft</button>
        <button style={{ ...btn(true), flex: 1, opacity: ready && !busy ? 1 : 0.62 }} disabled={!ready || busy} onClick={onCreate}>
          {busy ? "Saving…" : "Create game"}
        </button>
      </div>
    </div>
  );
}

/** Manage Game, while the game is a saved draft: only the organizer sees it; one tap sends it to every player. */
export function DraftBanner({ onSend }: { onSend: () => Promise<void> }) {
  const [busy, setBusy] = React.useState(false), [failed, setFailed] = React.useState<string | null>(null);
  return (
    <div data-draft-banner style={{ background: C.greenLight, border: `1px solid ${C.gold}`, borderRadius: 12, padding: "13px 16px", marginBottom: 12 }}>
      <div style={{ color: C.gold, fontWeight: 800, fontSize: 11, letterSpacing: 1 }}>DRAFT</div>
      <div style={{ color: C.cream, fontSize: 13, lineHeight: 1.45, marginTop: 4 }}>Only you can see this game. Players aren&apos;t told — and can&apos;t see it — until you send it.</div>
      {failed ? <div style={{ color: C.gold, fontSize: 12, marginTop: 6 }}>{failed}</div> : null}
      <button disabled={busy} onClick={async () => { setBusy(true); setFailed(null); try { await onSend(); } catch (e) { setFailed(e instanceof Error ? e.message : "Couldn't send it — try again."); } finally { setBusy(false); } }}
        style={{ ...btn(true), marginTop: 10, fontSize: 13, opacity: busy ? 0.62 : 1 }}>{busy ? "Sending…" : "Send to players"}</button>
    </div>
  );
}

/** Manage Game → Review (owner, Oct 25): the game's two public links — the line-up and live scores. They are ONE switch
 * (set_game_share): turning sharing on makes both, stopping turns both off. Never offered for a draft. */
export function ShareLinks({ lineupToken, liveToken, onShare }: { lineupToken: string | null; liveToken: string | null; onShare: (on: boolean) => Promise<void> }) {
  const [busy, setBusy] = React.useState(false), [failed, setFailed] = React.useState<string | null>(null), [copied, setCopied] = React.useState<string | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const links = liveToken ? [
    { key: "lineup", label: "Line-up link", note: "Who's playing, their tees, handicaps and teams", url: `${origin}/lineup/${lineupToken ?? liveToken}` },
    { key: "live", label: "Live scores link", note: "The scorecard and leaderboard as they happen", url: `${origin}/live/${liveToken}` },
  ] : [];
  const toggle = async (on: boolean) => { setBusy(true); setFailed(null); try { await onShare(on); } catch (e) { setFailed(e instanceof Error ? e.message : "Couldn't update the links — try again."); } finally { setBusy(false); } };
  const share = async (label: string, url: string) => {
    const nav = navigator as Navigator & { share?: (d: { title: string; url: string }) => Promise<void> };
    if (nav.share) { try { await nav.share({ title: label, url }); } catch { /* closed */ } return; }
    try { await nav.clipboard.writeText(url); setCopied(url); setTimeout(() => setCopied(null), 1500); } catch { /* copy by hand */ }
  };
  return (
    <div data-share-links>
      <div style={{ color: C.cream, fontWeight: 800, fontSize: 14, marginBottom: 4 }}>Share links</div>
      <div style={{ color: C.sage, fontSize: 11.5, lineHeight: 1.45, marginBottom: 8 }}>Anyone with a link can follow along — no login, read only. One switch turns both on or off.</div>
      {failed ? <div style={{ color: C.gold, fontSize: 12, marginBottom: 8 }}>{failed}</div> : null}
      {!links.length ? (
        <button disabled={busy} onClick={() => toggle(true)} style={{ ...btn(true), width: "100%", fontSize: 13, opacity: busy ? 0.62 : 1 }}>{busy ? "Making the links…" : "Turn on the share links"}</button>
      ) : (
        <>
          {links.map((l) => (
            <div key={l.key} data-share-link={l.key} style={{ padding: "8px 12px", borderTop: "1px solid rgba(255,255,255,.08)" }}>
              <div style={{ color: C.cream, fontWeight: 700, fontSize: 13 }}>{l.label}</div>
              <div style={{ color: C.sage, fontSize: 11 }}>{l.note}</div>
              <div style={{ color: C.sage, fontSize: 11, marginTop: 4, wordBreak: "break-all" }}>{l.url}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <button onClick={() => share(l.label, l.url)} style={{ ...btn(true), fontSize: 12, padding: "8px 12px" }}>Share</button>
                <button onClick={async () => { try { await navigator.clipboard.writeText(l.url); setCopied(l.url); setTimeout(() => setCopied(null), 1500); } catch { /* copy by hand */ } }} style={{ ...btn(false), fontSize: 12, padding: "8px 12px", border: `1px solid ${C.sage}` }}>{copied === l.url ? "Copied" : "Copy"}</button>
              </div>
            </div>
          ))}
          <button disabled={busy} onClick={() => toggle(false)} style={{ background: "transparent", color: C.overRedDark, border: "0.5px solid #7A3A34", borderRadius: 8, padding: "8px 12px", fontWeight: 700, cursor: "pointer", marginTop: 8, fontSize: 12 }}>
            {busy ? "…" : "Stop sharing (turns off both links)"}
          </button>
        </>
      )}
    </div>
  );
}
