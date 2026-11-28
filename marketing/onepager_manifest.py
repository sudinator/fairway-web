"""The one-pagers' text manifest (marketing/onepager-content.txt), built from lib/capabilities.json with no third-party
imports — so ci/check_onepagers_sync.py can check it in any lane, while marketing/make_onepagers.py (which needs
reportlab for the PDFs) writes it. 212.138: split out after the application lane failed on a missing reportlab."""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST_PATH = os.path.join(ROOT, "marketing", "onepager-content.txt")


def load_capabilities():
    with open(os.path.join(ROOT, "lib", "capabilities.json"), encoding="utf-8") as f:
        return json.load(f)


def cards_for(cap, edition):
    # edition: "club" or "tgc". Include cards tagged "all" or that edition.
    return [c for c in cap["cards"] if "all" in c["editions"] or edition in c["editions"]]


def manifest_text(cap=None):
    # Deterministic text dump of exactly what the sheets contain, LF-only.
    cap = cap or load_capabilities()
    lines = ["Birdie Num Num one-pager content (auto-generated from lib/capabilities.json)", "", "TAGLINE: " + cap["tagline"], ""]
    for ed, label in [("club", "CLUB EDITION"), ("tgc", "TGC EDITION")]:
        lines.append("== " + label + " ==")
        for c in cards_for(cap, ed):
            lines.append(f"- {c['title']}: {c['body']}")
        if ed == "tgc":
            lines.append("  TGC EXCLUSIVES:")
            for x in cap["tgcExclusives"]:
                lines.append(f"   * {x['title']}: {x['body']}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"
