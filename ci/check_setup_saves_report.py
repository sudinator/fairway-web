#!/usr/bin/env python3
"""212.51 (owner, Oct 26: "It doesn't look like it saved … there is no message either way") — every setup save on the game
screen reports the server's answer (the shared `saved(error, what, ok?)` routine): since 0221/0222 the server refuses
what the app refuses, and a save that ignored the answer became a silent failure."""
import pathlib, re, sys
t = (pathlib.Path(__file__).resolve().parent.parent / "components/tournaments.tsx").read_text(encoding="utf-8")
HANDLERS = ["completeSetup", "overridePlayerHandicap", "setManualHandicap", "setPlayerTee", "toggleNoShow", "removePlayer",
            "renameGame", "setGameDate", "setAllowance", "reopenGame", "setScrambleSettings"]
bad = []
for h in HANDLERS:
    m = re.search(r"\n  const %s = async[^\n]*\n(.*?)\n  };\n" % h, t, re.S)
    if not m: bad.append(f"{h}: not found"); continue
    body = m.group(1)
    if "saved(" not in body and "if (error)" not in body: bad.append(f"{h}: its save must report the server's answer (saved(...))")
    for line in body.split("\n"):
        if re.search(r"^\s*await supabase\.from\(\"(games|game_players)\"\)\.(update|insert|delete)", line) or re.search(r"^\s*await supabase\s*$", line):
            bad.append(f"{h}: a save whose answer is ignored — `{line.strip()[:70]}`")
if "const saved = (error:" not in t: bad.append("the shared saved(...) routine is missing")
if bad: print("SETUP SAVES REPORT: FAIL\n  " + "\n  ".join(bad)); sys.exit(1)
print(f"setup saves report: PASS ({len(HANDLERS)} setup saves report the server's answer)")
