# Birdie Num Num — Release Verification 179.1

Status: STAGING CANDIDATE ONLY — GitHub CI/Vercel still required.

## Root cause corrected
- 179.0 staging bundle contained `components/tournaments.tsx` calling `buildPlayerRows(... includeCreator ...)` but omitted the updated `lib/game-create.ts` defining `PlayerRowsOpts.includeCreator`.
- GitHub TypeScript failed TS2353 before tests/build.
- The working source already contained the intended contract; 179.1 corrects the package and adds a guard.

## Proactive package audit
Compared the files materially changed for the Cup implementation against the 179.0 ZIP. The omitted required files were:
- `lib/game-create.ts`
- `lib/game-create.test.ts`
`components/home.tsx` had a later filesystem timestamp but contains no Cup integration and is not required by this change.

## Executed checks in extracted environment
- `python3 ci/check_competition_contract.py`: PASS after guard expansion.
- `python3 -m py_compile ci/check_competition_contract.py`: PASS.
- Targeted source inspection confirms `PlayerRowsOpts.includeCreator?: boolean`, default-inclusion semantics, and Cup-only caller opt-out agree.

## Environment limitation
The local node_modules tree remains incomplete; a fresh full `npx tsc --noEmit` fails on missing third-party type packages before application typechecking. Therefore GitHub CI is the authoritative full TypeScript/test/build gate.

## Database
- No new migration.
- 0142 is unchanged from the already-applied and 12/12 structurally verified Staging migration.
