"use client";
// The live line-up page (201.0). Opened from a chat link, no login. Reads get_live_lineup(token)
// through the anon client, computes playing handicaps and strokes with lib/lineup.ts — the same
// arithmetic as the scorecard — and refreshes itself every 25 seconds and on return to the tab,
// so a pairing the organizer swaps at 7:40 is on the chat link at 7:41. Once the game is ended the
// read returns {ended:true} and this page says so instead of showing a stale line-up.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { LiveLineupView, detectLineupPlatform, type LineupPlatform } from "@/components/lineup-view";

type Payload = any;

export default function LiveLineupPage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "");
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState<Payload | null | undefined>(undefined); // undefined = loading, null = unknown token
  const [err, setErr] = useState<string | null>(null);
  const [platform, setPlatform] = useState<LineupPlatform>("other");
  useEffect(() => { setPlatform(detectLineupPlatform()); }, []);

  const load = useCallback(async () => {
    try {
      const { data: res, error } = await supabase.rpc("get_live_lineup", { p_token: token });
      if (error) { setErr(error.message); return; }
      setData(res ?? null); setErr(null);
    } catch (e: any) { setErr(e?.message || "Could not load"); }
  }, [supabase, token]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 25000);
    const onVis = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  return <LiveLineupView data={data} err={err} platform={platform} />;
}
