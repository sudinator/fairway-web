/**
 * RENDERED CHECK (208.0): the account gate screens and Admin → Players, from the approved mocks.
 */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { act } from "react";
import { IsThisYou, WaitingForApproval, AccountUnavailable } from "@/components/account-gate";
import { AdminPlayers } from "@/components/admin-players";

const players = [
  { id: "m1", display_name: "Vimal Narayanan", email: "vimal@medtrix.test", is_admin: false, is_owner: false, banned: false, handicap_index: 21, group_count: 1, rounds_count: 1,
    account_status: "active", status_reason: null, status_at: null, status_by_name: null, merged_into_name: null, merged_into_email: null, pending_kind: null, last_active: null },
  { id: "m2", display_name: "Vimal Narayanan", email: "vimal.gmail@test", is_admin: false, is_owner: false, banned: true, handicap_index: null, group_count: 0, rounds_count: 0,
    account_status: "merged", status_reason: "Duplicate of Vimal Narayanan", status_at: "2026-10-16T19:00:00Z", status_by_name: "Amit Sud", merged_into_name: "Vimal Narayanan", merged_into_email: "v•••••@medtrix.test", pending_kind: null, last_active: null },
  { id: "m3", display_name: "Example Player", email: "ex@test", is_admin: false, is_owner: false, banned: true, handicap_index: 12, group_count: 1, rounds_count: 30,
    account_status: "suspended", status_reason: "Left the club", status_at: "2026-09-02T12:00:00Z", status_by_name: "Amit Sud", merged_into_name: null, merged_into_email: null, pending_kind: null, last_active: null },
];
const pending = [
  { id: "p1", display_name: "Raj Patel", email: "raj.work@test", pending_kind: "possible_duplicate", pending_since: "2026-10-16T18:00:00Z", duplicate_acknowledged: true,
    club_id: "g19", club_name: "The 19th Hole", match_id: "m9", match_name: "Raj Patel", match_email: "r•••••@gmail.com", match_clubs: "LEMG", match_rounds: 18, match_last_active: "2026-10-15T12:00:00Z" },
  { id: "p2", display_name: "Pat Reilly", email: "pat@test", pending_kind: "no_invite", pending_since: "2026-10-15T21:10:00Z", duplicate_acknowledged: false,
    club_id: null, club_name: null, match_id: null, match_name: null, match_email: null, match_clubs: null, match_rounds: null, match_last_active: null },
];
(globalThis as any).fetch = async (input: any) => {
  const url = String(input?.url ?? input);
  const body = url.includes("/rpc/admin_list_users") ? players : url.includes("/rpc/admin_pending_signups") ? pending : url.includes("/groups") ? [{ id: "g1", name: "LEMG" }, { id: "g19", name: "The 19th Hole" }] : [];
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 80)); });

(async () => {
  const a = renderScreen(<IsThisYou gate={{ state: "possible_duplicate", match_name: "Vimal Narayanan", match_email: "v•••••@medtrix•••.com", signed_in_as: "vimalnarayanan213@gmail.com" }} onNotMe={() => {}} />);
  const at = a.el.textContent || "";
  ok(at.includes("Is this you?") && at.includes("v•••••@medtrix•••.com") && at.includes("Switch Google account") && at.includes("That's not me"), "Is this you? — masked email and both choices");
  ok(!at.includes("vimal@medtrix"), "the existing member's full email is never shown");
  a.unmount();
  const w = renderScreen(<WaitingForApproval gate={{ state: "pending", club: "The 19th Hole", signed_in_as: "pat@test" }} />);
  ok((w.el.textContent || "").includes("Waiting for approval") && (w.el.textContent || "").includes("The 19th Hole"), "Waiting for approval — names the club");
  w.unmount();
  const u = renderScreen(<AccountUnavailable reason="merged" />);
  ok((u.el.textContent || "").includes("isn't used any more") && (u.el.textContent || "").includes("Sign in with another Google account"), "merged account — sign in with your usual account");
  u.unmount();

  const p = renderScreen(<AdminPlayers user={{ id: "admin" }} />);
  await settle();
  const pt = p.el.textContent || "";
  ok(pt.includes("NEW SIGN-UPS (2)") && pt.includes("POSSIBLE DUPLICATE") && pt.includes("NO INVITE"), "sign-up queue with both kinds");
  ok(pt.includes("Duplicate — merge into Raj Patel") && pt.includes("Admit to The 19th Hole"), "a duplicate: merge into the member, or admit to the club it came through");
  ok(pt.includes("Choose club…"), "a no-invite sign-up: choose a club");
  ok(pt.includes("Active 1") && pt.includes("Suspended 1") && pt.includes("Merged / removed 1"), "filter counts");
  p.click("All 3"); await settle();
  const all = p.el.textContent || "";
  ok(/MERGED/.test(all) && all.includes("into Vimal Narayanan") && all.includes("email blocked — can't sign in to BNN"), "a merged account says so plainly, and where it went");
  ok(/SUSPENDED/.test(all) && all.includes("Left the club") && all.includes("Restore"), "a suspended member: reason and Restore");
  ok(!all.includes("Delete permanently"), "no Delete permanently");
  // 208.1: "Merge into…" opens the panel UNDER THE ROW that was tapped (it used to open off-screen at the top).
  p.click("Merge into…"); await settle();
  const row = p.el.querySelector('[data-player="active"]');
  ok(!!row?.querySelector("[data-merge-panel]"), "the merge panel opens inside the tapped row");
  ok(p.el.querySelectorAll("[data-merge-panel]").length === 1, "exactly one merge panel");
  p.unmount();
  report("account gate + admin players");
})().catch((e) => { console.error(e); process.exit(1); });
