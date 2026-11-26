# Independent review brief — every drop, before hand-off (standing, 212.132)

Owner (Nov 26, 2026): keep an independent agent reviewing whatever is built, focused on security, integrity, display
consistency and workflow, flagging what should be fixed with a severity; and compliance with every documented ground
rule as its own factor. The reviewer is deliberately COLD: it gets the repository and the diff, never the author's
reasoning, and it does not fix anything. The owner decides scope from its list.

## What the reviewer receives
- The repository at the candidate, with the release's changes uncommitted against the previous release (`git diff HEAD`
  plus untracked files), and the newest DEPLOY_NOTES.md entry — the author's CLAIMS, to be checked, not believed.
- A local PostgreSQL with the full migration chain applied (ci/test_fresh_db_local.sh), the test tooling, and a browser.
- No conversation history. If the brief is ambiguous the reviewer states its assumption and continues.

## What it looks for, in this order
1. **Data loss.** Any way a member's scores, drafts, rounds or settings can be lost or silently overwritten — on this
   phone, on a shared phone, offline, mid-sync, at sign-out, at update, on a full phone.
2. **Security and integrity.** RLS, grants, SECURITY DEFINER functions, triggers and their interactions; what a member
   can do with a hand-crafted database or API call against their own data and others'; every question in
   SECURITY_CHECKLIST.md answered for new surface; `ci/check_security_contract.py` and the security assertions run.
3. **Correctness.** One rule, one implementation (lib and SQL agree; a rule written twice is a finding unless a guard
   holds the copies together); time zones (Supabase is UTC, the local chain is not); boundaries and edge cases.
4. **Display consistency.** DISPLAY_RULES.md Part 7 applied to every screen the change touches: the surface rule, the
   type/padding/radius scales, gold-means-act, mandatory components (BottomSheet, btn(), HScroll, Segmented, Eyebrow),
   list idioms, contrast, tap targets, the viewport rule — rendered, not read.
5. **Workflow.** The member's path through the change, end to end: every state reachable, every popup closable, no
   dead end, no native dialog, the observable outcome of every stateful action verified (APP_RULES 31).
6. **Compliance with the ground rules** — a separate, severity-ranked section. The rule documents are:
   - APP_RULES.md (the numbered global rules, the standing rules at the end)
   - DISPLAY_RULES.md
   - AUTO_BEHAVIORS.md (nothing new changes data without a tap unless listed there)
   - SECURITY_CHECKLIST.md
   - HANDOFF.md standing rules (viewport and the bottom nav; public routes own their scroll; lessons become guards;
     versioning; migrations immutable and self-recording; every migration's SQL inline; docs in sync)
   A change that breaks a rule is a finding even when it works. A rule that the change should have triggered (a new
   guard for a recurring class of bug, a threat-model line for new surface) and didn't is a finding.
7. **Tests that do not test.** A suite that passes without exercising the claim; assertions after the report line;
   a fixture that cannot reach the bug; a test file no script runs; a guard that a one-line rewrite defeats.
   The reviewer negative-tests: it reverts the fix and confirms the new test fails.

## How it reports
A ranked table — Rank (P1 data loss or security; P2 a member hits it; P3 everything else), Finding (one sentence),
Evidence/impact/fix — each line labelled EXECUTED (a reproduction was run), SOURCE-INSPECTED, or MODELLED, with
file:line, the concrete impact, and a concrete fix. Speculation is labelled as such. Areas checked and found clean are
listed in one line each, so the author knows what was looked at. No praise.

## What happens next
The author assesses each finding (reachability × harm, the repo's own rule), the owner decides scope, and accepted
items ship in the next drop with their own tests and guards — then that drop is reviewed cold in turn.
