# 177.20 workflow simulation report

## Course-provider contract
- Current opaque ids: all 18 reviewed GolfCourseAPI ids accepted.
- Legacy numeric id: accepted as an opaque token for backward compatibility.
- Unsafe inputs: empty, whitespace, slash/path traversal, query/hash delimiters, percent-encoded path text, and >64-char ids rejected.
- Search -> detail reachability: source guard confirms both modes use the same `normalizeCourseProviderId` contract and detail URLs encode the validated id.
- Add Course: API result id is a string; detail selection uses the same id; new canonical inserts write both `external_id` and `data.externalId`; existing reconciled courses resolve by exact external id instead of duplicating.
- Adjacent paths: Round Setup, Yardage Backfill, course freshness, and admin facility refresh preserve/string-encode the provider id.

## PWA update state model
- New release available: current release remains old during passive detection; update prompt is driven by `Latest != Current`.
- Explicit Update: waiting worker receives `SKIP_WAITING`; controller change reloads into the new release.
- Same-version rebuild: waiting worker/build-id drift alone does not show an update prompt.
- Live data: `/api/*`, `/auth/*`, Supabase, and `/app-version.json` bypass shell caching.
- Offline shell: active release shell is cache-first; uncached navigation can fall back to cached root.

## Fault/re-entry cases
- Missing provider id -> detail rejected before upstream request.
- Provider id with path/query control characters -> rejected.
- Waiting service worker not yet installed when Update is tapped -> registration update waits briefly for installation, then activates; explicit cache-busting navigation is the user-authorized fallback.
- Provider contract drift -> weekly GitHub workflow fails and opens/updates an admin issue.

## Result
All modeled scenarios passed. Real dependency-backed type/build/unit validation remains a staging CI gate. The external-provider live monitor requires the GitHub `GOLF_API_KEY` secret before its manual/scheduled run can be validated.
