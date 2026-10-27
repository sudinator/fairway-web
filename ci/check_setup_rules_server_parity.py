#!/usr/bin/env python3
"""212.49 (owner, Oct 26: "do a full inventory … and ensure the server side is handled similarly in order to keep the
app in sync") — every setup action the APP can BLOCK (lib/game-setup-policy) must have a matching SERVER test, so a new
app rule can't ship without the server enforcing it too. Add the action to SERVER_TESTS below, pointing at the database
test that proves the server refuses it."""
import pathlib, re, sys
R = pathlib.Path(__file__).resolve().parent.parent
policy = (R / "lib/game-setup-policy.ts").read_text(encoding="utf-8")
SERVER_TESTS = {   # action → (database test, the words of its server check)
    "ended":            ("ci/assert-setup-locks.sql", "rule 1: a setting changed on an ended game"),
    "change_course":    ("ci/assert-setup-locks.sql", "rule 2: course changed after scoring"),
    "set_match_length": ("ci/assert-setup-locks.sql", "rule 3: holes changed after scoring"),
    "set_format":       ("ci/assert-setup-locks.sql", "rule 4: four-ball became Stableford after scoring"),
    "set_skins_style":  ("ci/assert-setup-locks.sql", "rule 5/6: teams removed after scoring"),
    "set_match_team":   ("ci/assert-setup-locks.sql", "rule 5/6: teams removed after scoring"),
    "set_pairings":     ("ci/assert-setup-locks.sql", "rule 7: matchups changed after scoring"),
    "set_foursomes":    ("ci/assert-setup-locks.sql", "rule 8: foursomes changed after scoring"),
    "add_player":       ("ci/assert-setup-locks.sql", "rule 9: a player joined a four-ball after scoring"),
    "remove_player":    ("ci/assert-setup-locks.sql", "rule 10: a scored player was removed"),
    "set_team":         ("ci/assert-setup-locks.sql", "rule 11: a scored player changed team"),
    "set_tee_group":    ("ci/assert-group-changes-after-scores.sql", "a player with scores was moved"),
    "clear_groups":     ("ci/assert-group-changes-after-scores.sql", "Start over cleared a scored player"),
    "randomize_groups": ("ci/assert-group-changes-after-scores.sql", "a player from a locked group was moved"),
}
actions = re.findall(r'\|\s*\{\s*type:\s*"(\w+)"', policy)
blocking = set()
for a in actions:
    m = re.search(r'case "%s": \{(.*?)\n    \}' % a, policy, re.S) or re.search(r'if \(action\.type === "%s"\) \{(.*?)\n  \}' % a, policy, re.S)
    if m and "block(" in m.group(1): blocking.add(a)
if "endedBlock()" in policy: blocking.add("ended")
bad = []
for a in sorted(blocking):
    if a not in SERVER_TESTS: bad.append(f'the app can block "{a}" but no server test is listed — enforce it at the server (a migration) and add its database test here'); continue
    f, words = SERVER_TESTS[a]
    if words not in (R / f).read_text(encoding="utf-8"): bad.append(f'"{a}": {f} no longer checks "{words}"')
# the phone's side of late scores (BN164): pause the queue for that game, keep the scores, say so once, resume on reopen
t = (R / "components/tournaments.tsx").read_text(encoding="utf-8")
for needle, what in [('if (isLateScoreRefusal(error)) { endedRejectedRef.current = true;', "scores refused after the end pause the queue"),
                     ('endedRejectedRef.current && "game ended"', "the queue holds while the game is ended"),
                     ('window.addEventListener("bnn-game-ended-rejected", endedNotice);', "the player is told once"),
                     ('lateScoreHold({ refused: endedRejectedRef.current, status: game.status }).resume', "reopening the game resumes sending"),
                     ('alert(lateScoreNotice(holes));', "the message comes from lib/late-scores")]:
    if needle not in t: bad.append(f"late scores: {what} (components/tournaments.tsx)")
if t.count('if (isLateScoreRefusal(error))') < 3: bad.append("late scores: player scores AND both team-score routes (scramble, alternate shot) must handle the refusal")
# 212.52 (owner, Oct 26: "Organizer + system admins only (match the app)") — WHO: the app shows Manage Game to the game's
# creator only; the server's side of who-can-do-what is ci/assert-game-permissions.sql (every game function classified)
for needle, what in [('const isOrganizer = game.created_by === user.id;', "the organizer is the game's creator"),
                     ('{roomTab === "setup" && isOrganizer && (() => {', "Manage Game is shown to the organizer only")]:
    if needle not in t: bad.append(f"who: {what} (components/tournaments.tsx) — if this changes, change the server's rules and ci/assert-game-permissions.sql to match")
if "BNN_ALLOWED" not in (R / "ci/assert-game-permissions.sql").read_text(encoding="utf-8"): bad.append("who: ci/assert-game-permissions.sql is missing its who-can-do-what matrix")
if len(blocking) < 10: bad.append(f"only {len(blocking)} blocking actions found in lib/game-setup-policy — the parser needs updating")
if bad: print("SETUP RULES ↔ SERVER: FAIL\n  " + "\n  ".join(bad)); sys.exit(1)
print(f"setup rules ↔ server: PASS ({len(blocking)} blocking app rules, each with a server test)")
