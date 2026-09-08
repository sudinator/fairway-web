#!/usr/bin/env python3
"""
Contracts for the public live-share route (app/live/[token]/page.tsx).

1. SCROLL. globals.css locks the document for iOS bounce prevention (html{overflow:hidden},
   body{position:fixed;overflow:hidden}); the app's only scroller lives inside .app-shell. The public
   route renders outside it, so before 184.1 the share page had NO scrolling element and everything
   below the fold was unreachable on every share link. The route must establish its own scroll
   container, and the global lock must stay put (relaxing it reintroduces rubber-banding in the app).

2. LABEL DIRECTION. The row highlights the winner's name. The margin beside it must therefore be read
   from the winning/leading side too. 184.0 highlighted Christopher and printed "lost 4 & 3" next to
   him, because the wording still came from the left player. No "lost"/"dn" in the Trifecta leg label.

    python3 ci/check_live_route_contract.py
"""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "app" / "live" / "[token]" / "page.tsx"
CSS = ROOT / "app" / "globals.css"


def main() -> int:
    fails: list[str] = []
    page = PAGE.read_text(encoding="utf-8")
    css = CSS.read_text(encoding="utf-8")

    # 1. scroll
    if "live-scroll" not in page:
        fails.append("live page root does not carry the live-scroll class — the route has no scroll container")
    if ".live-scroll" not in css:
        fails.append("globals.css has no .live-scroll rule")
    else:
        rule = css[css.index(".live-scroll"):]
        rule = rule[: rule.index("}") + 1]
        for prop in ("overflow-y: auto", "position: fixed", "overscroll-behavior: contain"):
            if prop not in rule:
                fails.append(f".live-scroll is missing `{prop}`")
    if 'minHeight: "100vh"' in page:
        fails.append("live page still uses minHeight:100vh — the scroll container is the viewport now")
    # the global lock must remain (it is what makes the app feel native on iOS)
    body_rule = re.search(r"\bbody\s*\{[^}]*\}", css)
    if not body_rule or "overflow: hidden" not in body_rule.group(0):
        fails.append("globals.css body no longer locks overflow — iOS bounce prevention was relaxed instead of scoped")

    # 2. label direction
    i = page.find("function contestLabel(")
    if i < 0:
        fails.append("could not locate contestLabel — guard is miswired")
        body = ""
    else:
        j = page.find("\nfunction ", i + 10)
        body = page[i : j if j > 0 else len(page)]
        # Comments explaining the old behaviour legitimately contain the banned words; check code only.
        body = "\n".join(l for l in body.split("\n") if not l.strip().startswith(("//", "*", "/*")))
    if body:
        for pattern, why in ((r"\blost\b", "lost"), (r"\bdn\b", "dn"), (r"aAhead", "aAhead")):
            if re.search(pattern, body):
                fails.append(f"contestLabel still phrases from the left player (`{why}`) while the row highlights the winner")

    for f in fails:
        print("FAIL", f)
    if fails:
        return 1
    print("PASS live route owns its scroll container and labels from the winning side")
    return 0


if __name__ == "__main__":
    sys.exit(main())
