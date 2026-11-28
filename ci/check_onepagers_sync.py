"""212.136 / 212.138 (owner): the marketing one-pagers are generated from lib/capabilities.json. GitHub's "Marketing
one-pagers in sync" lane failed on 212.136 because the capability list changed and the sheets were not regenerated.
Lesson → guard: the committed text manifest must equal what the capability list produces.

212.138: this guard first ran the PDF generator, which needs reportlab — not installed in the application lane, which
then failed. It now checks the text manifest only (marketing/onepager_manifest, standard library only): the manifest is
exactly the sheets' content, so a stale manifest is a stale sheet. The PDFs themselves are rebuilt and diffed by the
marketing lane, which installs reportlab."""
import os, sys
from pathlib import Path
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "marketing"))
from onepager_manifest import manifest_text, MANIFEST_PATH  # noqa: E402

want = manifest_text()
have = Path(MANIFEST_PATH).read_text(encoding="utf-8") if os.path.exists(MANIFEST_PATH) else None
if have != want:
    raise SystemExit("one-pagers: marketing/onepager-content.txt is stale against lib/capabilities.json — run 'npm run gen:onepagers' and include the content file and the two PDFs in public/")
print("one-pagers in sync: PASS (the text manifest matches lib/capabilities.json; PDFs are rebuilt by the marketing lane)")
