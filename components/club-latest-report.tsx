"use client";
// The club page's latest published report (210.1) — the frozen copy saved when it was published.
import React, { useEffect, useMemo, useState } from "react";
import { C } from "@/lib/golf";
import { Eyebrow } from "@/components/ui";
import { createClient } from "@/lib/supabase";
import { ClubReportView } from "@/components/club-report-view";
import type { ClubReport } from "@/lib/club-report";

export function ClubLatestReport({ groupId }: { groupId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [r, setR] = useState<ClubReport | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    void supabase.from("club_reports").select("snapshot").eq("group_id", groupId).not("snapshot", "is", null)
      .order("published_at", { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => { if (live) setR((data?.snapshot as ClubReport) ?? null); });
    return () => { live = false; };
  }, [supabase, groupId]);
  if (!r) return null;
  return (
    <div data-club-latest-report style={{ marginTop: 14, marginBottom: 14 }}>
      <Eyebrow>CLUB REPORT · {r.period.label.toUpperCase()}</Eyebrow>
      {open ? <div style={{ marginTop: 8 }}><ClubReportView r={r} /></div> : (
        <button type="button" onClick={() => setOpen(true)} style={{ marginTop: 8, background: C.greenLight, border: "none", borderRadius: 12, padding: "13px 16px", width: "100%", textAlign: "left", color: C.cream, fontSize: 14, cursor: "pointer" }}>
          {r.games} games · {r.rounds} rounds · {r.members} members played — <span style={{ color: C.gold, fontWeight: 800 }}>See the report →</span>
        </button>
      )}
    </div>
  );
}
