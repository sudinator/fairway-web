"use client";
import React, { useCallback, useState } from "react";
import { C } from "@/lib/golf";
import type { AppGroup } from "@/lib/groups";
import type { ClubDirectorySummary } from "@/lib/club-directory";
import { PlayersTab } from "@/components/manage";
import { GroupsPanel } from "@/components/groups";
import { ClubEngagement } from "@/components/club-engagement";
import { ClubLatestReport } from "@/components/club-latest-report";
import { ClubPendingSignups } from "@/components/club-pending-signups";
import { useNowTick } from "@/lib/use-now-tick";
import { btn, Eyebrow } from "@/components/ui";

type Props = { user: any; groups: AppGroup[]; activeGroupId: string | null; onGroupsChanged: () => Promise<void> | void;
  onActiveGroupChange: (id: string) => void; onGroupDeleted?: () => Promise<void> | void; initialPane?: "members" | "settings" };
export function ClubHub({ user, groups, activeGroupId, onGroupsChanged, onActiveGroupChange, onGroupDeleted, initialPane = "members" }: Props) {
  const active = groups.find((g) => g.id === activeGroupId) || groups[0] || null;
  // Keying the active club discards old club data, searches, modals and role-derived controls immediately.
  return <ClubHubContent key={`${active?.id || "none"}:${initialPane}`} {...{ user, groups, activeGroupId, onGroupsChanged, onActiveGroupChange, onGroupDeleted, initialPane }} />;
}
function ClubHubContent({ user, groups, activeGroupId, onGroupsChanged, onActiveGroupChange, onGroupDeleted, initialPane = "members" }: Props) {
  const active = groups.find((g) => g.id === activeGroupId) || groups[0] || null;
  const admin = active?.role === "admin";
  const [pane, setPane] = useState<"members" | "settings">(initialPane);
  const [showCourses, setShowCourses] = useState(false);
  const now = useNowTick(60_000);
  const [summary, setSummary] = useState<ClubDirectorySummary | null>(null);
  const receiveSummary = useCallback((value: ClubDirectorySummary | null) => setSummary(value), []);
  if (!active) return <GroupsPanel {...{ user, groups, activeGroupId, onGroupsChanged, onActiveGroupChange, onGroupDeleted }} settingsOnly />;
  const tiles = [[summary?.members, "Members"], [summary?.opened30, "Opened BNN · 30 days"], [admin ? summary?.invited : summary?.admins, admin ? "Invited players" : "Club admins"]] as const;
  return <div data-club-hub>
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <div style={{ flex: 1, minWidth: 0 }}><Eyebrow>YOUR CLUB</Eyebrow><h2 style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 24, margin: "8px 0" }}>{active.name}</h2><div style={{ color: C.sage, fontSize: 12 }}>{admin ? "Club admin" : "Member"}</div></div>
      {admin && <button type="button" style={{ ...btn(true), fontSize: 12 }} onClick={() => setPane("settings")}>Invite members</button>}
    </div>
    <div data-club-summary style={{ display: "flex", gap: 8, marginTop: 16 }}>
      {tiles.map(([n, label]) => <div key={label} style={{ flex: 1, minWidth: 0, padding: "13px 16px", background: C.greenLight, borderRadius: 12 }}><div style={{ color: C.cream, fontSize: 24, fontFamily: "Georgia, serif", fontWeight: 800 }}>{n == null ? "—" : n}</div><div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>{label}</div></div>)}
    </div>
    <div style={{ color: C.sage, fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>Opened BNN measures app use across all clubs, not rounds played in this club.{summary?.unknownActivity ? ` Activity is not recorded for ${summary.unknownActivity} member${summary.unknownActivity === 1 ? "" : "s"}.` : ""}</div>
    <ClubEngagement key={`engagement:${active.id}`} groupId={active.id} now={now} refreshKey={groups} compact={!showCourses} onDetails={() => setShowCourses((value) => !value)} />
    {admin && <ClubPendingSignups key={`pending:${active.id}`} groupId={active.id} groupName={active.name} />}
    <div role="tablist" aria-label="Club sections" style={{ display: "flex", gap: 16, marginTop: 16, marginBottom: 12 }}>
      {([["members", "Members"], ["settings", "Club settings"]] as const).map(([id, text]) => <button key={id} type="button" role="tab" aria-selected={pane === id} onClick={() => setPane(id)} style={{ background: "none", border: "none", borderBottom: `2px solid ${pane === id ? C.gold : "transparent"}`, color: pane === id ? C.gold : C.sage, padding: "8px 12px", fontSize: 13, fontWeight: 700 }}>{text}</button>)}
    </div>
    <div hidden={pane !== "members"} style={{ display: pane === "members" ? "block" : "none" }}>
      <ClubLatestReport key={`report:${active.id}`} groupId={active.id} showEmpty />
      <PlayersTab user={user} activeGroupId={active.id} isGroupAdmin={admin} onChanged={onGroupsChanged} directoryTools onSummary={receiveSummary} summaryNow={now} />
    </div>
    {pane === "settings" && <GroupsPanel {...{ user, groups, activeGroupId, onGroupsChanged, onActiveGroupChange, onGroupDeleted }} settingsOnly />}
  </div>;
}
