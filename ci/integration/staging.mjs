import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const STAGING_URL = process.env.BNN_STAGING_SUPABASE_URL;
const ANON = process.env.BNN_STAGING_SUPABASE_ANON_KEY;
const SERVICE = process.env.BNN_STAGING_SUPABASE_SERVICE_ROLE_KEY;
const CONFIRM = process.env.BNN_STAGING_ALLOW_MUTATION;
const PRODUCTION_PROJECT_REF = process.env.BNN_PRODUCTION_SUPABASE_PROJECT_REF || "epmbsmykyrnoiccwnoxq";
if (!STAGING_URL || !ANON || !SERVICE) throw new Error("Set BNN_STAGING_SUPABASE_URL, BNN_STAGING_SUPABASE_ANON_KEY, and BNN_STAGING_SUPABASE_SERVICE_ROLE_KEY.");
if (CONFIRM !== "YES") throw new Error("Refusing to mutate a database. Set BNN_STAGING_ALLOW_MUTATION=YES only for a disposable/staging Supabase project.");
if (!/^https:\/\//.test(STAGING_URL)) throw new Error("Staging Supabase URL must use https.");
const stagingHost = new URL(STAGING_URL).hostname.toLowerCase();
if (stagingHost === `${PRODUCTION_PROJECT_REF.toLowerCase()}.supabase.co` || stagingHost.startsWith(`${PRODUCTION_PROJECT_REF.toLowerCase()}.`)) {
  throw new Error(`Refusing destructive staging integration against Production Supabase project ${PRODUCTION_PROJECT_REF}.`);
}

const service = createClient(STAGING_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
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
  const client = createClient(STAGING_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
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
    const cupRows = await service.from("competitions").select("id").eq("group_id", gid);
    if (cupRows.error) throw new Error(`Cleanup could not inspect Cup fixtures for ${gid}: ${cupRows.error.message}`);
    const cupIds = (cupRows.data || []).map((r) => r.id);
    if (cupIds.length) {
      await service.from("competition_sessions").delete().in("competition_id", cupIds);
      await service.from("competition_players").delete().in("competition_id", cupIds);
      await service.from("competitions").delete().in("id", cupIds);
    }
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
  const sysAdmin = await createUser("sysadmin", true);
  const alice = await createUser("alice");
  const bob = await createUser("bob");
  const charlie = await createUser("charlie");
  const dana = await createUser("dana");
  const outsider = await createUser("outsider");

  const group = expectNoError(await service.from("groups").insert({ name: `BNN Integration ${suffix}`, created_by: admin.id, status: "active" }).select("id").single(), "create disposable group");
  createdGroupIds.push(group.id);
  await addMember(group.id, admin, "admin");
  await addMember(group.id, alice);
  await addMember(group.id, bob);
  await addMember(group.id, charlie);
  await addMember(group.id, dana);

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

  // Alternate Shot: canonical side-owned scoring. One score belongs to the SIDE, not to
  // two duplicated game_players rows. Direct writes are denied; the RPC authorizes a player
  // only for their own side (organizer/admin may score either side); outsiders cannot read.
  const altGame = expectNoError(await service.from("games").insert({
    code: `A${suffix.slice(-6)}`,
    name: "Integration Alternate Shot",
    course: "Integration Course",
    holes_meta: [{ n: 1, par: 4, si: 1 }, { n: 2, par: 4, si: 2 }],
    group_id: group.id,
    created_by: admin.id,
    status: "active",
    game_type: "alt_shot",
    allowance_pct: 83,
    teams: [{ key: "A", name: "Red" }, { key: "B", name: "Blue" }],
    foursomes: [{ id: "alt-group-1", name: "Group 1", a: [alice.id, bob.id], b: [charlie.id, dana.id], a_first: alice.id, b_first: charlie.id }],
    leg_config: { scheme: "none", metric: "net", points: {} },
  }).select("id").single(), "create Alternate Shot fixture");
  const blank = [null, null];
  const altPlayerRows = [
    { user: alice, name: "Alice", team: "A", ch: 26 },
    { user: bob, name: "Bob", team: "A", ch: 12 },
    { user: charlie, name: "Charlie", team: "B", ch: 14 },
    { user: dana, name: "Dana", team: "B", ch: 8 },
  ].map(({ user: u, name, team, ch }) => ({
    game_id: altGame.id, user_id: u.id, display_name: name, is_guest: false, team, tee_group: 1,
    handicap_index: ch, course_handicap: ch, scores: blank, putts: blank, fairways: blank,
    penalties: blank, sand: [false, false], bets: true,
  }));
  expectNoError(await service.from("game_players").insert(altPlayerRows), "seed Alternate Shot players");

  const directAltWrite = await alice.client.from("game_alt_shot_scores").insert({ game_id: altGame.id, foursome_id: "alt-group-1", side: "a", hole_index: 0, strokes: 5 });
  ok(!!directAltWrite.error, "Alternate Shot direct browser score insert is blocked");

  expectNoError(await alice.client.rpc("save_alt_shot_side_score", { p_game: altGame.id, p_foursome_id: "alt-group-1", p_side: "a", p_hole_index: 0, p_strokes: 5 }), "Side A player can score Side A");
  const opponentWrite = await alice.client.rpc("save_alt_shot_side_score", { p_game: altGame.id, p_foursome_id: "alt-group-1", p_side: "b", p_hole_index: 0, p_strokes: 4 });
  ok(!!opponentWrite.error, "ordinary Side A player cannot overwrite Side B");
  expectNoError(await charlie.client.rpc("save_alt_shot_side_score", { p_game: altGame.id, p_foursome_id: "alt-group-1", p_side: "b", p_hole_index: 0, p_strokes: 4 }), "Side B player can score Side B");

  const sideRows = expectNoError(await alice.client.from("game_alt_shot_scores").select("foursome_id,side,hole_index,strokes").eq("game_id", altGame.id).eq("hole_index", 0).order("side"), "read canonical Alternate Shot side scores");
  ok(sideRows.length === 2 && sideRows[0].side === "a" && sideRows[0].strokes === 5 && sideRows[1].side === "b" && sideRows[1].strokes === 4, "exactly one canonical score per side/hole persists");
  const playerScoresAfter = expectNoError(await service.from("game_players").select("user_id,scores").eq("game_id", altGame.id), "inspect individual rows after side scoring");
  ok(playerScoresAfter.every((r) => Array.isArray(r.scores) && r.scores.every((v) => v == null)), "Alternate Shot side score is not copied into individual player scores");
  const outsiderAlt = expectNoError(await outsider.client.from("game_alt_shot_scores").select("game_id").eq("game_id", altGame.id), "outsider side-score query is safely filtered by RLS");
  ok(outsiderAlt.length === 0, "Alternate Shot side scores are hidden from outsiders");
  const started = expectNoError(await service.from("games").select("alt_shot_scoring_started_at").eq("id", altGame.id).single(), "inspect Alternate Shot scoring-start marker");
  ok(!!started.alt_shot_scoring_started_at, "canonical Alternate Shot scoring stamps scoring-start marker");

  // Backward-compatible clear: seed a historical duplicated player score, then clear the
  // canonical side/hole. 0141 must persist an explicit NULL tombstone rather than deleting the
  // row, otherwise the old player score would become visible again in the application fallback.
  expectNoError(await service.from("game_players").update({ scores: [null, 6] }).eq("game_id", altGame.id).in("user_id", [alice.id, bob.id]), "seed historical duplicated Alternate Shot score");
  expectNoError(await alice.client.rpc("save_alt_shot_side_score", { p_game: altGame.id, p_foursome_id: "alt-group-1", p_side: "a", p_hole_index: 1, p_strokes: null }), "clearing a legacy Alternate Shot hole succeeds");
  const clearRow = expectNoError(await service.from("game_alt_shot_scores").select("strokes").eq("game_id", altGame.id).eq("foursome_id", "alt-group-1").eq("side", "a").eq("hole_index", 1).single(), "inspect Alternate Shot clear tombstone");
  ok(clearRow.strokes == null, "clear persists a canonical NULL tombstone instead of deleting the override");

  expectNoError(await admin.client.rpc("reset_game_scores", { p_game: altGame.id }), "organizer reset clears canonical Alternate Shot scoring");
  const afterAltReset = await service.from("game_alt_shot_scores").select("game_id", { count: "exact", head: true }).eq("game_id", altGame.id);
  ok(!afterAltReset.error, `verify Alternate Shot score reset${afterAltReset.error ? ` — ${afterAltReset.error.message}` : ""}`);
  ok((afterAltReset.count ?? 0) === 0, "reset removes all canonical Alternate Shot side scores");
  const markerAfterReset = expectNoError(await service.from("games").select("alt_shot_scoring_started_at").eq("id", altGame.id).single(), "verify Alternate Shot start marker reset");
  ok(markerAfterReset.alt_shot_scoring_started_at == null, "reset clears Alternate Shot scoring-start marker");

  // Cup aggregation layer (0142): only a club/system admin creates the parent, members can read,
  // outsiders cannot, and a linked session must be a same-club ordinary BNN team game whose
  // player roster/team assignment exactly matches the persistent Cup roster.
  const memberCupCreate = await alice.client.from("competitions").insert({ group_id: group.id, created_by: alice.id, name: "Bypass Cup", start_date: "2026-09-01", team_a_name: "Violet", team_b_name: "Burgundy" });
  ok(!!memberCupCreate.error, "ordinary member cannot create a club Cup through the raw API");
  const memberCupRpc = await alice.client.rpc("create_team_competition", {
    p_group: group.id, p_name: "Bypass Cup RPC", p_location: null, p_start_date: "2026-09-01", p_team_a_name: "Violet", p_team_b_name: "Burgundy",
    p_roster: [{ user_id: alice.id, team_key: "A" }, { user_id: charlie.id, team_key: "B" }],
  });
  ok(!!memberCupRpc.error, "ordinary member cannot create a club Cup through the atomic RPC");
  const cupId = expectNoError(await admin.client.rpc("create_team_competition", {
    p_group: group.id, p_name: `Integration Cup ${suffix}`, p_location: null, p_start_date: "2026-09-01", p_team_a_name: "Violet", p_team_b_name: "Burgundy",
    p_roster: [
      { user_id: alice.id, team_key: "A" }, { user_id: bob.id, team_key: "A" },
      { user_id: charlie.id, team_key: "B" }, { user_id: dana.id, team_key: "B" },
    ],
  }), "club admin can atomically create a Cup and persistent roster");
  const cup = { id: cupId };
  const seededCupRoster = expectNoError(await service.from("competition_players").select("user_id,team_key").eq("competition_id", cup.id), "inspect atomic Cup roster");
  ok(seededCupRoster.length === 4, "atomic Cup creation writes the entire roster");
  const cupMemberRead = expectNoError(await bob.client.from("competitions").select("id").eq("id", cup.id), "club member can read Cup");
  ok(cupMemberRead.length === 1, "Cup is visible to active club members");
  const cupOutsiderRead = expectNoError(await outsider.client.from("competitions").select("id").eq("id", cup.id), "outsider Cup query is safely filtered by RLS");
  ok(cupOutsiderRead.length === 0, "Cup is hidden from outsiders");
  const sysAdminCupRead = expectNoError(await sysAdmin.client.from("competitions").select("id").eq("id", cup.id), "system admin can read Cup without club membership");
  ok(sysAdminCupRead.length === 1, "system admin Cup visibility is not accidentally membership-gated");
  expectNoError(await sysAdmin.client.from("competitions").update({ location: "System admin check" }).eq("id", cup.id), "system admin can update Cup without club membership");
  expectNoError(await admin.client.from("competitions").update({ location: null }).eq("id", cup.id), "club admin can restore Cup metadata");
  expectNoError(await admin.client.from("competition_players").delete().eq("competition_id", cup.id).eq("user_id", bob.id), "Cup organizer can remove a roster player before any session is linked");
  expectNoError(await admin.client.from("competition_players").insert({ competition_id: cup.id, user_id: bob.id, team_key: "A", display_name: "Bob" }), "Cup organizer can restore the pre-session roster player");

  const cupGame = expectNoError(await service.from("games").insert({
    code: `C${suffix.slice(-6)}`, name: "Integration Cup Singles", course: "Integration Course",
    holes_meta: [{ n: 1, par: 4, si: 1 }], group_id: group.id, created_by: admin.id, status: "active",
    game_type: "match", allowance_pct: 100, teams: [{ key: "A", name: "Violet" }, { key: "B", name: "Burgundy" }],
    pairings: [{ a: alice.id, b: charlie.id }],
  }).select("id").single(), "create ordinary BNN team Singles game for Cup session");
  expectNoError(await service.from("game_players").insert([
    { game_id: cupGame.id, user_id: alice.id, display_name: "Alice", is_guest: false, team: "A", handicap_index: 0, course_handicap: 0, scores: [4], putts: [null], fairways: [null], penalties: [null], sand: [false], bets: true },
    { game_id: cupGame.id, user_id: charlie.id, display_name: "Charlie", is_guest: false, team: "B", handicap_index: 0, course_handicap: 0, scores: [5], putts: [null], fairways: [null], penalties: [null], sand: [false], bets: true },
  ]), "seed Cup child game players with inherited teams");
  const cupSession = expectNoError(await admin.client.from("competition_sessions").insert({ competition_id: cup.id, name: "Sunday Singles", session_order: 1, format: "match", play_date: "2026-09-01", points_per_match: 1, game_id: cupGame.id }).select("id,game_id").single(), "Cup organizer can link a valid ordinary game session");
  ok(cupSession.game_id === cupGame.id, "Cup session retains linked BNN game as authoritative scoring source");
  const memberSessionWrite = await alice.client.from("competition_sessions").insert({ competition_id: cup.id, name: "Bypass", session_order: 2, format: "match", play_date: "2026-09-01", points_per_match: 1, game_id: cupGame.id });
  ok(!!memberSessionWrite.error, "ordinary member cannot mutate Cup session structure");
  const badLink = await admin.client.from("competition_sessions").insert({ competition_id: cup.id, name: "Wrong teams", session_order: 2, format: "alt_shot", play_date: "2026-09-01", points_per_match: 1, game_id: altGame.id });
  ok(!!badLink.error, "Cup session contract rejects a linked game whose persistent teams do not match the Cup");
  const driftPlayerTeam = await service.from("game_players").update({ team: "B" }).eq("game_id", cupGame.id).eq("user_id", alice.id);
  ok(!!driftPlayerTeam.error, "linked Cup game rejects player team drift after session link");
  const driftGameTeams = await service.from("games").update({ teams: [{ key: "A", name: "Changed" }, { key: "B", name: "Burgundy" }] }).eq("id", cupGame.id);
  ok(!!driftGameTeams.error, "linked Cup game rejects persistent team-name drift");
  const driftCupRoster = await admin.client.from("competition_players").update({ team_key: "B" }).eq("competition_id", cup.id).eq("user_id", alice.id);
  ok(!!driftCupRoster.error, "Cup roster is locked after the first session is linked");

  // 0143: the schedule, not the currently linked games, owns the denominator.
  const memberScheduleLock = await alice.client.rpc("lock_competition_schedule", { p_competition: cup.id });
  ok(!!memberScheduleLock.error, "ordinary member cannot lock a Cup schedule");
  expectNoError(await admin.client.rpc("lock_competition_schedule", { p_competition: cup.id }), "Cup organizer can lock the planned schedule");
  const lockedCup = expectNoError(await service.from("competitions").select("schedule_status,schedule_revision,schedule_locked_at").eq("id", cup.id).single(), "inspect locked Cup schedule");
  ok(lockedCup.schedule_status === "locked" && !!lockedCup.schedule_locked_at, "Cup schedule lock is persisted");
  const lockedSessionChange = await admin.client.from("competition_sessions").update({ points_per_match: 2 }).eq("id", cupSession.id);
  ok(!!lockedSessionChange.error, "locked Cup rejects point-denominator changes");
  const lockedTieChange = await admin.client.from("competitions").update({ tie_rule: "team_a_retains" }).eq("id", cup.id);
  ok(!!lockedTieChange.error, "locked Cup rejects tie-rule drift");
  const blankReopen = await admin.client.rpc("reopen_competition_schedule", { p_competition: cup.id, p_reason: "" });
  ok(!!blankReopen.error, "schedule reopen requires an audit reason");
  expectNoError(await admin.client.rpc("reopen_competition_schedule", { p_competition: cup.id, p_reason: "Integration verification" }), "Cup organizer can explicitly reopen with a reason");
  const reopenedCup = expectNoError(await service.from("competitions").select("schedule_status,schedule_revision").eq("id", cup.id).single(), "inspect reopened Cup schedule");
  ok(reopenedCup.schedule_status === "draft" && reopenedCup.schedule_revision === lockedCup.schedule_revision + 1, "reopen returns Cup to draft and increments revision");
  const scheduleAudit = expectNoError(await service.from("competition_schedule_events").select("action,reason").eq("competition_id", cup.id).order("created_at"), "inspect Cup schedule audit trail");
  ok(scheduleAudit.some((row) => row.action === "locked") && scheduleAudit.some((row) => row.action === "reopened" && row.reason === "Integration verification"), "schedule lock and reasoned reopen are audited");

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
