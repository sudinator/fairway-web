"use client";

import React, { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { C } from "@/lib/golf";
import { btn, Wordmark } from "@/components/ui";

const supabase = createClient();

export function Login() {
  const signIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };
  return (
    <div style={{ maxWidth: 420, margin: "80px auto", padding: 24, textAlign: "center" }}>
      <div style={{ display: "flex", justifyContent: "center" }}><Wordmark width={300} /></div>
      <div style={{ color: C.sage, fontSize: 15, marginTop: 16 }}>Track your scores, handicap & stats.</div>
      <div style={{ background: C.greenLight, borderRadius: 16, padding: 28, marginTop: 30 }}>
        <button onClick={signIn}
          style={{ ...btn(true), width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "14px" }}>
          <span style={{ background: "#fff", borderRadius: 4, width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#4285F4", fontWeight: 900 }}>G</span>
          Continue with Google
        </button>
        <div style={{ color: C.sage, fontSize: 12, marginTop: 16, lineHeight: 1.5 }}>
          One tap to sign in. Your rounds are private to you — no one else can see them.
        </div>
      </div>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: "100vh", background: C.green }}>{children}</div>;
}

