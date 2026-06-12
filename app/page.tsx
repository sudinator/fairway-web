"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { C } from "@/lib/golf";
import { Login, Shell } from "@/components/auth";
import { Home } from "@/components/home";

const supabase = createClient();

export default function Page() {
  const [session, setSession] = useState<any>(undefined); // undefined = loading
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return <Shell><div style={{ color: C.sage, textAlign: "center", paddingTop: 100 }}>Loading…</div></Shell>;
  }
  if (!session) return <Shell><Login /></Shell>;
  return <Shell><Home session={session} /></Shell>;
}
