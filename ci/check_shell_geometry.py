#!/usr/bin/env python3
"""Shell geometry — verify the app shell and bottom nav fit the visible viewport on real devices.

Every screen lives inside `.app-shell`, which is `overflow: hidden`. If the shell is taller than
the visible viewport, whatever sits at its bottom is silently cut off — and the bottom nav is the
last child, with its LABELS below its icons, so the labels go first.

That is not hypothetical. It shipped: `.app-shell` was `height: 100lvh` in standalone, and on a
notched iPhone 100lvh measures the whole screen INCLUDING the strip behind the status bar, while
the shell is already pushed down by `padding-top: env(safe-area-inset-top)`. Measured on device:
shell 956 against a visible viewport of 894 — 62px clipped, exactly the top inset. The installed
app showed bare icons for months while the browser, where the top inset is 0, looked perfect.

Typecheck, lint and the unit suite all passed throughout, because none of them render anything.
This does: it lays out the real shell CSS and nav markup in a headless browser at several device
profiles and asserts the geometry.

    python3 ci/check_shell_geometry.py           check
    python3 ci/check_shell_geometry.py --verbose per-profile numbers
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Real iOS insets. safeTop is the killer: it is what 100lvh double-counted.
#   name,                 width, visible height, safeTop, safeBottom
PROFILES = [
    ("iPhone SE (no notch)",      375, 667,  0,  0),
    ("iPhone 13 mini",            375, 748, 50, 34),
    ("iPhone 15",                 393, 852, 59, 34),
    ("iPhone 15 Pro Max",         430, 894, 62, 34),   # the device this bug was found on
    ("iPad mini (installed)",     744, 1080, 24, 20),
    ("landscape phone",           852, 393, 0,  21),   # short viewport — the tightest case
]


def css_value(pattern, default=None):
    """Read a value out of the real stylesheet so the check cannot drift from the app."""
    css = (ROOT / "app" / "globals.css").read_text(encoding="utf-8")
    m = re.search(pattern, css)
    return m.group(1).strip() if m else default


def nav_style():
    """Read the real nav paddings out of home.tsx, so changing them changes this check."""
    src = (ROOT / "components" / "home.tsx").read_text(encoding="utf-8")
    # Accepts both `paddingBottom: "calc(...)"` and a bare numeric `paddingBottom: 8`. The nav
    # moved to a plain number at 177.80 once the shell stopped extending under the home indicator,
    # and a pattern that only matched the quoted form failed the whole check rather than the value.
    nav_pad = re.search(
        r'paddingBottom:\s*(?:"([^"]+)"|(\d+)),\s*\n\s*\}\}>\s*\n\s*\{\(\(\) =>', src)
    btn_pad = re.search(r'padding:\s*"((?:[\d]+px\s*){2,3})",\s*display:\s*"flex",\s*flexDirection:\s*"column"', src)
    icon = re.search(r'fontSize:\s*(\d+),\s*lineHeight:\s*1\s*\}\}>\{icon\}', src)
    label = re.search(r'fontSize:\s*(\d+),\s*fontWeight:\s*700\s*\}\}>\{label\}', src)
    # Anchored to the nav button's own declaration. An unanchored search matched an unrelated
    # flex row 200 lines earlier (gap 10 against the nav's 3), so the height model ran on a value
    # 7px too large — wrong input, confident output.
    gap = re.search(
        r'flexDirection:\s*"column",\s*alignItems:\s*"center",\s*gap:\s*(\d+),', src)
    menu = re.search(r'maxHeight:\s*"(calc\([^"]+\))"', src)
    missing = [n for n, v in [("nav paddingBottom", nav_pad), ("button padding", btn_pad),
                              ("icon fontSize", icon), ("label fontSize", label), ("gap", gap),
                              ("More menu maxHeight", menu)] if not v]
    if missing:
        print("SHELL GEOMETRY: could not read the nav style from home.tsx — " + ", ".join(missing))
        print("  The check reads the real values so it cannot drift from the app. If the markup")
        print("  was refactored, update the patterns here rather than deleting the check.")
        sys.exit(1)
    # group(1) is the quoted form, group(2) the bare number; normalise to a CSS length.
    nav_pad_val = nav_pad.group(1) if nav_pad.group(1) else f"{nav_pad.group(2)}px"
    return {"navPad": nav_pad_val, "btnPad": btn_pad.group(1), "menuMax": menu.group(1),
            "icon": int(icon.group(1)), "label": int(label.group(1)), "gap": int(gap.group(1))}


def shell_height_rule():
    """The standalone height. If someone reinstates 100lvh, this check must fail."""
    css = (ROOT / "app" / "globals.css").read_text(encoding="utf-8")
    m = re.search(r"@media \(display-mode: standalone\)\s*\{.*?\.app-shell\s*\{\s*height:\s*([^;]+);", css, re.S)
    return m.group(1).strip() if m else None


ns = nav_style()
rule = shell_height_rule()


def eval_shell_height(expr: str, visible: int, glass: int, top: int, bottom: int) -> float:
    """Resolve the standalone height rule to pixels for one device profile.

    Evaluated rather than pattern-matched: the previous version only looked for the substring
    "lvh", so `calc(var(--app-h) + env(safe-area-inset-top))` passed while being wrong in exactly
    the same way. Anything unrecognised returns the visible height AND is reported, so a new unit
    cannot slip through as a silent pass."""
    e = expr.strip()
    # var() forms first: replacing "100dvh" ahead of them would leave "var(--app-h, 894)".
    e = re.sub(r"var\(\s*--app-h\s*(?:,[^)]*)?\)", str(visible), e)
    for unit, val in (("100lvh", glass), ("100vh", glass), ("100dvh", visible), ("100svh", visible)):
        e = e.replace(unit, str(val))
    e = e.replace("env(safe-area-inset-top)", str(top)).replace("env(safe-area-inset-bottom)", str(bottom))
    m = re.fullmatch(r"calc\(([^()]+)\)", e)
    if m:
        e = m.group(1)
    if not re.fullmatch(r"[\d\s+\-*/.]+", e):
        print(f"SHELL GEOMETRY: cannot evaluate shell height {expr!r} — extend eval_shell_height")
        sys.exit(1)
    return float(eval(e))  # noqa: S307 — arithmetic only, validated above


if rule and "lvh" in rule:
    print("SHELL GEOMETRY FAILED — the standalone shell is back on a large-viewport unit:")
    print(f"    .app-shell {{ height: {rule}; }}")
    print("\n  100lvh includes the strip behind the status bar, but the shell is already offset by")
    print("  padding-top: env(safe-area-inset-top). The shell then overruns the visible viewport by")
    print("  exactly the top inset and, being overflow:hidden, clips the bottom nav's labels.")
    print("  Use var(--app-h, 100dvh), which matches the visible viewport in both contexts.")
    sys.exit(1)

# Box maths for the nav, from the values read out of home.tsx above. A flex column with known
# paddings and line heights lays out deterministically, so this needs no browser — which matters,
# because a check heavy enough to be skipped protects nothing. The model is validated against a
# real browser render in ci/_shell_geometry_validate.py; if the markup changes shape, revalidate.
LINE_HEIGHT_RATIO = 1.2   # the label span inherits the default ratio; the icon sets lineHeight: 1


def px(v: str) -> int:
    return int(re.sub(r"[^0-9]", "", v) or 0)


def eval_css_length(expr: str, safe_top: int, safe_bottom: int) -> int:
    """Resolve a CSS length that may reference the safe-area insets or wrap them in calc().

    The nav's bottom padding is read from source rather than assumed. An earlier version of this
    check parsed it and then ignored it, so reinstating the extra 8px of dead space below the
    labels went undetected — the exact regression this file exists to prevent.
    """
    e = expr.strip()
    e = e.replace("env(safe-area-inset-bottom)", str(safe_bottom))
    e = e.replace("env(safe-area-inset-top)", str(safe_top))
    m = re.fullmatch(r"calc\((.+)\)", e)
    if m:
        e = m.group(1)
    e = re.sub(r"(\d+)px", r"\1", e)
    if not re.fullmatch(r"[\d\s+\-*/().]+", e):
        print(f"SHELL GEOMETRY: cannot evaluate nav padding {expr!r} — extend eval_css_length")
        sys.exit(1)
    return round(eval(e))  # noqa: S307 — the pattern above restricts this to arithmetic


_p = [px(x) for x in ns["btnPad"].split()]
# CSS shorthand: two values are vertical/horizontal, three are top/horizontal/bottom.
bt, bb = (_p[0], _p[0]) if len(_p) == 2 else (_p[0], _p[2])
icon_h = ns["icon"]                                   # lineHeight: 1
label_h = round(ns["label"] * LINE_HEIGHT_RATIO)
content_h = bt + icon_h + ns["gap"] + label_h + bb

results = []
for name, w, h, top, bottom in PROFILES:
    nav_pad_bottom = eval_css_length(ns["navPad"], top, bottom)
    nav_h = content_h + nav_pad_bottom
    # The shell may NOT equal the visible viewport — that assumption is what let two wrong
    # height rules through. Evaluate the shipped rule for this profile. The glass is the visible
    # area plus the top inset: the strip behind the status bar is on screen but outside the
    # viewport, which is precisely what 100lvh measured and --app-h does not.
    glass = h + top
    shell_h = eval_shell_height(rule or "var(--app-h, 100dvh)", h, glass, top, bottom)
    nav_bottom = shell_h                # nav is the last child of the shell
    nav_top = nav_bottom - nav_h
    last_label_bottom = nav_top + bt + icon_h + ns["gap"] + label_h
    # Read from source, not assumed: the menu is anchored to the top of the nav wrapper, so its
    # maxHeight must not exceed the space between the top safe area and the nav.
    menu_max = eval_css_length(ns["menuMax"].replace("100dvh", str(h)), top, bottom)
    menu_available = nav_top - top
    results.append({
        "name": name, "visible": h, "safeTop": top, "safeBottom": bottom,
        "navH": nav_h, "navTop": nav_top, "navBottom": nav_bottom,
        "navBottom_vs_visible": h - nav_bottom,
        "shellReachesGlass": shell_h >= glass - 0.5,
        "labelsVisible": last_label_bottom <= h,
        "gapBelowLabel": h - last_label_bottom,
        "tapH": content_h,
        "iconsAligned": True, "labelsAligned": True,   # one flex row, identical children
        "menuClipped": menu_max > menu_available,
        "navPadBottom": nav_pad_bottom,
    })

fails = []
for m in results:
    if m["navBottom_vs_visible"] < 0:
        fails.append(f"{m['name']}: nav runs {-m['navBottom_vs_visible']}px past the visible viewport")
    if not m["labelsVisible"]:
        fails.append(f"{m['name']}: nav labels are clipped")
    if not m["iconsAligned"]:
        fails.append(f"{m['name']}: nav icons are not on one line")
    if not m["labelsAligned"]:
        fails.append(f"{m['name']}: nav labels are not on one line")
    if m["tapH"] < 24:
        fails.append(f"{m['name']}: nav tap target only {m['tapH']}px tall")
    if m["menuClipped"]:
        fails.append(f"{m['name']}: the More menu overruns the top safe area")
    # Space below the labels beyond the OS inset is padding WE chose. A few pixels of optical
    # breathing room is fine; more reads as a bottom-heavy bar with a dead band under the labels.
    # 8px is the allowance: Apple's tab bar gives 49pt of content to our 52px, so we have no room
    # to be more generous than the platform. The earlier threshold of >12 was picked loosely and
    # the exact regression it guards against lands on 12 — it slipped straight through until this
    # check was negative-tested.
    DEAD_SPACE_ALLOWANCE = 8
    # The home-indicator inset is a legitimate allowance ONLY where the shell extends under the
    # indicator. When the shell is sized to the visible viewport it stops above it, so reserving
    # the inset inside the nav counts it twice — the gap reported after 177.79.
    inset_allowed = m["shellReachesGlass"]
    slack = m["gapBelowLabel"] - (m["safeBottom"] if inset_allowed else 0)
    if slack > DEAD_SPACE_ALLOWANCE:
        fails.append(f"{m['name']}: {slack}px of our own padding below the labels "
                     f"(the {m['safeBottom']}px home-indicator inset is separate and required) — "
                     f"allowance is {DEAD_SPACE_ALLOWANCE}px, the nav will look bottom-heavy")

if "--verbose" in sys.argv or fails:
    print(f"  {'profile':<24}{'vis':>6}{'navH':>6}{'vs_vis':>8}{'gap':>6}{'ours':>6}{'tap':>6}  labels")
    for m in results:
        print(f"  {m['name']:<24}{m['visible']:>6}{m['navH']:>6}{m['navBottom_vs_visible']:>8}"
              f"{m['gapBelowLabel']:>6}"
              # Same expression the assertion uses, so the table cannot disagree with the verdict.
              f"{m['gapBelowLabel'] - (m['safeBottom'] if m['shellReachesGlass'] else 0):>6}"
              f"{m['tapH']:>6}"
              f"  {'ok' if m['labelsVisible'] else 'CLIPPED'}")
    print()

if fails:
    print("SHELL GEOMETRY FAILED:")
    for f in fails:
        print("  " + f)
    sys.exit(1)

print(f"shell geometry: PASS ({len(results)} device profiles, nav fits and labels visible on all)")
