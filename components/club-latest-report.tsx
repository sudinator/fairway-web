"use client";
// Only an actually published/readable snapshot is a club report; never fabricate an empty-period report.
import React, { useEffect, useMemo, useState } from "react";
import { C } from "@/lib/golf";
import { Eyebrow, btn } from "@/components/ui";
import { createClient } from "@/lib/supabase";
import { failureMessage } from "@/lib/errors";
import { ClubReportView } from "@/components/club-report-view";
import type { ClubReport } from "@/lib/club-report";

export function ClubLatestReport({ groupId, showEmpty = false }: { groupId: string; showEmpty?: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const [r, setR] = useState<ClubReport | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setR(null); setOpen(false); setError(null); setLoading(true);
    void (async () => {
      try {
        const { data, error: readError } = await supabase.from("club_reports").select("snapshot").eq("group_id", groupId).not("snapshot", "is", null)
          .order("published_at", { ascending: false }).limit(1).maybeSingle();
        if (readError) throw readError;
        if (live) setR((data?.snapshot as ClubReport) ?? null);
      } catch (e: any) { if (live) setError(failureMessage("Couldn't load the club report", e)); }
      finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [supabase, groupId, attempt]);
  if (!r) return !showEmpty ? null : <div data-club-report-state style={{ color: C.sage, background: C.greenLight, padding: 16, borderRadius: 12, marginTop: 14, fontSize: 13 }}>
    {loading ? "Loading club report…" : error || "No published club report is available for this club yet."}
    {error && <button type="button" style={{ ...btn(false), marginTop: 10, fontSize: 12 }} onClick={() => setAttempt((a) => a + 1)}>Retry</button>}
  </div>;
  return <div data-club-latest-report style={{ marginTop: 14, marginBottom: 14 }}>
    <Eyebrow>CLUB REPORT · {r.period.label.toUpperCase()}</Eyebrow>
    {open ? <div style={{ marginTop: 8 }}><ClubReportView r={r} /></div> : <button type="button" onClick={() => setOpen(true)} style={{ marginTop: 8, background: C.greenLight, border: "none", borderRadius: 12, padding: "13px 16px", width: "100%", textAlign: "left", color: C.cream, fontSize: 14, cursor: "pointer" }}>
      {r.games} games · {r.rounds} rounds · {r.members} members played — <span style={{ color: C.gold, fontWeight: 800 }}>See the report →</span>
    </button>}
  </div>;
}
