#!/usr/bin/env python3
"""Open HTML pages in headless Chromium at phone width and report layout problems.

  python3 scripts/viewport_check.py <file-or-folder> [...] [--width 360]

Checks per page: horizontal overflow (no sideways scroll at 360px), JS errors in the console,
images without alt. Saves a full-page screenshot to tmp/viewport/<name>-<width>.png.

Needs the optional dev dependency: pip install -r requirements-dev.txt && playwright install chromium
If Playwright is missing it prints SKIPPED and exits 0, so it never blocks a machine without it.
Set CHROMIUM_PATH to use an existing Chromium instead of Playwright's download.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "tmp" / "viewport"

PROBE = """() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
  missingAlt: [...document.images].filter(i => !i.hasAttribute('alt')).map(i => i.src).slice(0, 5),
  widest: [...document.querySelectorAll('body *')]
    .filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
    .slice(0, 5).map(e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') +
      (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/).join('.') : '')),
})"""


def pages(args: list[str]) -> list[Path]:
    out: list[Path] = []
    for a in args:
        p = Path(a)
        out += sorted(p.rglob("*.htm*")) if p.is_dir() else [p]
    return [p for p in out if p.suffix.lower() in (".html", ".htm")]


def shot_name(path: Path, width: int) -> str:
    """Unique per page: every landing page is <folder>/site/index.html, so use the whole path."""
    try:
        rel = path.resolve().relative_to(ROOT)
    except ValueError:
        rel = Path(*path.resolve().parts[-3:])
    return "-".join(rel.with_suffix("").parts) + f"-{width}.png"


def main(argv: list[str]) -> int:
    width = 360
    if "--width" in argv:
        i = argv.index("--width")
        try:
            width = int(argv[i + 1])
        except (IndexError, ValueError):
            print("viewport_check: --width needs a number, e.g. --width 360")
            return 2
        del argv[i:i + 2]
    missing = [a for a in argv[1:] if not Path(a).exists()]
    for m in missing:
        print(f"FAIL {m}: does not exist")
    targets = pages([a for a in argv[1:] if a not in missing])
    if not targets:
        if not missing:
            print(__doc__)
        return 1 if missing else 2
    try:
        from playwright.sync_api import Error as PlaywrightError, sync_playwright
    except ImportError:
        print("viewport_check: SKIPPED (Playwright not installed; see requirements-dev.txt)")
        return 1 if missing else 0

    SHOTS.mkdir(parents=True, exist_ok=True)
    failed = len(missing)
    with sync_playwright() as pw:
        exe = os.environ.get("CHROMIUM_PATH")
        try:
            browser = pw.chromium.launch(executable_path=exe) if exe else pw.chromium.launch()
        except PlaywrightError as e:
            first = str(e).strip().splitlines()[0] if str(e).strip() else "launch failed"
            print(f"viewport_check: SKIPPED (no browser: {first}; run `playwright install chromium` "
                  "or set CHROMIUM_PATH)")
            return 1 if missing else 0
        for path in targets:
            page = browser.new_page(viewport={"width": width, "height": 800})
            errors: list[str] = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console", lambda m: errors.append(f"{m.text} ({m.location.get('url', '')})")
                    if m.type == "error" else None)
            page.goto(path.resolve().as_uri())
            page.wait_for_load_state("load")
            r = page.evaluate(PROBE)
            shot = SHOTS / shot_name(path, width)
            page.screenshot(path=str(shot), full_page=True)
            problems = []
            if r["scrollWidth"] > r["clientWidth"]:
                problems.append(f"horizontal overflow: {r['scrollWidth']}px > {r['clientWidth']}px "
                                f"(widest: {', '.join(r['widest']) or 'n/a'})")
            if r["missingAlt"]:
                problems.append(f"img without alt: {', '.join(r['missingAlt'])}")
            problems += [f"console/JS error: {e}" for e in errors]
            status = "FAIL" if problems else "ok  "
            failed += bool(problems)
            print(f"{status} {path} @ {width}px -> {shot.relative_to(ROOT)}")
            for pr in problems:
                print(f"     - {pr}")
            page.close()
        browser.close()
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
