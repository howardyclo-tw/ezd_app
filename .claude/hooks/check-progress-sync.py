#!/usr/bin/env python3
"""PreToolUse hook: BLOCK `git commit` when src/e2e/supabase changes are staged
without .superpowers/sdd/progress.md staged alongside.

Policy: mtk-execution-playbook.md 進度同步規則 — every task commit updates the
ledger IN THE SAME COMMIT. Upgraded 2026-07-06 from warn to hard block after the
D1/D2/D3 session proved warnings get ignored under context pressure.

Bypass (deliberate, one-shot): touch .claude/allow-commit-nosync
The flag is consumed (deleted) on use so it can't linger.
"""
import sys, json, os, re, subprocess

try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)

cmd = (d.get("tool_input") or {}).get("command", "") or ""

GIT_COMMIT = r"(?:^|[;&|]\s*)git(?:\s+-\S+(?:\s+[^-\s]\S*)?)*\s+commit\b"
if not re.search(GIT_COMMIT, cmd):
    sys.exit(0)

root = os.environ.get("CLAUDE_PROJECT_DIR", ".")

bypass = os.path.join(root, ".claude", "allow-commit-nosync")
if os.path.exists(bypass):
    try:
        os.remove(bypass)  # one-shot
    except OSError:
        pass
    sys.exit(0)

try:
    staged = subprocess.check_output(
        ["git", "diff", "--cached", "--name-only"],
        cwd=root, text=True, timeout=5
    ).strip().split("\n")
except Exception:
    sys.exit(0)

has_source = any(
    f.startswith(("src/", "e2e/", "supabase/")) for f in staged if f
)
has_progress = any("progress.md" in f for f in staged if f)

if has_source and not has_progress:
    sys.stderr.write(
        "BLOCKED by SDD hook (playbook 進度同步規則): this commit stages src/e2e/supabase "
        "changes but .superpowers/sdd/progress.md is NOT staged. Append the task ledger "
        "entry and `git add .superpowers/sdd/progress.md`, then retry. "
        "Also verify dispatch-log.jsonl was appended for this task. "
        "Deliberate bypass (rare): touch .claude/allow-commit-nosync"
    )
    sys.exit(2)

sys.exit(0)
