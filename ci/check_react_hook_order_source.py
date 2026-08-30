#!/usr/bin/env python3
"""Lightweight pre-lint guard for React hook ordering regressions.

This is intentionally a source-level backstop, not a replacement for
eslint-plugin-react-hooks. It catches the common BNN regression pattern where
an exported function component contains a top-level early return before its
first top-level React hook call.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCAN_ROOTS = [ROOT / "app", ROOT / "components"]
COMPONENT_RE = re.compile(r"(?:export\s+)?function\s+([A-Z][A-Za-z0-9_]*)\s*\(")
HOOK_RE = re.compile(r"(?:(?:React\.)?use[A-Z][A-Za-z0-9_]*)\s*(?:<[^\n;{}]*>)?\s*\(")
RETURN_RE = re.compile(r"\breturn\b")


def sanitize(src: str) -> str:
    """Blank comments and string/template contents while preserving positions/braces."""
    out = list(src)
    i = 0
    n = len(src)
    while i < n:
        if src.startswith("//", i):
            j = src.find("\n", i + 2)
            if j < 0:
                j = n
            for k in range(i, j):
                out[k] = " "
            i = j
            continue
        if src.startswith("/*", i):
            j = src.find("*/", i + 2)
            if j < 0:
                j = n - 2
            end = min(n, j + 2)
            for k in range(i, end):
                if out[k] != "\n":
                    out[k] = " "
            i = end
            continue
        if src[i] in ('"', "'", "`"):
            quote = src[i]
            out[i] = " "
            i += 1
            while i < n:
                if src[i] == "\\":
                    out[i] = " "
                    if i + 1 < n:
                        if out[i + 1] != "\n":
                            out[i + 1] = " "
                        i += 2
                    else:
                        i += 1
                    continue
                ch = src[i]
                if ch == quote:
                    out[i] = " "
                    i += 1
                    break
                if out[i] != "\n":
                    out[i] = " "
                i += 1
            continue
        i += 1
    return "".join(out)


def matching_delimiter(src: str, start: int, opener: str, closer: str) -> int | None:
    depth = 0
    for i in range(start, len(src)):
        if src[i] == opener:
            depth += 1
        elif src[i] == closer:
            depth -= 1
            if depth == 0:
                return i
    return None


def top_level_positions(body: str, pattern: re.Pattern[str]) -> list[int]:
    positions: list[int] = []
    depth = 0
    matches = {m.start(): m for m in pattern.finditer(body)}
    for i, ch in enumerate(body):
        if i in matches and depth == 0:
            positions.append(i)
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
    return positions


def line_number(src: str, pos: int) -> int:
    return src.count("\n", 0, pos) + 1


def main() -> int:
    failures: list[str] = []
    checked = 0
    for root in SCAN_ROOTS:
        if not root.exists():
            continue
        for path in sorted(root.rglob("*.tsx")):
            raw = path.read_text(encoding="utf-8")
            clean = sanitize(raw)
            for m in COMPONENT_RE.finditer(clean):
                name = m.group(1)
                open_paren = clean.find("(", m.start(), m.end() + 1)
                if open_paren < 0:
                    continue
                close_paren = matching_delimiter(clean, open_paren, "(", ")")
                if close_paren is None:
                    continue
                body_start = clean.find("{", close_paren + 1)
                if body_start < 0:
                    continue
                body_end = matching_delimiter(clean, body_start, "{", "}")
                if body_end is None:
                    continue
                body = clean[body_start + 1:body_end]
                hooks = top_level_positions(body, HOOK_RE)
                if not hooks:
                    continue
                checked += 1
                returns = top_level_positions(body, RETURN_RE)
                if returns and returns[0] < hooks[0]:
                    abs_return = body_start + 1 + returns[0]
                    abs_hook = body_start + 1 + hooks[0]
                    failures.append(
                        f"{path.relative_to(ROOT)}:{line_number(clean, abs_return)} {name}: "
                        f"top-level return appears before first hook at line {line_number(clean, abs_hook)}"
                    )
    if failures:
        print("React hook-order source guard: FAIL")
        for failure in failures:
            print(f" - {failure}")
        print("Move hooks above top-level early returns, or refactor the component before relying on ESLint.")
        return 1
    print(f"React hook-order source guard: PASS ({checked} hook-using function components checked)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
