"use client";
/**
 * Profile → YOUR DATA (212.133, owner, Nov 26 2026): "Email me my data" — the member's rounds, holes and games as CSV files,
 * sent to the address on their account (shown, never editable here). Once a day; the card says when it last went and
 * when it can go again. On a server without the mail keys (staging) the button explains instead of failing silently.
 */
import React, { useCallback, useEffect, useState } from "react";
import { C } from "@/lib/golf";
import { Eyebrow, btn } from "@/components/ui";
import { notifyError, notifyInfo } from "@/components/toast";

type Status = { email: string | null; nextAllowedAt: string; canRequest: boolean; configured: boolean; last: { requested_at: string; sent_to: string | null; rounds: number | null; games: number | null } | null };

export function YourData() {
  const [status, setStatus] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/my-data", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Couldn't check.");
      setStatus(body); setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const send = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/my-data", { method: "POST" });
      const body = await res.json();
      if (!res.ok) { notifyError(body?.error || "Couldn't send your data."); }
      else notifyInfo(`Sent to ${body.sentTo}: ${body.counts.rounds} rounds, ${body.counts.games} games. Check your inbox in a minute.`);
      await load();
    } catch (e) { notifyError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const waitUntil = status && !status.canRequest ? new Date(status.nextAllowedAt) : null;
  return (
    <div data-your-data style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${C.borderGreen}` }}>
      <Eyebrow>YOUR DATA</Eyebrow>
      <div style={{ color: C.sage, fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>
        Every round, hole and game of yours as CSV files that open in Excel or Google Sheets — emailed to {status?.email ? <b style={{ color: C.cream }}>{status.email}</b> : "the address on your account"}. Only your own data; nothing from Money.
      </div>
      {err ? <div style={{ color: C.gold, fontSize: 12, marginTop: 8 }}>Couldn’t check your data status: {err} <button type="button" onClick={() => void load()} style={{ background: "transparent", border: "none", padding: 0, color: C.gold, fontWeight: 800, cursor: "pointer", fontSize: 13 }}>Retry</button></div> : null}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 10 }}>
        <button type="button" data-email-my-data style={{ ...btn(true), fontSize: 13, opacity: busy || !status?.canRequest || !status?.configured ? 0.62 : 1 }} disabled={busy || !status || !status.canRequest || !status.configured} onClick={() => void send()}>
          {busy ? "Sending…" : "Email me my data"}
        </button>
        {status && !status.configured ? <span style={{ color: C.sage, fontSize: 11 }}>Email isn’t set up on this server (staging), so nothing is sent here.</span> : null}
        {waitUntil ? <span data-your-data-wait style={{ color: C.sage, fontSize: 11 }}>Once a day — available again {waitUntil.toLocaleDateString(undefined, { month: "short", day: "numeric" })} at {waitUntil.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.</span> : null}
      </div>
      {status?.last ? <div data-your-data-last style={{ color: C.sage, fontSize: 11, marginTop: 8 }}>Last sent {new Date(status.last.requested_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}{status.last.sent_to ? ` to ${status.last.sent_to}` : ""}{status.last.rounds != null ? ` · ${status.last.rounds} rounds, ${status.last.games ?? 0} games` : ""}.</div> : null}
    </div>
  );
}
