# 212.90.261106 — combined Players and Clubs

Full-source candidate based on 212.89. No live database, staging or production changes have been made. This record is not production-release approval.

## Scope and intentional behavior changes

More now offers Clubs once. Both existing `players` and `groups` routes remain supported; Admin → Members opens the directory, Admin → Club settings opens Settings. APP_TABS/notification link contracts remain unchanged.

Clubs contains Members, Activity and Club settings. Member cards/avatars, phone links, handicap/GHIN display, peer cards and existing admin controls are retained. Members adds search (name/email/phone/GHIN) and filters. Missing-handicap treats 0 as a real handicap. Directory order is alphabetical by display name/email, replacing Players' old role/email order. Support rows are omitted from the new directory and summary, matching the existing admin club-count definition.

The header counts distinct linked active members; removed/invited/support memberships do not inflate that total. App-open count uses profiles.last_active in the rolling previous 30 days, including the cutoff, excluding future timestamps. Missing/invalid activity is labelled unknown. This is not club-specific play. Invited-player count means invited membership records, not shared invitation links or held sign-ups; held sign-ups remain a separate admin-only review. A member sees club-admin count rather than the invited-player tile. There is no new tracking or timestamp write.

Activity displays ClubLatestReport only when a saved readable snapshot exists. It does not generate a report. Loading, no available report, read error and Retry are distinct. Settings retains club selection, requests, rename, invitation links, testing mirror and the original deletion workflow, but hides its duplicate roster/report/sign-up banner. A failed membership read cannot offer deletion.

## Contract inventory

Home inputs remain user/profile, memberships, selected club, returnTab and navigation callbacks. Selected club, support entry/exit, URL validation and Admin authorization remain owned by Home. ClubHub composes existing components; its local state is selected pane and derived summary. A club/pane-entry key discards old club searches, modals and pending reads on context changes. The directory remains mounted across subtab switches so filters survive a Members → Activity/Settings → Members round trip.

PlayersTab retains user/activeGroupId/isGroupAdmin/onChanged and its existing local edit/busy/message/player-card state. Optional directoryTools/onSummary/summaryNow props support the hub while direct existing callers retain their contract. New local search/filter/read-error/request-generation state controls display only. The onSummary callback reports aggregate values; it does not grant privileges. A shared reactive clock refreshes the 30-day cutoff every minute.

Existing successful handicap writes, notifications, audit entries, role/removal patches and refresh callbacks are preserved. Role/removal writes now inspect database errors before audit/notification/refresh success effects; read failures retain prior same-club data and allow retry. Current-user role/removal is blocked, and UI administration still requires the club-admin role. No system-admin privileges are added to ordinary club screens.

GroupsPanel gains optional settingsOnly; direct standalone rendering retains its full view. Its existing request/rename/invite/delete/updateMember handlers remain. Its roster read uses the shared paginated directory loader and a request-generation guard, with explicit errors. ClubLatestReport adds optional showEmpty; existing callers can retain conditional hiding. It cancels stale results and resets report expansion on group changes.

Shared read inputs: group ID, membership rows (id/user/email/role/status/avatar/is_support), linked profiles (id/name/handicap/phone/GHIN/avatar/last_active). Outputs: sorted enriched directory rows or a thrown read error. All membership pages are read in stable id order, with profiles chunked by 100 IDs and paged. No new SQL, table, RPC, grant, RLS policy, database column, score calculation or updater behavior.

## EXECUTED tests using MODELLED data

`lib/club-directory.test.tsx`: 44 checks. Counts include deduplication, invitations/support/removed exclusions, missing/invalid/future activity and exact 30-day cutoff; case-insensitive search/filter/zero handicap; real hub/tab rendering; no-report versus failed-report and retry; role-write error/retry without losing the roster; member versus club-admin controls; A → B → A navigation; a deliberately held old-club response cannot overwrite club B; no-club request access and Admin settings entry; unknown membership count never offers deletion; 1,001 members exercise pagination/chunked profile joins.

The SQL payloads and source-controlled database chain must remain byte-identical to 212.89. Existing unit/differential, correction-navigation, account-gate, scoring, storage, lifecycle/security, browser/updater and production-build checks remain required.

## Added live engagement (owner, Nov 6)

The compact header shows qualifying rounds by participating members, distinct courses and participation rate. Activity expands to the top three most-played courses with each course's round and distinct-member counts. Live engagement is independent of published reports.

The period is 30 inclusive US Eastern calendar dates, ending today. Counts describe current active non-support club members. Finished club games count valid player cards using round-rules.isValidRound; shared-ball participation comes from canonical side scores with legacy support and explicit clear tombstones. Finalized standalone personal rounds must belong to the selected club, have a valid scored card, be non-deleted and have no game_id. Posted game rounds are counted through the game only. No-shows, guests, nonmembers, unfinished/deleted rounds, other clubs and out-of-period entries are excluded. Duplicate game/user and standalone round identities are collapsed. Course names normalize whitespace/case; missing names remain in round totals but not course rankings and are disclosed. Ranking is by qualifying rounds, alphabetical for ties. No scoring or handicap calculations change.

New GET /api/club-engagement verifies the authenticated caller via createRouteClient.auth.getUser, validates the club UUID, then checks approved/non-banned account and active membership before reading club data with the existing server credential. System admins without active membership do not get an implicit bypass; existing support membership permits review but does not inflate counts. The route returns only aggregates/course names, never raw rounds, scores or participant IDs. Anonymous/invalid/outsider/cross-club/inactive/banned callers are rejected. Read failures yield an error, never a partial zero. Responses use private,no-store. SUPABASE_SERVICE_ROLE_KEY stays server-side; no SQL, grant or RLS change.

Client fetches are aborted on context change, reject malformed responses and time out after 20 seconds with retry. Same-context failed refreshes retain their last good snapshot with a warning. Group/period identities and stale-response guards prevent previous-club results appearing under a new club. Club membership refreshes trigger engagement refresh; midnight changes the date window. A compact header keeps the directory reachable; the detailed ranking lives under Activity.

Additional EXECUTED tests using MODELLED data: 43 metric/React checks cover normal/edge/date boundaries, personal rounds/game copies, shared-ball legacy/tombstones, missing courses, guest/no-show/invalid rounds, top-three ranking, failed refresh, timeout and retry, malformed output and late-response isolation. 24 actual route/server-loader checks use mocked auth/database responses: anonymous/invalid requests create no service client; outsider/cross-club/pending/banned callers cannot read scores; request-supplied actors/counts are ignored; authorized real loader data aggregates correctly; raw IDs/scores are absent; no shared cache; missing configuration and read failures are errors. No production data or writes.

Full local CI for the expanded candidate: PASS, process exit 0 (`npm run ci`, Node 22). This includes TypeScript, complete unit suite, guard/source-contract and assertion-baseline checks, differential/scoring/modelled lifecycle tests, actual worker/update browser tests and complete Next.js production build. See release-verification/212.90/local-ci.log. No live database integration was executed.

Additional differential review: 329 checks passed. All pre-existing lib files except the generated app version are byte-identical to 212.89. Six original club request/rename/invite/copy/update write helpers are byte-identical. Selected scoring, device and update components are unchanged. All 313 SQL files are byte-identical; dependency and devDependency versions are unchanged. Intentional changes are listed above.

Visual verification: 18 Chromium layout checks passed, with no horizontal overflow at 320/390/430px, for both roles across Members/Activity/Settings. Markup comes from actual candidate components, verified against executed loaded-state renders using modelled reads. The preview uses six qualifying sample player rounds across four games/three courses/three members and no published report. It is not a live club-data screenshot. Packaging audit and hash checks are recorded in package-audit.json.

## External gates (not executed here)

GitHub verify, Vercel staging Ready, staging integration harness and actual phone checks are pending. Prior release gates remain in force. On staging check both roles, legacy Players/Admin links, club switching, search/filter/re-entry, invitations/rename, real published/no-report states, failed-read retry, and score saving/reloading in adjacent workflows. Verify an ordinary member who did not play a particular club game still sees the same aggregates as the club admin; compare finalized personal/game-posted/shared-ball cases without double-counting. Confirm the existing server service-role configuration is present; missing configuration must display an error. Use staging for any membership write tests. Do not merge production until the required external checks pass; after any later authorized merge confirm production Ready and perform a non-destructive smoke test.
