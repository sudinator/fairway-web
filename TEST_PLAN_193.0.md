# BNN 193.0 — Primary scoring device staging test plan

Use Amit's one real staging login on the phone and desktop. Simulated player names suffice for marker/Alternate Shot tests; no second real account is required for these device tests. These are manual gates, not claimed passes.

## Before testing

1. Finish or verify important pending scores in the current staging build. This release archives legacy unscoped drafts for download instead of automatically trusting them.
2. Apply migration 0162 to staging, copy the changed files, and wait for GitHub CI/fresh-database/integration and Vercel to pass. Do not apply to production.
3. Reload the phone ONLINE first and confirm Help shows 193.0. Open/reload the desktop ONLINE afterward. Old builds are blocked from scoring by 0162.

| ID | Action | Expected result |
| --- | --- | --- |
| P1 | On the phone start a personal round and score hole 1 as 5. Open it on desktop. | Phone remains primary. Desktop offers Make this device primary; scoring/Finish/Discard controls are unavailable. Viewing does not transfer. |
| P2 | On desktop refresh, switch tabs, close/reopen while phone changes the score to 4. | Desktop displays the saved 4 after refresh/focus or within the 20-second poll. No old desktop score is submitted. |
| P3 | Phone offline: correct 4 to 6, clear another score, enter putts/penalties/fairway/sand. Lock/reopen phone, then reconnect. | Primary phone can score offline and recovers its work; its own pending changes sync. Desktop eventually shows the saved values. |
| P4 | Desktop selects Make this device primary, then cancels confirmation. | Phone remains primary; no scoring control is transferred. |
| P5 | Desktop accepts takeover while both are online. | Desktop reloads from current server scores and can score. Phone becomes viewing-only on the next check; old writes cannot land even before its UI updates. |
| P6 | Phone goes offline and changes 6 to 8. Desktop takes over and changes the saved score to 3. Reconnect phone. | Server and desktop retain 3. Phone's old pending 8 is preserved, never auto-uploaded. Download saved scores includes that saved work. |
| P7 | Transfer control back to the phone after P6. | Phone starts from server score 3; archived 8 never silently replaces it. Confirm the archive download still includes 8. |
| P8 | Reload the active device online; also test known-primary cold launch offline. | Normal reload retains control and pending work. Known primary can resume offline even after the tab session is lost; a new/unconfirmed installation cannot activate offline. If reopening online after full tab closure prompts for primary, accept: its own still-current saved work resumes. |
| G1 | In a stroke/singles game, enter own scores and stats on phone; open same game on desktop. | Desktop sees live values and cannot edit scores OR stats. |
| G2 | Phone is the marker for a group; enter scores for simulated players. Desktop is logged into the same account. Transfer to desktop and score those players. | Exactly one device for Amit can score any marker row. Marker authorization itself remains unchanged. Phone cannot write group rows afterward. |
| G3 | Repeat G2 in an Alternate Shot game, including clearing a side score. | Side scores/clears work only on the primary device. Old-device side drafts remain recoverable and cannot overwrite the new primary. |
| C1 | Open a Ryder Cup session game; repeat viewer/transfer scoring checks. | Same account-level rule applies to its game. Standings remain viewable on both devices. |
| X1 | With desktop primary in a game, open a personal round on phone. | Phone remains viewing-only there too; control is account-wide, not per round/game. |
| X2 | Open another browser tab/duplicate tab. | One scoring runtime stays active. Second instance offers explicit takeover; a duplicate tab with copied session state fences the prior runtime on online activation. |
| R1 | Completed personal round: edit, cancel, reopen; edit and Save changes. | Primary edits stay local until Save. Cancel preserves stored scores. Viewer cannot edit or save. |
| R2 | During a connection/read failure, revisit a card or try takeover. | Existing scores stay visible and pending work is retained. Failed checks never silently grant control. Transfer failure shows a message. |

## Evidence and release gate

Record device, build, screen, starting score, final phone/desktop scores, and whether any recovery download was needed for each case. Include a screenshot for failures. A delayed UI update is distinct from a server overwrite: refresh both devices after the test to verify the stored result.

Pass these cases and GitHub CI before continuing the broader audit. This release alone does not clear production or the remaining audit bugs. Separate-account authorization behavior is covered by SQL/CI, not claimed manually verified with Amit's single staging login.
