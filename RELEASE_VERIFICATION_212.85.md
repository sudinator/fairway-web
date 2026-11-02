# 212.85.261102 — current member capabilities

Candidate full-source release. No deployment, live database writes, migration, email send or email scheduling performed. Automatic updates remain quiet; no version announcement/banner was added.

## Changes and sources
- lib/capabilities.json is still the shared source for What Birdie Num Num can do and both public one-pager PDFs. Every format you play now includes all8 implemented GAME_TYPES from lib/game-shape.ts: Stableford, stroke, singles, four-ball, skins, Trifecta, Alternate Shot and Scramble.
- Add Ryder Cup events (source: components/competitions.tsx, sessions/schedule/match points/standings) and round recaps (components/game/recap-body.tsx). Member wording describes implemented functionality, not future plans.
- HelpSearch's Formats answer includes Alternate Shot and Scramble. New Scramble and Ryder Cup answers explain how to start/use those features. Games with friends covers the wider format selection; the Help introduction refers to current bottom tabs/More navigation.
- Course-correction copy matches per-club correction before global admin approval; offline copy describes local saving/reconnection without the absolute never-drop-a-score claim.
- TGC-only Tee Times and money-game exclusives are preserved. Source: Home's More-menu gate for Tee Times. Ordinary clubs are not advertised TGC-only functionality.
- APP_RULES/HANDOFF require capability/FAQ/one-pager review when a member feature changes. New local and Robustness-workflow guard compares the guide and Formats answer with canonical GAME_TYPES and refuses undocumented new formats. Monthly member education is a separate reviewed-email approach; no automatic messaging implementation is introduced.
- Both PDFs and marketing/onepager-content.txt regenerated with the existing green/gold layout from the shared JSON. Both remain single-page editions. This modifies app download assets, not the scoring flow.
- Automatic-update browser fixture now reads the generated build version rather than a hard-coded212.84 string, so version/date bumps do not break its simulated multi-release lifecycle. No production update-policy change.

## Executed checks
- Supported-format guard PASS for all8 formats in the shared capabilities and Help Formats answer.
- Both actual generated PDF pages rendered/visually reviewed: new format names, Ryder Cup and recap cards fit; no clipped cards or overlap. Text extraction confirms new capabilities. This is generated-document evidence, not a live-app screenshot.
- Actual HelpPage club/TGC variants added to the design gallery for phone-width rendering and overflow checks; no reconstructed before UI.
- EXECUTED clean final npm run ci exit0 (TZ=UTC, Node22): device/editor/game recovery, lint, types, 440,483 assertions across100 reported suites, 164 moving-clock suites, lifecycle/source/security guards, format-coverage guard, phone-width gallery, actual automatic-worker/browser tests and production build PASS. See release-verification/212.85/local-ci.log.
- Both actual HelpPage edition renders were reviewed at390px; scroll width390 equals viewport390. Header wraps above the PDF button on small screens. Internal screenshots are not packaged and are not presented as live staging evidence.
- Test configuration now supports the actual HelpPage JSON dependency and existing ES2021 string helpers; emitted tests remain ES2020. Earlier failed harness attempts are not release validation; the final frozen-source run passed.
- All231 SQL migrations, scoring core/draft/writer/primary-device files and automatic-update policy are unchanged from212.84 (worker version stamp aside). No SQL required. Live staging integration is not configured in this workspace and remains an external gate.

## External release gates
Push the complete source to staging and require GitHub verify, Robustness/onepager-sync and staging-integration checks. Confirm Current version212.85.261102 on the phone. Help → What Birdie Num Num can do should include Scramble, Alternate Shot, Ryder Cup and recaps. Search Formats/Scramble/Ryder Cup; verify the new answers. Download the appropriate one-pager and confirm the same capabilities. TGC-only items must stay confined to that edition. No migration SQL. Membership email content/sending is not part of this release.

Actual staging/iPhone validation is not performed by this session; local rendering/checks do not replace those gates. Scoring and automatic-update behavior remain as212.84.
