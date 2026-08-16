# Create Game convergence — Stage 1 state contract (177.47)

## Purpose
Formalize Create Game's state boundary before any visual or persistence rewrite. This release does not change the Create Game UI, creation transaction, Supabase writes, format behavior, tee behavior, flights, guests, or post-create routing.

## Current CreateGame state inventory

### Domain state represented by `GameSetupDraft`
- Game: `name`, `matchDate`, `pickedFav` (represented by course name), `teeIdx`, `idxStr`.
- Players: `selectedPlayers`, `guestPlayers`, `hcpOverrides`.
- Format: `gameType`, `allowancePct`, `teamScoreMode`, `trifectaScoring`, `strokeBasis`, `fmtFamily`, `matchKind`, `teamMode`, `skinsTeamStyle`, `skinsMode`.
- Structure labels: `team1`, `team2`.
- Flights: `flightMode`, `flightCount`.

### Loaded/server context deliberately outside the draft
- `favorites`
- `profileIdx`
- `groupRoster`

These are reloaded from canonical sources and should not be snapshotted as authoritative setup data.

### Transient editor state deliberately outside the draft
- `flightHcpDraft`
- `guestName`
- `guestHcp`
- `guestSponsor`
- `guestIdxEdits`

These are unfinished text-entry buffers, not committed setup decisions.

### Runtime/UI state deliberately outside the draft
- `busy`
- `err`
- `draftAvailable`
- `draftDismissed`
- `pendingFavName`

### Refs
- `hydratedRef` — prevents overwriting an offered resume draft before the user chooses.
- `resumedRef` — prevents tee-time seed prefill from overwriting resumed state.
- `guestsSeeded` — prevents duplicate tee-time guest seeding.

A permanent CI guard parses `CreateGame` and requires every `useState` cell and ref to remain classified. A future state addition therefore cannot silently cross the extraction boundary.

## Compatibility contract
The existing `lib/setup-draft.ts` local-storage shape remains unchanged. `GameSetupDraft` is adapted back through `toLegacySetupData()` before `saveSetupDraft()` is called.

This preserves existing resume behavior byte-for-byte at the serialized field level. Existing stored v1 drafts remain readable via `fromLegacySetupDraft()`.

## Known gap deliberately NOT fixed in Stage 1
`hcpOverrides` exists in live CreateGame state but the legacy setup-draft format does not persist it. Therefore a flight-handicap override can be lost if setup is interrupted after it is committed but before game creation. Stage 1 records that mismatch explicitly but does not alter behavior. Any fix belongs in a later, intentional draft-schema version with migration/backward-compatibility tests.

Likewise, unfinished text buffers (`flightHcpDraft`, guest entry fields, `guestIdxEdits`) remain transient exactly as before.

## Next stage
Extract pure structure mutations (teams, pairings, foursomes, tee groups, structure stash/restore) while keeping existing Manage Game persistence adapters intact. Differential tests must prove old and extracted mutations produce identical structures before Create Game begins consuming them.
