#!/usr/bin/env python3
"""PreToolUse hook (Agent|Workflow): BLOCK dispatching a REVIEW to a truly weak
model (haiku). Policy: CLAUDE.md §1 dispatch table — reviews default to Fable 5;
fallback Opus 4.6 if Fable unavailable. Haiku is never acceptable for reviews.
Frontend visual reviews go to Gemini pro via /agy (not checked here — that's a
dispatch convention, not a safety gate).

Deliberate bypass: touch .claude/allow-weak-review (consumed on use).
"""
import sys, json, os, re

try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)

tool = d.get("tool_name", "") or ""
ti = d.get("tool_input") or {}

if tool not in ("Agent", "Task", "Workflow"):
    sys.exit(0)

root = os.environ.get("CLAUDE_PROJECT_DIR", ".")
bypass = os.path.join(root, ".claude", "allow-weak-review")

# Gather text + declared models
if tool in ("Agent", "Task"):
    text = (ti.get("prompt") or "") + " " + (ti.get("description") or "")
    models = [(ti.get("model") or "").lower()]
else:  # Workflow
    text = (ti.get("script") or "")
    sp = ti.get("scriptPath")
    if sp:
        try:
            with open(sp if os.path.isabs(sp) else os.path.join(root, sp)) as f:
                text += " " + f.read()
        except OSError:
            pass
    models = re.findall(r"model\s*:\s*['\"]([^'\"]+)['\"]", text.lower())

REVIEW = r"review|reviewer|審查|覆核|驗證者"
WEAK = r"haiku"  # Only haiku is blocked; fable and opus are both acceptable

is_review = re.search(REVIEW, text, re.IGNORECASE) is not None
has_weak = any(re.search(WEAK, m or "") for m in models)

if is_review and has_weak:
    if os.path.exists(bypass):
        try:
            os.remove(bypass)
        except OSError:
            pass
        sys.exit(0)
    sys.stderr.write(
        "BLOCKED by SDD dispatch guard (CLAUDE.md §1): this looks like a REVIEW "
        "dispatched to haiku, which is too weak for review tasks. "
        "Reviews should use Fable 5 (default) or Opus 4.6 (fallback). "
        "If this is genuinely not a review: touch .claude/allow-weak-review and retry."
    )
    sys.exit(2)

sys.exit(0)
