# Release verification — v181.1.260902

## Scope

- Includes the complete v181.0 Ryder Cup Trifecta feature.
- Adds 22px separation above and 12px below the Sessions/Add session row.
- Adds a 16px flex gap and prevents the Add session button from shrinking on narrow screens.
- Does not change the established Ryder Cup card borders, colors, or scoring contract.

## Required verification

- TypeScript and unit tests
- Ryder Cup contract guard
- Mobile-fit, design-scale, tap-target and shell-geometry guards
- Production Next.js build

## Deployment order

1. Install the v181.1 changed files on Staging.
2. Apply migration `0146_ryder_cup_trifecta.sql` to the Staging database with RLS enabled.
3. Run Staging integration and confirm Vercel is green.
4. Test the Ryder Cup Sessions header spacing and one Trifecta foursome.
