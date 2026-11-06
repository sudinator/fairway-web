# 212.93.261106 — readable club dates and visible member total

Full-source candidate based on 212.92. No live database, staging, email or production changes occurred here. Not production-release approval.

## Changes and contract review

ClubEngagement renders the existing period.from/to civil dates through formatClubDateRange. A same-year period displays “Oct 8 – Nov 6”; cross-year periods include years on both ends. The English short month/day display is fixed to UTC solely to preserve the supplied civil dates on every viewer device. Invalid, reversed or impossible dates display “Dates unavailable”. The period computation, inclusive Eastern query bounds, request key, network/retry/cancellation behavior and all aggregate counts are unchanged.

ClubHub already had the member-count tile; the previous focused preview accidentally omitted that header summary. Its label now reads “Total club members”, and the new preview includes the actual summary. The count still comes from the existing paged directory summary: distinct current active non-support members; invitations remain separate. It is not the number who played in the selected period. Loading/unknown/error behavior is unchanged. No duplicate count or new membership query is added. The modelled preview has three total members, two participating members, to make the distinction visible.

Inputs, outputs, dependencies: new pure formatClubDateRange accepts {from,to} and returns a display string; it has no state, storage, network or write effects. ClubEngagement adds one helper import and replaces only its date-label expression. ClubHub changes only one label. Props, callbacks, local state, summary source, permissions, scoring/handicap/period logic, backend route/server loader and all other controls remain unchanged. Version/release metadata and regression assertions update. No migration, environment or dependency changes.

## EXECUTED tests with MODELLED data

151 activity/period/scoring checks pass: the prior 141 remain, with displayed dates updated, plus eight pure date-format scenarios (same year, YTD, cross year, leap day, single day, impossible/invalid/reversed input) and two rendered 30/90-day labels. Existing YTD/late-response/A → B → A assertions now verify the readable label. The existing 80 differential participation scenarios remain.

58 directory checks pass, including current-member tile count, support/invitation exclusions, read-error placeholders/retry, context isolation, permissions and member phone/profile/Say hi behavior. No message is sent.

Full local CI: PASS, process exit 0 (`npm run ci`, Node 22), including TypeScript, hook lint, full unit suite, source/security/lifecycle guards, differential/scoring simulations, actual worker/update browser checks and complete production build. Assertion guard passes with 441,368 assertions across 105 registered suites, none lost. All 168 ticking-clock suites pass.

Browser/time-zone checks: 57 Chromium checks pass on actual rendered candidate states using MODELLED reads at 320/390/430px. The actual member summary is included and verified across both roles, all three play periods and collapsed/expanded details; dashboard one-line/colour checks remain. Six preview interaction checks verify readable date labels, invariant three-member total versus two participants, expand/collapse and all four dashboard windows at 320px. No browser errors or horizontal overflow. Six formatter assertions across UTC, America/Los_Angeles and Pacific/Kiritimati preserve the same civil dates, including year boundaries.

Package/source review: all 313 SQL files, backend/aggregate/membership counting, permissions and dashboard source are byte-identical to 212.92. ClubEngagement differs only by the date formatter import/expression; ClubHub differs only by the member-tile label. No dependency/script/worker-body change except version stamp. Full-source ZIP excludes dependencies/build output/private environments, passes credential/artifact checks, CRC and SHA-256 manifest verification. Inventory: release-verification/212.93/package-audit.json. No live staging/database integration has been executed.

## External gates NOT executed

GitHub verify, Vercel staging Ready, staging integration and actual phone checks remain pending. Check the visible Total club members count against the selected club roster, confirm it stays a current-membership count across 30/90/YTD, distinguish it from participants, and check readable dates after switching clubs/periods, expanded/collapsed states and a year boundary. Prior staging/phone/adjacent workflow gates from 212.92 still apply. No new migration. After any later authorized production merge confirm production Ready and do a non-destructive smoke test.
