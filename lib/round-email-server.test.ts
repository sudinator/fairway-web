function ok(c: unknown, m: string) { if (!c) throw new Error(m); }
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-signing-key";
import { unsubscribeToken, validUnsubscribe } from "./round-email-server";
// 209.3: the one-click "turn off" link can only turn off that member's own emails.
const a = "19300000-0000-0000-0000-000000000001", b = "19300000-0000-0000-0000-000000000002";
ok(validUnsubscribe(a, unsubscribeToken(a)), "a member's own link works");
ok(!validUnsubscribe(a, unsubscribeToken(b)), "another member's token doesn't work for this member");
ok(!validUnsubscribe(a, "0".repeat(32)), "a guessed token is refused");
ok(!validUnsubscribe(a, unsubscribeToken(a).slice(0, 31) + "x"), "an altered token is refused");
ok(!validUnsubscribe(a, ""), "no token is refused");
// 210.1: each kind of email has its own turn-off — a round-summary link can't turn off club reports, and vice versa.
ok(validUnsubscribe(a, unsubscribeToken(a, "club"), "club"), "a club-report link works for club reports");
ok(!validUnsubscribe(a, unsubscribeToken(a, "round"), "club"), "a round-summary link can't turn off club reports");
ok(!validUnsubscribe(a, unsubscribeToken(a, "club"), "round"), "a club-report link can't turn off round summaries");
console.log("round-email-server tests passed");
