#!/usr/bin/env python3
"""PreToolUse hook: block `git push` unless .claude/allow-push exists.
Policy: CLAUDE.md §2 — never push without the user's explicit request.
When the user explicitly asks to push: `touch .claude/allow-push`, push, then remove it.
"""
import sys, json, os, re

try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)

cmd = (d.get("tool_input") or {}).get("command", "") or ""
# Match only a `git` invocation whose SUBCOMMAND is push (allows global flags like
# -C <dir>, -c k=v, --work-tree=x). Does NOT fire on "push" inside messages/paths.
GIT_PUSH = r"(?:^|[;&|]\s*)git(?:\s+-\S+(?:\s+[^-\s]\S*)?)*\s+push\b"
if re.search(GIT_PUSH, cmd):
    root = os.environ.get("CLAUDE_PROJECT_DIR", ".")
    if not os.path.exists(os.path.join(root, ".claude", "allow-push")):
        sys.stderr.write(
            "BLOCKED by project hook (CLAUDE.md §2): git push requires the user's explicit request. "
            "If the user just asked to push: touch .claude/allow-push && git push ... && rm .claude/allow-push"
        )
        sys.exit(2)
sys.exit(0)
