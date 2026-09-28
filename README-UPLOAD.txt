BNN 192.14.260928 — files to upload to the `staging` branch
===========================================================

WHY A NEW VERSION NUMBER
------------------------
192.13 was already deployed to staging. The rule in DEPLOY_NOTES.md is explicit:
"Bump EDIT on every ship (even two on the same day) so no two builds share a version string."
So this is 192.14.260928 — new EDIT, today's date in US/Eastern. Reissuing 192.13 would have
broken that rule.

UPLOAD THESE EIGHT FILES, AT THESE EXACT PATHS
----------------------------------------------
  package.json                                     (repo root)
  MIGRATIONS.md                                    (repo root)
  DEPLOY_NOTES.md                                  (repo root)
  BACKLOG.md                                       (repo root)
  lib/app-version.ts
  public/app-version.json
  public/sw.js
  migrations/0157_course_api_check_service_role.sql

The four version-stamped files (package.json, lib/app-version.ts, public/app-version.json,
public/sw.js) must all read 192.14.260928. ci/check_version_ledger.py compares package.json against
the top entry of DEPLOY_NOTES.md, and they now match.

DO NOT TOUCH migrations/0156_course_api_checks.sql
--------------------------------------------------
It is already on main. ci/check_migration_immutability.py compares every migration on the branch
against main BYTE FOR BYTE, because an applied migration cannot be retracted. You have already
restored it from main's Raw view; that copy is authoritative. This bundle deliberately excludes it
so a reconstruction cannot differ by a byte and fail the guard again.

STEPS (no git required)
-----------------------
1. Unzip this locally.
2. On GitHub, switch to the `staging` branch.
3. Add file -> Upload files.
4. Drag the four root files, AND the `lib`, `public` and `migrations` folders, so each file lands
   at the path listed above rather than in the repo root.
5. Commit to `staging`.
6. Wait for CI on the pull request.

AFTER CI IS GREEN
-----------------
7. Merge the PR into main.
8. Both databases already have 0156 and 0157 applied — nothing further is needed there.
9. Run the "External API Contracts" workflow ONCE. Expect: "Checking 5 of 18".
10. Confirm the monitor recorded results rather than leaving placeholders:

      select provider_id, last_status, note, last_checked_at
      from public.course_api_checks
      order by last_checked_at desc limit 6;

    Expect last_status 'ok' and note NULL.
    'claimed, awaiting result' means 0157 is not applied on that database.

WHAT I VERIFIED
---------------
  - all four version-stamped files read 192.14.260928
  - DEPLOY_NOTES.md and MIGRATIONS.md top entries carry the same string
  - every migration file present is listed in the MIGRATIONS.md checklist, including 0157
  - 0157's filename matches its record_migration() id
  - 0157 revokes from public before granting, and has an authorization check
  - no file instructs anyone to re-apply or edit 0156

WHAT I COULD NOT VERIFY
-----------------------
The sandbox holding the repository was reset, so `npm run guards` and the preflight could not be
run against this set. If a guard fires that is not one of the checks listed above, send the log.
