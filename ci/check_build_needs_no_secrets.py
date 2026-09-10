#!/usr/bin/env python3
"""
`next build` must not require live Supabase credentials.

Roughly thirty modules do `const supabase = createClient()` at module scope. If that call constructs
the client eagerly, merely IMPORTING one of them throws when the env vars are absent — so static
generation of "/" fails and the production build depends on credentials being present at build time.

That is not hypothetical: Dependabot pull requests are deliberately denied Actions secrets, so every
one of them failed with "Your project's URL and API key are required" while prerendering "/".

The client is therefore constructed LAZILY, on first property access. This guard keeps it that way.

    python3 ci/check_build_needs_no_secrets.py
"""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "lib" / "supabase.ts"


def main() -> int:
    src = SRC.read_text(encoding="utf-8")
    code = "\n".join(re.sub(r"//.*$", "", l) for l in re.sub(r"/\*.*?\*/", " ", src, flags=re.S).split("\n"))
    fails: list[str] = []

    m = re.search(r"export function createClient\(\)[^{]*\{(.*?)\n\}", code, re.S)
    if not m:
        fails.append("lib/supabase.ts: createClient() not found — guard is miswired")
    else:
        body = m.group(1)
        if "new Proxy" not in body:
            fails.append("lib/supabase.ts: createClient() no longer defers construction — a bare "
                         "createBrowserClient() call makes `next build` require live credentials")
        # The construction must sit inside a function, not run on the way out of createClient().
        direct = re.search(r"return\s+createBrowserClient\s*\(", body)
        if direct:
            fails.append("lib/supabase.ts: createClient() returns createBrowserClient(...) directly — "
                         "that is eager construction again")

    for x in fails:
        print("FAIL", x)
    if fails:
        return 1
    print("PASS the Supabase client is constructed lazily; `next build` needs no credentials")
    return 0


if __name__ == "__main__":
    sys.exit(main())
