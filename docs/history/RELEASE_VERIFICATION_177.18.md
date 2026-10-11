# Release Verification — 177.18.260811

## Scope
Corrective release for the 177.17 staging compile failure plus a permanent staging-push CI gate.

## Root cause
The 177.17 tee fallback loader narrowed `game.group_id` / `game.course` before creating an async closure, then read the mutable React state object again inside that closure. TypeScript does not preserve property narrowing across that asynchronous boundary, so `game.group_id` remained `string | null | undefined` at the call to `loadCoursesForGroup(..., string)`.

## Fix
Capture the validated `groupId` and `courseName` as local constants before entering the async closure and use those immutable values throughout the request. This preserves the exact intended inputs to the course loader and global fallback lookup.

## Permanent release gate
`.github/workflows/ci.yml` now runs on pushes to `staging` in addition to PRs and `main`. `npm run ci` includes `npx tsc --noEmit`, guards, unit/differential tests, and `npm run build`. A staging candidate with a TypeScript error should therefore fail GitHub CI immediately, before promotion.

## Database
No migration.
