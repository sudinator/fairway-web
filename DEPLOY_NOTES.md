# Deploy notes — v1.0.38 (cumulative — full app, supersedes all prior)

## Database
No new migration. If not already run: 0002–0012.

## UI fix
Tee-group assignment no longer uses a cramped dropdown that clipped "Group 1"
to "Grou". Each player now sits on their own line with the group choices as
tap-pills (None / 1 / 2 / 3 …), the selected one highlighted. No truncation,
bigger tap targets, wraps cleanly on narrow phones.
