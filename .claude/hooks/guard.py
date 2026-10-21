#!/usr/bin/env python3
"""Claude Code hooks for DigiAlto software projects (from the DigiAlto-Ops eng-project kit).

  guard.py pre      PreToolUse  -> block writes to secret files and outside the repo
  guard.py post     PostToolUse -> format the file if the project's formatter is installed,
                                   then warn Claude about debug leftovers and unsafe JS
  guard.py session  SessionStart -> short git brief

Exit 2 = message to Claude (blocks in pre; feedback only in post). Never needs network.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

SECRET_RX = re.compile(r"(^|/)(\.env(\.(?!(example|sample|template)$)[^/]+)?|\.secrets/.*|.*\.(pem|key|p12|pfx)|id_(rsa|ed25519)(\.pub)?)$")
JS_SUFFIXES = {".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"}
PRETTIER_SUFFIXES = JS_SUFFIXES | {".css", ".scss", ".json", ".html", ".md", ".yml", ".yaml"}
DEBUG_JS = re.compile(r"^\s*(console\.log\(|debugger\b)")
DEBUG_PY = re.compile(r"^\s*(print\(|breakpoint\(\)|import pdb)")
UNSAFE_JS = re.compile(r"(?<![\w$.])eval\s*\(|\bnew\s+Function\s*\(|\bdocument\.write(ln)?\s*\(|"
                       r"dangerouslySetInnerHTML|\bset(Timeout|Interval)\s*\(\s*[\"'`]")
# Tests, specs, e2e and CLI scripts may print and use page.$eval freely.
EXEMPT_RX = re.compile(r"(^|/)(tests?|__tests__|e2e|scripts|bin)/|(^|/)test_[^/]*$|[._-](test|spec)\.[^/]+$")


def project_dir(data: dict) -> Path:
    return Path(os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or ".").resolve()


def run_quiet(cmd: list[str], cwd: Path) -> None:
    try:
        subprocess.run(cmd, cwd=cwd, capture_output=True, timeout=30)
    except Exception:
        pass


def format_file(path: Path, root: Path) -> None:
    prettier = root / "node_modules" / ".bin" / "prettier"
    if path.suffix in PRETTIER_SUFFIXES and prettier.exists():
        run_quiet([str(prettier), "--write", str(path)], root)
    elif path.suffix == ".py" and shutil.which("ruff"):
        run_quiet(["ruff", "format", str(path)], root)


def leftovers(path: Path, written: str) -> list[str]:
    """Check only the text this write added (Write content / Edit new_string), not the whole file,
    so an old console.log elsewhere doesn't nag on every edit."""
    if EXEMPT_RX.search(path.as_posix()):
        return []
    out = []
    for n, line in enumerate(written.splitlines(), 1):
        if path.suffix in JS_SUFFIXES and DEBUG_JS.search(line):
            out.append(f"{n}: debug leftover: {line.strip()}")
        if path.suffix in JS_SUFFIXES and UNSAFE_JS.search(line):
            out.append(f"{n}: unsafe JS (eval / new Function / document.write / dangerouslySetInnerHTML): {line.strip()}")
        if path.suffix == ".py" and DEBUG_PY.search(line):
            out.append(f"{n}: debug leftover: {line.strip()}")
    return out[:10]


def session(root: Path) -> int:
    def git(*a: str) -> str:
        try:
            return subprocess.run(["git", *a], cwd=root, capture_output=True, text=True, timeout=5).stdout.strip()
        except Exception:
            return ""
    dirty = [l for l in git("status", "--porcelain").splitlines() if l]
    print(f"[project brief] branch: {git('branch', '--show-current') or '?'} · uncommitted: {len(dirty)}")
    log = git("log", "--oneline", "-3")
    if log:
        print("recent commits:\n" + log)
    return 0


def main(argv: list[str]) -> int:
    mode = argv[1] if len(argv) > 1 else "post"
    try:
        data = json.load(sys.stdin) if mode != "session" else {}
    except Exception:
        data = {}
    root = project_dir(data)
    if mode == "session":
        return session(root)

    tool_input = data.get("tool_input") or {}
    file_path = tool_input.get("file_path") or ""
    if not file_path:
        return 0
    target = Path(file_path) if os.path.isabs(file_path) else root / file_path
    target = target.resolve()

    if mode == "pre":
        if SECRET_RX.search(target.as_posix()):
            print(f"Blocked: {file_path} is a secrets file. Use environment variables; "
                  "put fake values in .env.example.", file=sys.stderr)
            return 2
        # Claude Code's own plan, memory and scratchpad files live outside the project.
        allowed = [root, Path.home() / ".claude"]
        if data.get("scratchpad_dir"):
            allowed.append(Path(data["scratchpad_dir"]).resolve())
        if not any(target.is_relative_to(a) for a in allowed):
            print(f"Blocked: {file_path} is outside the project.", file=sys.stderr)
            return 2
        return 0

    if target.exists() and target.is_relative_to(root):
        format_file(target, root)
        written = tool_input.get("content") or tool_input.get("new_string") or ""
        found = leftovers(target, written)
        if found:
            print(f"Review {target.relative_to(root)}:\n- " + "\n- ".join(found) +
                  "\nRemove debug leftovers and unsafe calls unless this is intentional.", file=sys.stderr)
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
