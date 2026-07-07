#!/usr/bin/env python3
"""PreToolUse hook (Edit|Write): WARN when a non-/agy agent modifies CSS-heavy
frontend files. Policy: CLAUDE.md §1 dispatch table — frontend visual work
should go through /agy (Gemini), not Opus/Fable directly.

Heuristic: file is a React component (.tsx in components/ or app/) AND the edit
contains substantial className changes (>3 className occurrences in the diff).
This is a WARNING, not a hard block — the orchestrator can make trivial CSS
fixes (< 5 lines) per policy.

Detection: checks if the edit's old_string+new_string contain multiple className
references that differ, suggesting a visual restyle rather than a logic change.
"""
import sys, json, os, re

try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)

tool = d.get("tool_name", "") or ""
ti = d.get("tool_input") or {}

if tool not in ("Edit", "Write"):
    sys.exit(0)

fp = ti.get("file_path", "") or ""

# Only check React component files
if not re.search(r"\.(tsx|jsx)$", fp):
    sys.exit(0)
if not re.search(r"(components|app)/", fp):
    sys.exit(0)

# For Edit: check if className density is high in the diff
if tool == "Edit":
    old_s = ti.get("old_string", "") or ""
    new_s = ti.get("new_string", "") or ""
    diff_text = old_s + new_s

    old_cn = len(re.findall(r"className", old_s))
    new_cn = len(re.findall(r"className", new_s))

    # If both old and new have 4+ className references and they differ,
    # this looks like a visual restyle
    if old_cn >= 4 and new_cn >= 4 and old_s != new_s:
        sys.stderr.write(
            "WARNING (SDD UI visual guard): This edit modifies 4+ className "
            f"attributes in {os.path.basename(fp)}. Per CLAUDE.md §1 dispatch table, "
            "frontend VISUAL work should go through /agy (Gemini), not direct edits. "
            "If this is a trivial fix (<5 lines) or logic-only change, proceed. "
            "If this is a visual restyle, dispatch to /agy instead."
        )
        # Exit 0 = warning only, not a hard block
        sys.exit(0)

# For Write: check if it's a full rewrite of a component with heavy CSS
if tool == "Write":
    content = ti.get("content", "") or ""
    cn_count = len(re.findall(r"className", content))
    if cn_count >= 20:
        sys.stderr.write(
            f"WARNING (SDD UI visual guard): Writing {os.path.basename(fp)} with "
            f"{cn_count} className references. Per CLAUDE.md §1, frontend visual work "
            "should go through /agy (Gemini). If this is a restore/fix from a known "
            "reference, proceed. Otherwise dispatch to /agy."
        )

sys.exit(0)
