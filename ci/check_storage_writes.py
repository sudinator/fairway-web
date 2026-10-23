#!/usr/bin/env python3
"""212.28 — score backups must never fail silently (owner, Oct 23: a full storage area made every score backup fail
without a word, and entered scores vanished — 212.26; the team-score draft write threw and the team score was never
sent — 212.28). Each function that stores a score backup must, on a failed write, TIDY the storage and retry, and then
REPORT the failure (noteStorageWriteFailure — the scorecard warns; the score is still sent)."""
import pathlib, re, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
CRITICAL = {  # file -> functions that store a score backup
    "lib/draft.ts": ["saveGameScores"],
    "lib/alt-shot-side-scores.ts": ["saveAltShotDraft"],
}
bad = []
for rel, fns in CRITICAL.items():
    src = (ROOT / rel).read_text(encoding="utf-8")
    for fn in fns:
        m = re.search(rf"export function {fn}\b[\s\S]*?\n}}\n", src)
        if not m: bad.append(f"{rel}: {fn} not found"); continue
        body = m.group(0)
        for need in ("tidyScoringStorage", "noteStorageWriteFailure"):
            if need not in body: bad.append(f"{rel}: {fn} must call {need}() when its storage write fails")
if bad:
    print("STORAGE WRITES: FAIL\n  " + "\n  ".join(bad)); sys.exit(1)
print(f"storage writes: PASS ({sum(len(v) for v in CRITICAL.values())} score-backup writes tidy, retry and report a failure)")
