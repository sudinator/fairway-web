# Workflow Simulation Report 177.39.260815

Evidence labels: MODELLED = code/path simulation only; EXECUTED = automated executable check; BROWSER-VALIDATED = live UI.

- EXECUTED: final 18-hole correction recalculates course handicap from the round's stored handicap index and refreshes per-hole `recv` allocation.
- EXECUTED: corrected rating/slope changes the differential.
- EXECUTED: no stored historical handicap index -> corrected round has `course_handicap = null`; no current/profile index is borrowed.
- EXECUTED: gross-only correction recalculates differential from preserved `gross_score`.
- EXECUTED: 9-17-hole corrected round remains differential-eligible when its required historical inputs exist.
- EXECUTED: game linkage survives the pure correction transform.
- MODELLED: recorded-round save writes only personal `rounds` metadata/hole edits; Round Editor contains no `games`/`game_players` write path.
- MODELLED: gross-only metadata-only save skips hole creation/update and preserves `gross_score`.
- MODELLED: invalid/partial rating+slope input blocks Save with explicit validation.
- MODELLED: final-round Cancel returns to caller before the destructive in-progress discard path.
- MODELLED: course-library propagation remains separate/explicit via `Save course`.
- MODELLED: save completion invokes existing `onSaved`, and Home's existing callback reloads rounds before returning to Rounds; downstream dashboard/profile logic consumes the refreshed rounds.

Browser validation remains required for edit -> save -> reload -> dashboard/profile refresh and Cancel behavior before Production promotion.
