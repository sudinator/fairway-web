# Workflow Simulation Report — 178.14.260829

## MODELLED scenarios
1. Marker taps either Alternate Shot side: team identity opens, one side score is edited, fan-out persists to both partner rows.
2. Non-marker partner taps own side: team score remains editable as the side; no individual stats-only interpretation.
3. Receiving side hole: side gross minus canonical relative stroke produces displayed net.
4. Scratch side: no stroke is subtracted.
5. Score edit and clear/re-entry: same one-ball fan-out/state path as 178.13.
6. Partner-row disagreement: existing 178.13 conflict-safe reader/finalization guard remains intact.
7. Results tab: Alternate Shot individual Group Results/sixes side game does not render.
8. Personal card: Alternate Shot does not render `YOUR CARD` / `ENTER YOUR SCORES`.
9. Four-Ball and Trifecta: unchanged branches remain player-based.

## Result
No new persistence or scoring-engine path introduced. This release changes the observable scoring entity from duplicated players to the correct side/team while preserving the proven Alternate Shot engine and storage contract.
