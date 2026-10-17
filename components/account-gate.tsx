"use client";
// The screens a new or held account sees before the app (208.0) — from the approved mock.
//   * "Is this you?"         a first sign-in whose name matches a member (masked email shown)
//   * "Waiting for approval" no invite, or held as a possible duplicate
//   * "This account can't be used" merged / removed / suspended
import React, { useState } from "react";
import { C } from "@/lib/golf";
import { btn, Wordmark } from "@/components/ui";
import { createClient } from "@/lib/supabase";
import { switchGoogleAccount } from "@/lib/google-sign-in";

export type AccountGateState =
  | { state: "possible_duplicate"; match_name?: string | null; match_email?: string | null; signed_in_as?: string | null }
  | { state: "pending"; kind?: string | null; signed_in_as?: string | null; club?: string | null }
  | { state: "blocked"; reason?: "suspended" | "merged" | "removed" | null };

const wrap: React.CSSProperties = { maxWidth: 440, margin: "0 auto", padding: "16px", paddingTop: 56, paddingBottom: 56, display: "flex", flexDirection: "column", gap: 14 };
const h2: React.CSSProperties = { color: C.cream, fontFamily: "Georgia, serif", fontSize: 24, fontWeight: 800, lineHeight: 1.2, margin: 0 };
const p: React.CSSProperties = { color: C.sage, fontSize: 14.5, lineHeight: 1.55, margin: 0 };
const card: React.CSSProperties = { background: C.greenLight, borderRadius: 12, padding: "13px 16px", color: C.cream, fontSize: 14.5, lineHeight: 1.5 };

export function IsThisYou({ gate, onNotMe }: { gate: Extract<AccountGateState, { state: "possible_duplicate" }>; onNotMe: () => void }) {
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const notMe = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("acknowledge_not_duplicate");
    setBusy(false);
    if (error) { alert(`Couldn't send that: ${error.message}`); return; }
    onNotMe();
  };
  return (
    <div data-gate="is-this-you" style={wrap}>
      <Wordmark width={180} />
      <h2 style={h2}>Is this you?</h2>
      <p style={p}>You just signed in with a Google account that&apos;s new to Birdie Num Num. There&apos;s already a member with your name:</p>
      <div style={card}><b>{gate.match_name || "A member"}</b><br /><span style={{ color: C.sage }}>signs in with {gate.match_email || "another Google account"}</span></div>
      <p style={p}>If that&apos;s you, sign in with that Google account instead — your rounds, games and clubs are there.</p>
      <button type="button" style={{ ...btn(true), fontSize: 15 }} onClick={() => switchGoogleAccount()}>Switch Google account</button>
      <button type="button" style={{ ...btn(false), fontSize: 15 }} disabled={busy} onClick={notMe}>{busy ? "Sending…" : "That's not me"}</button>
      {gate.signed_in_as ? <div style={{ color: C.sage, fontSize: 12.5 }}>Signed in now as {gate.signed_in_as}</div> : null}
    </div>
  );
}

export function WaitingForApproval({ gate }: { gate: Extract<AccountGateState, { state: "pending" }> }) {
  return (
    <div data-gate="waiting" style={wrap}>
      <Wordmark width={180} />
      <h2 style={h2}>Waiting for approval</h2>
      <p style={p}>Thanks for signing up. An admin will add you to {gate.club || "your club"} — you&apos;ll get a notification as soon as you&apos;re in.</p>
      {gate.signed_in_as ? <div style={card}><span style={{ color: C.sage }}>Signed in as</span><br /><b>{gate.signed_in_as}</b></div> : null}
      <p style={p}>Joining a club you&apos;ve been invited to? Open the invite link your organizer sent and you&apos;ll be in straight away.</p>
      <button type="button" style={{ ...btn(false), fontSize: 15 }} onClick={() => switchGoogleAccount()}>Use a different Google account</button>
      <div style={{ color: C.sage, fontSize: 12.5 }}>Questions? Ask the person who told you about Birdie Num Num.</div>
    </div>
  );
}

export function AccountUnavailable({ reason }: { reason?: string | null }) {
  const suspended = reason === "suspended";
  return (
    <div data-gate="unavailable" style={{ ...wrap, textAlign: "center" }}>
      <div style={{ fontSize: 40 }}>{suspended ? "🚫" : "🔁"}</div>
      <h2 style={h2}>{suspended ? "Account suspended" : "This account isn't used any more"}</h2>
      <p style={p}>{suspended
        ? "Your access to Birdie Num Num has been suspended. If you think this is a mistake, contact the app administrator."
        : "This Google account is no longer used for Birdie Num Num. Sign in with the Google account you normally use — your rounds and clubs are there."}</p>
      {!suspended ? <button type="button" style={{ ...btn(true), fontSize: 15 }} onClick={() => switchGoogleAccount()}>Sign in with another Google account</button> : null}
    </div>
  );
}
