#!/usr/bin/env python3
"""The setup draft must stop being saved once the game is created.

WHY THIS EXISTS
clearSetupDraft ran correctly on creation, and the draft came back anyway. The Create Game component
keeps its form state after creating, so the save effect fired again on the next render — and the
pagehide/visibilitychange checkpoint, whose listeners stay attached until unmount, would do the same.
The draft offered on the NEXT Create Game was the setup just completed.

Every function involved was individually correct. The bug was ordering, which no unit test sees:
lib/setup-draft-lifecycle.test.ts can prove that a save after a clear resurrects the draft, but only
the source shows whether the component still saves.

WHAT THIS CHECKS
  1. a `doneRef` (or equivalent) guard exists and is set at creation
  2. it is set BEFORE clearSetupDraft, so nothing in between can write the draft back
  3. every saveSetupDraft path is gated on it

    python3 ci/check_draft_not_resurrected.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
src = (ROOT / "components" / "tournaments.tsx").read_text(encoding="utf-8")
# Comments discuss the guard; strip them so prose cannot satisfy the check.
code = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
code = re.sub(r"^\s*//.*$", "", code, flags=re.M)

failures: list[str] = []

if "doneRef" not in code:
    failures.append(
        "no doneRef guard found in components/tournaments.tsx.\n"
        "  Without it, clearSetupDraft on creation is undone by the next render: the component\n"
        "  still holds the form state and the save effect fires again."
    )
else:
    # 1. set at creation, BEFORE the clear
    m_set = re.search(r"doneRef\.current\s*=\s*true", code)
    m_clear = re.search(r"clearSetupDraft\([^)]*\);\s*$", code, re.M)
    if not m_set:
        failures.append("doneRef is never set to true — the guard can never engage.")
    else:
        # find the clearSetupDraft that follows game creation (not the startFresh one)
        clears = [m.start() for m in re.finditer(r"clearSetupDraft\(", code)]
        after = [c for c in clears if c > m_set.start()]
        if not after:
            failures.append(
                "doneRef is set, but no clearSetupDraft follows it.\n"
                "  It must be set BEFORE the clear, or a render between the two writes the draft back."
            )

    # 2. every save is gated
    for m in re.finditer(r"saveSetupDraft\(", code):
        # The guard must be in the save's OWN enclosing block. A fixed character lookback found a
        # DIFFERENT save's guard and let an ungated one through, so the window runs back only to the
        # nearest unmatched `{` — the block this call actually sits in.
        head = code[: m.start()]
        depth = 0
        start = 0
        for i in range(len(head) - 1, -1, -1):
            if head[i] == "}":
                depth += 1
            elif head[i] == "{":
                if depth == 0:
                    start = i
                    break
                depth -= 1
        window = head[start:]
        if "doneRef.current" not in window:
            line = code[: m.start()].count("\n") + 1
            failures.append(
                f"components/tournaments.tsx:{line}: saveSetupDraft is not gated on doneRef.\n"
                "  Every save path must stop after creation — including the pagehide/visibility\n"
                "  checkpoint, whose listeners stay attached until the component unmounts."
            )

if failures:
    print("DRAFT RESURRECTION — violations:\n")
    for f in failures:
        print("  " + f.replace("\n", "\n  "))
        print()
    sys.exit(1)

print("draft not resurrected: PASS (saves stop at creation, guard set before the clear)")
