# 192.16.260929 — Profile privilege boundaries

Status: implemented and locally verified; NOT CLEARED FOR PRODUCTION.
Baseline: supplied fairway-web-main (2).zip, version 192.15.260928. Current remote main/staging synchronization was not available to verify. Reconcile this patch with synchronized staging before applying it.

## Change

Migration 0158 protects profile INSERT as well as UPDATE. Browser inserts cannot set admin/owner true. Only the existing owner can change another non-owner admin flag. Browser owner-marker and profile-ID changes are denied. Admin changes made through the RPC or directly by the owner are audited atomically by the trigger, exactly once per actual change. Repeating the same requested status is a no-op without another audit entry. Null RPC arguments are rejected. Ban administration and the existing blocklist insert trigger are retained. Explicit trusted SQL roles preserve backend provisioning; JWT role metadata alone cannot trigger that exemption.

No existing profiles are modified by the migration. No historical migration is edited. No application UI changes are needed; the RPC signature stays the same. Trusted service/database maintenance remains privileged and does not generate the browser admin audit entries. The app's signup setting is unchanged: this patch does not make Google signup invitation-only.

## Executed evidence

| Check | Outcome | Limit |
| --- | --- | --- |
| Complete npm run ci under Node 22.23.3 | PASS, exit 0 | Local; dependencies from the supplied lockfile |
| Unit/differential assertion ratchet | PASS: 439421 assertions, 49 suites | Existing coverage; prior audit failures remain separate work |
| Next.js production build | PASS | No deployment |
| Actual migration applied twice in isolated PostgreSQL/PGlite | PASS | Minimal fixture, not a full Supabase rebuild |
| Permanent SQL regression under authenticated role and RLS | PASS | Same SQL test is wired into fresh DB CI |
| Historical migrations byte comparison with original ZIP | PASS: zero changed | Remote main comparison still required |
| Manifest regeneration and ledger guards | PASS | Existing guard suite retained |

The permanent regression file is ci/assert-profile-privileges.sql. Executed outcomes: admin insert denied; owner insert denied; ordinary signup/edit succeeds; ordinary self-promotion denied; ordinary ban edits denied; non-owner direct admin promotion denied; non-owner admin RPC denied; non-owner owner-marker change denied; normal system-admin ban/unban works; owner RPC promotion works; repeating it does not duplicate audit; direct owner demotion works; exactly two corresponding admin audit entries; owner self-demotion denied; browser owner-marker changes denied; browser profile-ID transfer denied; spoofed service-role JWT metadata does not bypass protection; blocklisted profile still born banned; banned user cannot clear their own ban; trusted service provisioning works. Test fixtures roll back.

## Required gates still outstanding

1. Confirm remote main and staging are synchronized; reconcile patch against the exact staging baseline. Preserve unrelated newer files.
2. Apply 0158 to STAGING via the normal migration process. Its SQL is in migrations/0158_profile_privilege_boundaries.sql. Keep earlier migrations unchanged.
3. Run the GitHub fresh Supabase database rebuild and all checks. Local fresh rebuild could not start because Supabase CLI/Docker/PostgreSQL client are unavailable here; see fresh-db.log. This is a blocking gate, not a waived check.
4. Verify live staging migration parity, real staging integration and browser workflows: new ordinary signup, profile edit, owner grant/revoke and one audit entry per change, system-admin ban/unban, owner account intact. Exercise negative authorization scenarios only with disposable staging users.
5. Confirm production schema/ledger parity through the existing read-only gate, then follow the staging-to-main release process only once all mandatory gates pass.

Production was not modified or tested destructively. The uploaded live definitions establish the original flaw, but the deployed fix is not verified until staging and production gates are run.

## Recommended subsequent releases

1. Round persistence: Cancel must discard historical edits, every write failure must keep the draft, and recovery must use round identity. Earlier audit R1–R3 reproduced failures.
2. Offline scores: retain corrections, deletions and stats-only edits across cold reopen; acknowledge synchronization only after server success. Earlier audit G1 reproduced helper failures.
3. Manual handicaps: preserve authoritative nine-hole figures and source during posting and editing. Earlier audit H1–H2 reproduced failures.
4. Invite-only enrollment, if intended: enforce invitations on the server. Links alone are not authorization. Review binding blocklist checks to the authenticated identity rather than client profile email; this last item is source-derived, not a newly executed exploit.
5. Follow up game-create atomicity and club-admin edits that silently affect zero rows. Players Member since remains on the backlog.
