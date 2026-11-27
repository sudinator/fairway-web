"""212.136 (owner, Nov 27): the marketing one-pagers are generated from lib/capabilities.json. GitHub's "Marketing one-pagers
in sync" lane failed on 212.136 because the capability list changed (the Colosseum) and the sheets were not regenerated
before hand-off — the clean-extract preflight never ran the generator. Lesson → guard: regenerate here and fail the bar when
the committed content differs, so the drop can never leave without them."""
import subprocess, sys
from pathlib import Path
root = Path(__file__).resolve().parents[1]
content = root / "marketing" / "onepager-content.txt"
before = content.read_text(encoding="utf-8") if content.exists() else None
try:
    import reportlab  # noqa: F401
except ImportError:
    raise SystemExit("one-pagers: reportlab is not installed (pip install reportlab) — the generator cannot run")
r = subprocess.run([sys.executable, str(root / "marketing" / "make_onepagers.py")], cwd=root, capture_output=True, text=True)
if r.returncode != 0:
    raise SystemExit(f"one-pagers: the generator failed\n{r.stdout}\n{r.stderr}")
after = content.read_text(encoding="utf-8")
if before != after:
    raise SystemExit("one-pagers: marketing/onepager-content.txt (and the two PDFs in public/) were stale — regenerated now; include them in the drop")
print("one-pagers in sync: PASS (regenerated from lib/capabilities.json; content unchanged)")
