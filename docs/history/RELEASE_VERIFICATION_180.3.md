# Release verification — v180.3.260902

## Scope

This overlay closes the browser-state gap after Ryder Cup deletion and changes navigation/title surfaces from **Ryder Cups** to **Ryder Cup**.

## Database

- No migration is included.
- Migration `0145_competition_lifecycle` remains the latest required migration.
- Do not rerun migration 0145 where it is already recorded.

## Required Staging scenarios

1. Open an expendable Ryder Cup and delete it.
2. Confirm the interface returns to the Ryder Cup list.
3. Confirm the deleted title is absent without refreshing the browser.
4. Confirm its linked Games are absent.
5. Reopen an old direct link or otherwise request the deleted ID and confirm the UI says `This Ryder Cup no longer exists.`
6. Confirm no `Cannot coerce the result to a single JSON object` message is shown.
7. Confirm the selector, page heading, and back navigation say **Ryder Cup**.
8. Confirm the collection heading remains **Your Ryder Cups** and the empty state remains **No Ryder Cups yet.**

## Release gates

- GitHub CI and fresh-database verification green.
- Vercel Staging deployment green.
- Complete local CI and production build green.
