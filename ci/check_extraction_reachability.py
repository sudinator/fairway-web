#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]

def text(rel):
    return (ROOT / rel).read_text(encoding="utf-8")

def require(rel, needle, why):
    body = text(rel)
    if needle not in body:
        print(f"FAIL {rel}: {why}\n  missing: {needle}")
        return False
    return True

checks = [
    ("components/manage/courses.tsx", 'onClick={() => openEditor("new")}', "Add New Course must enter editor state"),
    ("components/manage/courses.tsx", 'onClick={() => openEditor({ id: c.id, data: c.data, user_id: c.user_id })}', "existing-course rows must enter editor state"),
    ("components/manage/courses.tsx", 'if (editing) {', "editing state must have a render consumer"),
    ("components/manage/courses.tsx", '<CourseEditor', "CoursesLibrary must render CourseEditor"),
    ("components/manage/courses.tsx", 'initial={editing === "new" ? null : editing.data}', "editor must receive selected course data"),
    ("components/manage/courses.tsx", 'existingId={editing === "new" ? null : editing.id}', "editor must receive canonical existing id"),
    ("components/manage/courses.tsx", 'onCancel={() => { clearActiveCourseEdit(); setEditing(null); }}', "cancel must clear persisted and React editor state"),
    ("components/manage/courses.tsx", 'onSaved={() => { clearActiveCourseEdit(); setEditing(null); void load(); }}', "save must exit editor and refresh library"),
    ("components/tournaments.tsx", '} satisfies OrganizerPanelProps;', "OrganizerPanel spread props must be contract-checked"),
    ("components/tournaments.tsx", '<OrganizerPanel section="players" {...panelProps} />', "Players setup step must reach OrganizerPanel"),
    ("components/tournaments.tsx", '<OrganizerPanel section="teams" {...panelProps} />', "Teams setup step must reach OrganizerPanel"),
    ("components/tournaments.tsx", '<GroupsBuilder game={game} players={players} onSetTeeGroup={setPlayerTeeGroup}', "tee-group writes must remain wired to GroupsBuilder"),
    ("components/game/organizer-panel.tsx", 'onSetTee(p, e.target.value)', "per-player tee selector must consume its callback"),
    ("components/game/organizer-panel.tsx", 'onClick={() => onAddMember(m)}', "member add UI must consume its callback"),
    ("components/game/organizer-panel.tsx", 'await onAddGuest(addGuestName, parseFloat(addGuestHcp), addGuestSponsor || user.id)', "guest add UI must consume its callback"),
]

ok = True
for args in checks:
    ok = require(*args) and ok

if not ok:
    sys.exit(1)
print(f"Extraction reachability: PASS ({len(checks)} critical contract links)")
