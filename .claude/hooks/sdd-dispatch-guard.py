#!/usr/bin/env python3
"""PreToolUse hook (Agent|Workflow): BLOCK dispatching a money-critical REVIEW to a
weak model. Policy: CLAUDE.md §1 dispatch table — money/enrollment/pricing review
MUST be Opus 4.6, never Fable/Haiku. This exact violation happened in the
2026-07-06 D1/D2/D3 session (Fable dispatched to review confirmOrder/cancelOrder
changes after context compaction lost the rule).

Heuristic: (prompt/script mentions review) AND (mentions money surface) AND
(no explicit opus model — fable/haiku or inherit both fail, since the session
model may itself be Fable). Deliberate bypass: touch
.claude/allow-weak-money-review (consumed on use).
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
bypass = os.path.join(root, ".claude", "allow-weak-money-review")

# Gather text + declared models
if tool in ("Agent", "Task"):
    text = (ti.get("prompt") or "") + " " + (ti.get("description") or "")
    models = [(ti.get("model") or "").lower()]
else:  # Workflow
    text = (ti.get("script") or "")
    # scriptPath-based invocations: read the file so edits can't dodge the guard
    sp = ti.get("scriptPath")
    if sp:
        try:
            with open(sp if os.path.isabs(sp) else os.path.join(root, sp)) as f:
                text += " " + f.read()
        except OSError:
            pass
    models = re.findall(r"model\s*:\s*['\"]([^'\"]+)['\"]", text.lower())

REVIEW = r"review|reviewer|審查|覆核|驗證者|independent|implement|實作"  # money impl AND review both require opus
MONEY = (
    r"actions\.ts|pricing\.ts|card-utils|capacity\.ts|enroll_atomic|"
    r"confirmOrder|cancelOrder|rejectOrder|createCardOrder|createCourseFeeOrder|"
    r"submitGroupEnrollment|resubmitGroupEnrollment|deductCardsFIFO|"
    r"refund|扣卡|退款|訂單|報名|金流|migration"
)
STRONG = r"opus"  # money reviews must EXPLICITLY pin an opus model

is_review = re.search(REVIEW, text, re.IGNORECASE) is not None
is_money = re.search(MONEY, text, re.IGNORECASE) is not None
# Weak = fable/haiku OR no explicit model at all (inherits session model, which
# may be Fable — the exact hole that let the 2026-07-06 violation happen).
has_strong = any(re.search(STRONG, m or "") for m in models)

if is_review and is_money and not has_strong:
    if os.path.exists(bypass):
        try:
            os.remove(bypass)
        except OSError:
            pass
        sys.exit(0)
    sys.stderr.write(
        "BLOCKED by SDD dispatch guard (CLAUDE.md §1): this looks like a MONEY-CRITICAL "
        "REVIEW without an EXPLICIT opus model (weak model or inherited session model). "
        "Money/enrollment/pricing reviews MUST pin Opus: Workflow opts.model "
        "'claude-opus-4-6' (fallback 'claude-opus-4-8'), or Agent model 'opus'. "
        "If this is genuinely NOT a money review (e.g. a fable stage for docs inside a "
        "money workflow): touch .claude/allow-weak-money-review and retry."
    )
    sys.exit(2)

sys.exit(0)
