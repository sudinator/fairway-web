"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { C } from "@/lib/golf";
import { Login, Shell } from "@/components/auth";
import { saveLastSession, loadLastSession } from "@/lib/draft";
import { Home } from "@/components/home";

const supabase = createClient();

export default function Page() {
  const [session, setSession] = useState<any>(undefined); // undefined = loading
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (data.session) { setSession(data.session); saveLastSession(data.session.user); }
      else if (typeof navigator !== "undefined" && navigator.onLine === false) {
        // Offline cold launch: fall back to the cached identity so a mid-round
        // reopen with no signal lands in the app instead of the login screen.
        const cached = loadLastSession();
        setSession(cached ? { ...cached, offline: true } : null);
      } else setSession(null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (s) { setSession(s); saveLastSession(s.user); }
      else if (typeof navigator === "undefined" || navigator.onLine) setSession(null);
      // Ignore offline null events so we never sign out a user mid-round.
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  if (session === undefined) {
    return <Shell><div style={{ color: C.sage, textAlign: "center", paddingTop: 100 }}>Loading…</div></Shell>;
  }
  if (!session) return <Shell><Login /></Shell>;
  return <Shell><Home session={session} /></Shell>;
}
