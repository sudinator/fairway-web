#!/usr/bin/env python3
"""Verify that a component MOVE changed no code.

A relocation must be behavior-preserving: the moved component's source should be
character-for-character identical wherever it now lives. This tool extracts a
component's source block by name from anywhere under components/, normalizes away
benign whitespace / line-ending differences (which the CRLF step introduces and
which never affect behavior), and hashes it.

  python3 ci/verify-relocation.py snapshot pre      # before moving: record hashes
  python3 ci/verify-relocation.py check   pre      # after moving:  assert identical

Exit non-zero if any tracked component's code changed or went missing. Pure logic
edits, accidental cut/paste damage, and "the block moved but a line got dropped"
all surface here; a legitimate relocation passes untouched.
"""
import sys, re, json, hashlib, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
COMP = ROOT / "components"
SNAP_DIR = ROOT / ".move-snapshots"

# Components whose relocation we want to guard. Add names as stages proceed.
TRACKED = [
    "GameList", "GroupScorecard", "GroupsBuilder", "OrganizerPanel", "BettingPanel", "ShareControl",
    # already moved (kept here so a future edit that resurrects/alters them is caught):
    "SkinsView", "MatchView", "FourballView", "StrokesSummary", "ScoreHistory",
    "SegmentBoard", "GroupSegmentSummary", "LegConfigEditor",
]

HEADER = re.compile(r'^(?:export\s+)?function\s+(\w+)\b')

def norm(lines):
    # strip CR and trailing whitespace per line; drop trailing blank lines
    out = [ln.replace("\r", "").rstrip() for ln in lines]
    while out and out[-1] == "":
        out.pop()
    return "\n".join(out)

def extract(name):
    """Return (relpath, text) for the first top-level `function name` found under components/."""
    for f in sorted(COMP.rglob("*.tsx")):
        lines = f.read_text(encoding="utf-8").split("\n")
        for i, ln in enumerate(lines):
            m = HEADER.match(ln)
            if m and m.group(1) == name:
                j = i + 1
                while j < len(lines) and not HEADER.match(lines[j]):
                    j += 1
                block = lines[i:j][:]
                block[0] = re.sub(r'^export\s+function', 'function', block[0])  # adding export is the move, not a change
                return (str(f.relative_to(ROOT)), norm(block))
    return (None, None)

def build_map():
    out = {}
    for name in TRACKED:
        rel, text = extract(name)
        if text is None:
            out[name] = {"missing": True}
        else:
            out[name] = {"file": rel, "sha": hashlib.sha256(text.encode()).hexdigest(), "lines": text.count("\n") + 1}
    return out

def cmd_snapshot(label):
    SNAP_DIR.mkdir(exist_ok=True)
    m = build_map()
    (SNAP_DIR / f"{label}.json").write_text(json.dumps(m, indent=2))
    found = sum(1 for v in m.values() if "sha" in v)
    print(f"snapshot '{label}': {found}/{len(TRACKED)} components hashed -> .move-snapshots/{label}.json")
    for n, v in m.items():
        print(f"  {'MISSING' if v.get('missing') else v['sha'][:12]}  {n}  {v.get('file','-')}  ({v.get('lines','?')} lines)")

def cmd_check(label):
    snap = json.loads((SNAP_DIR / f"{label}.json").read_text())
    cur = build_map()
    bad = []
    for name in TRACKED:
        was, now = snap.get(name, {}), cur.get(name, {})
        if was.get("missing"):
            continue  # wasn't tracked at snapshot time
        if now.get("missing"):
            bad.append(f"  MISSING NOW: {name} (was in {was.get('file')})"); continue
        if was.get("sha") != now.get("sha"):
            bad.append(f"  CHANGED: {name}  {was.get('file')} -> {now.get('file')}  "
                       f"({was.get('lines')} -> {now.get('lines')} lines)")
        else:
            print(f"  OK (identical)  {name}  {was.get('file')} -> {now.get('file')}")
    if bad:
        print("\nBYTE-IDENTITY CHECK FAILED — a move changed code:")
        print("\n".join(bad))
        sys.exit(1)
    print("\nbyte-identity check passed: every tracked component is unchanged by the move.")

if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in ("snapshot", "check"):
        print(__doc__); sys.exit(2)
    (cmd_snapshot if sys.argv[1] == "snapshot" else cmd_check)(sys.argv[2])
