#!/usr/bin/env python3
"""PreToolUse hook: warn when git commit includes src/e2e changes but progress.md is not staged.
Policy: mtk-execution-playbook.md — every task commit must update the ledger.
Non-blocking (exit 0 with stderr warning), not a hard block.
"""
import sys, json, os, re, subprocess

try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)

cmd = (d.get("tool_input") or {}).get("command", "") or ""

# Only trigger on git commit commands (not git commit --amend, etc.)
GIT_COMMIT = r"(?:^|[;&|]\s*)git\s+commit\b"
if not re.search(GIT_COMMIT, cmd):
    sys.exit(0)

# Check what's staged
try:
    staged = subprocess.check_output(
        ["git", "diff", "--cached", "--name-only"],
        cwd=os.environ.get("CLAUDE_PROJECT_DIR", "."),
        text=True, timeout=5
    ).strip().split("\n")
except Exception:
    sys.exit(0)

has_source = any(
    f.startswith("src/") or f.startswith("e2e/") or f.startswith("supabase/")
    for f in staged if f
)
has_progress = any(
    "progress.md" in f
    for f in staged if f
)

if has_source and not has_progress:
    sys.stderr.write(
        "⚠️  PROGRESS SYNC REMINDER: This commit includes source changes but "
        ".superpowers/sdd/progress.md is not staged. Per playbook rules, every "
        "task commit should update the ledger. Consider: git add .superpowers/sdd/progress.md"
    )

# Always allow (warning only, not blocking)
sys.exit(0)
