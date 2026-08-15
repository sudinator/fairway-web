import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const URL = process.env.BNN_STAGING_SUPABASE_URL;
const ANON = process.env.BNN_STAGING_SUPABASE_ANON_KEY;
const SERVICE = process.env.BNN_STAGING_SUPABASE_SERVICE_ROLE_KEY;
const CONFIRM = process.env.BNN_STAGING_ALLOW_MUTATION;
const PRODUCTION_PROJECT_REF = process.env.BNN_PRODUCTION_SUPABASE_PROJECT_REF || "epmbsmykyrnoiccwnoxq";
if (!URL || !ANON || !SERVICE) throw new Error("Set BNN_STAGING_SUPABASE_URL, BNN_STAGING_SUPABASE_ANON_KEY, and BNN_STAGING_SUPABASE_SERVICE_ROLE_KEY.");
if (CONFIRM !== "YES") throw new Error("Refusing to mutate a database. Set BNN_STAGING_ALLOW_MUTATION=YES only for a disposable/staging Supabase project.");
if (!/^https:\/\//.test(URL)) throw new Error("Staging Supabase URL must use https.");
const stagingHost = new URL(URL).hostname.toLowerCase();
if (stagingHost === `${PRODUCTION_PROJECT_REF.toLowerCase()}.supabase.co` || stagingHost.startsWith(`${PRODUCTION_PROJECT_REF.toLowerCase()}.`)) {
  throw new Error(`Refusing destructive staging integration against Production Supabase project ${PRODUCTION_PROJECT_REF}.`);
}

const service = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
const password = `BnnTest!${crypto.randomBytes(12).toString("base64url")}`;
const createdUserIds = [];
const createdGroupIds = [];
const createdCourseIds = [];
let checks = 0;

function ok(condition, message) {
  checks++;
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS ${checks}: ${message}`);
}
function expectNoError(result, message) {
  ok(!result.error, `${message}${result.error ? ` — ${result.error.message}` : ""}`);
  return result.data;
}
async function createUser(label, isAdmin = false) {
  const email = `bnn-${label}-${suffix}@example.invalid`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`Could not create ${label}: ${error?.message}`);
  createdUserIds.push(data.user.id);
  await service.from("profiles").upsert({ id: data.user.id, email, display_name: `BNN ${label} ${suffix}`, is_admin: isAdmin });
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error) throw new Error(`Could not sign in ${label}: ${signed.error.message}`);
  return { id: data.user.id, email, client };
}
async function addMember(groupId, user, role = "member") {
  expectNoError(await service.from("group_members").insert({ group_id: groupId, user_id: user.id, email: user.email, role, status: "active" }), `seed ${role} membership`);
}

async function cleanup() {
  for (const gid of [...createdGroupIds].reverse()) {
    // Best-effort explicit cleanup so the harness does not depend on every historical FK being ON DELETE CASCADE.
    await service.from("course_change_requests").delete().eq("group_id", gid);
    await service.from("group_course_overrides").delete().eq("group_id", gid);
    await service.from("group_courses").delete().eq("group_id", gid);
    await service.from("expenses").delete().eq("group_id", gid);
    // Expense deletion itself writes a final immutable audit record, so purge harness audit rows afterwards.
    const auditDelete = await service.from("money_audit").delete().eq("group_id", gid);
    if (auditDelete.error) throw new Error(`Cleanup could not remove money_audit fixtures for ${gid}: ${auditDelete.error.message}`);
    const auditRemaining = await service.from("money_audit").select("id", { count: "exact", head: true }).eq("group_id", gid);
    if (auditRemaining.error) throw new Error(`Cleanup could not verify money_audit fixtures for ${gid}: ${auditRemaining.error.message}`);
    if ((auditRemaining.count || 0) !== 0) throw new Error(`Cleanup left ${(auditRemaining.count || 0)} money_audit fixture row(s) for ${gid}.`);
    await service.from("tee_times").delete().eq("group_id", gid);
    await service.from("group_events").delete().eq("group_id", gid);
    await service.from("group_guests").delete().eq("group_id", gid);
    await service.from("games").delete().eq("group_id", gid);
    await service.from("group_members").delete().eq("group_id", gid);
    await service.from("groups").delete().eq("id", gid);
  }
  for (const cid of [...createdCourseIds].reverse()) await service.from("favorite_courses").delete().eq("id", cid);
  for (const uid of [...createdUserIds].reverse()) {
    await service.from("profiles").delete().eq("id", uid);
    await service.auth.admin.deleteUser(uid);
  }
}

try {
  console.log(`BNN staging integration run ${suffix}`);
  const admin = await createUser("admin", true);
  const alice = await createUser("alice");
  const bob = await createUser("bob");
  const outsider = await createUser("outsider");

  const group = expectNoError(await service.from("groups").insert({ name: `BNN Integration ${suffix}`, created_by: admin.id, status: "active" }).select("id").single(), "create disposable group");
  createdGroupIds.push(group.id);
  await addMember(group.id, admin, "admin");
  await addMember(group.id, alice);
  await addMember(group.id, bob);

  const course = expectNoError(await service.from("favorite_courses").insert({ user_id: admin.id, name: `Integration Course ${suffix}`, location: "Testville", data: { holes: [{ n: 1, par: 4, si: 1 }] }, vetted: true, deleted: false }).select("id").single(), "create disposable course");
  createdCourseIds.push(course.id);

  // Course correction: browser writes denied, RPC allowed, group-visible, outsider-hidden, retry-safe.
  const directWrite = await alice.client.from("group_course_overrides").insert({ group_id: group.id, course_id: course.id, name: "Bypass", location: "", data: {} });
  ok(!!directWrite.error, "member cannot bypass correction RPC with direct override insert");

  const submitArgs = { p_group: group.id, p_course: course.id, p_name: `Corrected ${suffix}`, p_location: "Testville", p_data: { holes: [{ n: 1, par: 4, si: 1 }] }, p_reason: "integration test", p_change_summary: "name" };
  const firstReq = expectNoError(await alice.client.rpc("submit_course_correction", submitArgs), "member can submit course correction via RPC");
  const retryReq = expectNoError(await alice.client.rpc("submit_course_correction", { ...submitArgs, p_reason: "integration retry" }), "retrying course correction succeeds");
  ok(firstReq === retryReq, "retry reuses the same pending correction request");
  const pending = expectNoError(await service.from("course_change_requests").select("id,status").eq("group_id", group.id).eq("course_id", course.id).eq("status", "pending"), "inspect pending corrections");
  ok(pending.length === 1, "only one pending correction exists after retry");
  const memberVisible = expectNoError(await bob.client.from("course_change_requests").select("id").eq("id", firstReq), "another group member can read submitted correction");
  ok(memberVisible.length === 1, "course correction is visible to group members");
  const outsiderVisible = expectNoError(await outsider.client.from("course_change_requests").select("id").eq("id", firstReq), "outsider query is safely filtered by RLS");
  ok(outsiderVisible.length === 0, "course correction is hidden from non-members");
  expectNoError(await admin.client.rpc("review_course_correction", { p_request: firstReq, p_action: "approved" }), "app admin can atomically approve correction");
  const reviewed = expectNoError(await service.from("course_change_requests").select("status,reviewed_by,reviewed_at").eq("id", firstReq).single(), "inspect reviewed correction");
  ok(reviewed.status === "approved" && reviewed.reviewed_by === admin.id && !!reviewed.reviewed_at, "approval status and reviewer are persisted");
  const overrideAfterReview = expectNoError(await service.from("group_course_overrides").select("id").eq("group_id", group.id).eq("course_id", course.id), "inspect override after approval");
  ok(overrideAfterReview.length === 0, "global approval removes the group-only override");

  // Money: valid create, then force an insert-time unique violation after destructive stages and prove transaction rollback.
  const expenseArgs = {
    p_expense: null, p_group: group.id, p_description: "Integration dinner", p_amount_cents: 1000,
    p_split_type: "custom", p_event: null,
    p_payers: [{ user_id: alice.id, paid_cents: 1000 }],
    p_shares: [{ user_id: alice.id, share_cents: 500 }, { user_id: bob.id, share_cents: 500 }],
  };
  const expenseId = expectNoError(await alice.client.rpc("save_expense_atomic", expenseArgs), "atomic expense create succeeds");
  const beforeExpense = expectNoError(await service.from("expenses").select("amount_cents,description").eq("id", expenseId).single(), "read original expense");
  const beforeShares = expectNoError(await service.from("expense_shares").select("user_id,share_cents").eq("expense_id", expenseId).order("user_id"), "read original shares");
  const failingEdit = await alice.client.rpc("save_expense_atomic", {
    ...expenseArgs, p_expense: expenseId, p_amount_cents: 1200, p_description: "Should roll back",
    p_payers: [{ user_id: alice.id, paid_cents: 1200 }],
    p_shares: [{ user_id: alice.id, share_cents: 600 }, { user_id: alice.id, share_cents: 600 }],
  });
  ok(!!failingEdit.error, "expense edit deliberately fails after replacement path begins");
  const afterExpense = expectNoError(await service.from("expenses").select("amount_cents,description").eq("id", expenseId).single(), "read expense after failed edit");
  const afterShares = expectNoError(await service.from("expense_shares").select("user_id,share_cents").eq("expense_id", expenseId).order("user_id"), "read shares after failed edit");
  ok(JSON.stringify(afterExpense) === JSON.stringify(beforeExpense), "failed edit rolls back parent expense changes");
  ok(JSON.stringify(afterShares) === JSON.stringify(beforeShares), "failed edit restores original shares");

  // RSVP: parallel first-time signups receive distinct deterministic order values.
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const tt = expectNoError(await service.from("tee_times").insert({ group_id: group.id, created_by: admin.id, title: `Integration Tee ${suffix}`, play_date: tomorrow, tee_off_times: ["09:00"], status: "upcoming" }).select("id").single(), "create tee time fixture");
  const [r1, r2] = await Promise.all([
    alice.client.rpc("upsert_tee_time_rsvp", { p_tee_time: tt.id, p_user: alice.id, p_choice: "in", p_guest_names: [] }),
    bob.client.rpc("upsert_tee_time_rsvp", { p_tee_time: tt.id, p_user: bob.id, p_choice: "in", p_guest_names: [] }),
  ]);
  const o1 = expectNoError(r1, "parallel RSVP A succeeds");
  const o2 = expectNoError(r2, "parallel RSVP B succeeds");
  ok(Number.isInteger(o1) && Number.isInteger(o2) && o1 !== o2, "parallel RSVPs receive distinct signup orders");

  // Bet post/re-post: force split uniqueness failure and prove original expense survives.
  const game = expectNoError(await service.from("games").insert({ code: `I${suffix.slice(-6)}`, name: "Integration Game", course: "Integration Course", holes_meta: [{ n: 1, par: 4, si: 1 }], group_id: group.id, created_by: admin.id, status: "active" }).select("id").single(), "create game fixture");
  const betArgs = {
    p_replace_expense: null, p_group: group.id, p_game: game.id, p_event: null, p_description: "Integration bet", p_amount_cents: 1000,
    p_payers: [{ user_id: alice.id, guest_id: null, sponsor_user_id: null, paid_cents: 1000 }],
    p_shares: [{ user_id: bob.id, guest_id: null, sponsor_user_id: null, share_cents: 1000 }],
  };
  const betRows = expectNoError(await admin.client.rpc("save_bet_expense_atomic", betArgs), "atomic bet post succeeds");
  const bet = Array.isArray(betRows) ? betRows[0] : betRows;
  ok(!!bet?.id, "bet RPC returns posted expense id");
  const badRepost = await admin.client.rpc("save_bet_expense_atomic", {
    ...betArgs, p_replace_expense: bet.id, p_amount_cents: 1200,
    p_payers: [{ user_id: alice.id, guest_id: null, sponsor_user_id: null, paid_cents: 1200 }],
    p_shares: [
      { user_id: bob.id, guest_id: null, sponsor_user_id: null, share_cents: 600 },
      { user_id: bob.id, guest_id: null, sponsor_user_id: null, share_cents: 600 },
    ],
  });
  ok(!!badRepost.error, "bet repost deliberately fails on duplicate split");
  const originalBet = expectNoError(await service.from("expenses").select("id,amount_cents").eq("id", bet.id).maybeSingle(), "check original bet after failed repost");
  ok(originalBet?.id === bet.id && originalBet.amount_cents === 1000, "failed bet repost preserves original posted expense");

  // Safe delete: a populated group is rejected; an empty admin-only group can be removed.
  const populatedDelete = await admin.client.rpc("delete_group_safely", { p_group: group.id });
  ok(!!populatedDelete.error, "safe group delete refuses a club with other active members");
  const solo = expectNoError(await service.from("groups").insert({ name: `BNN Solo ${suffix}`, created_by: admin.id, status: "active" }).select("id").single(), "create solo group");
  createdGroupIds.push(solo.id);
  await addMember(solo.id, admin, "admin");
  expectNoError(await admin.client.rpc("delete_group_safely", { p_group: solo.id }), "admin can delete solo group atomically");
  const soloGone = expectNoError(await service.from("groups").select("id").eq("id", solo.id).maybeSingle(), "verify solo group deletion");
  ok(soloGone == null, "solo group is actually deleted");
  createdGroupIds.splice(createdGroupIds.indexOf(solo.id), 1);

  console.log(`\nSTAGING INTEGRATION PASS — ${checks} checks`);
} finally {
  await cleanup();
}
