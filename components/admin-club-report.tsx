"use client";
// Admin → Club reports (210.0): preview any club's report for any period, from the real games — sends nothing.
import React, { useEffect, useMemo, useState } from "react";
import { C } from "@/lib/golf";
import { inputStyle } from "@/components/ui";
import { createClient } from "@/lib/supabase";
import { buildClubReport, reportPeriods, type ClubReport } from "@/lib/club-report";
import { loadClubGames } from "@/lib/club-report-load";
import { ClubReportView } from "@/components/club-report-view";

export function AdminClubReport() {
  const supabase = useMemo(() => createClient(), []);
  const now = new Date().getFullYear();
  const periods = useMemo(() => [now, now - 1].flatMap((y) => reportPeriods(y)).filter((p) => p.from <= new Date().toISOString().slice(0, 10)), [now]);
  const [clubs, setClubs] = useState<{ id: string; name: string }[]>([]);
  const [club, setClub] = useState(""), [periodKey, setPeriodKey] = useState(periods[periods.length > 1 ? 1 : 0]?.key ?? "");
  const [report, setReport] = useState<ClubReport | null>(null), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => { void supabase.from("groups").select("id, name").eq("status", "active").order("name").then(({ data }) => {
    const list = (data || []) as { id: string; name: string }[]; setClubs(list); if (list[0]) setClub((c) => c || list[0].id); }); }, [supabase]);
  useEffect(() => {
    const p = periods.find((x) => x.key === periodKey), c = clubs.find((x) => x.id === club);
    if (!p || !c) return;
    let live = true; setBusy(true); setErr(null);
    loadClubGames(supabase, c.id, p).then((games) => { if (live) setReport(buildClubReport(c.name, p, games)); })
      .catch((e) => { if (live) setErr(e instanceof Error ? e.message : String(e)); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [supabase, club, periodKey, clubs, periods]);
  return (
    <div data-admin-club-report>
      <div style={{ color: C.sage, fontSize: 12.5, lineHeight: 1.5 }}>
        Preview a club&apos;s report from its real games — nothing is sent. Reports are published on July 1 (January–June) and October 1 (July–September); the whole year is Season Wrapped.
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <select value={club} onChange={(e) => setClub(e.target.value)} style={{ ...inputStyle, width: "auto", flex: 1, minWidth: 160 }}>
          {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={periodKey} onChange={(e) => setPeriodKey(e.target.value)} style={{ ...inputStyle, width: "auto", flex: 1, minWidth: 160 }}>
          {periods.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </div>
      <div style={{ marginTop: 14 }}>
        {err ? <div style={{ color: C.gold, fontSize: 13 }}>Couldn&apos;t build the report: {err}</div> : busy && !report ? <div style={{ color: C.sage, fontSize: 13 }}>Building the report…</div> : report ? <ClubReportView r={report} /> : null}
      </div>
    </div>
  );
}
