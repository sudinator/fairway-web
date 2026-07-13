"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { C } from "@/lib/golf";
import { Login } from "@/components/auth";
import { OrganizerConsole } from "@/components/organizer";

const supabase = createClient();

// Desktop-only organizer. Same-origin route, so it shares the app's Supabase session: create a
// game on the phone, then open birdienumnum…/organize/<id> on a laptop to set it up.
export default function OrganizePage() {
  const params = useParams();
  const gameId = String((params as any)?.gameId || "");
  const [session, setSession] = useState<any>(undefined); // undefined = loading
  const [wide, setWide] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => { if (mounted) setSession(data.session || null); });
    const sub = supabase.auth.onAuthStateChange((_e, s) => { if (mounted) setSession(s); });
    return () => { mounted = false; sub.data.subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const full: React.CSSProperties = { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.green, color: C.cream, padding: 24, textAlign: "center", lineHeight: 1.5 };

  if (session === undefined) return <div style={full}>Loading…</div>;
  if (!session) return <Login />;
  if (!wide) return (
    <div style={full}>
      <div style={{ maxWidth: 320 }}>
        <div style={{ fontFamily: "Georgia, serif", fontSize: 20, fontWeight: 800, marginBottom: 10 }}>Open on a larger screen</div>
        <div style={{ color: C.sage, fontSize: 14 }}>The organizer console is built for a desktop or tablet. On your phone, set up and score the game in the app as usual.</div>
      </div>
    </div>
  );
  return <OrganizerConsole gameId={gameId} />;
}
