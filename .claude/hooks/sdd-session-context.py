#!/usr/bin/env python3
"""SessionStart hook (startup|resume|compact|clear): auto-inject SDD workflow
re-orientation into context. This is the deterministic fix for compaction amnesia —
after every compaction/new session, the agent sees the checklist + live repo state
WITHOUT having to remember to look.

stdout from a SessionStart hook is appended to Claude's context.
"""
import sys, json, os, subprocess

root = os.environ.get("CLAUDE_PROJECT_DIR", ".")

try:
    d = json.load(sys.stdin)
    source = d.get("source", "?")
except Exception:
    source = "?"

def sh(args):
    try:
        return subprocess.check_output(args, cwd=root, text=True, timeout=5).strip()
    except Exception:
        return ""

branch = sh(["git", "rev-parse", "--abbrev-ref", "HEAD"])
head = sh(["git", "log", "-1", "--format=%h %s"])
dirty_raw = sh(["git", "status", "--porcelain"])
dirty = [l for l in dirty_raw.split("\n") if l.strip()]
src_dirty = [l for l in dirty if any(p in l for p in ("src/", "e2e/", "supabase/"))]

# Was HEAD's src work logged in the same commit?
head_files = sh(["git", "show", "--name-only", "--format=", "HEAD"]).split("\n")
head_has_src = any(f.startswith(("src/", "e2e/", "supabase/")) for f in head_files if f)
head_has_ledger = any("progress.md" in f for f in head_files if f)
unlogged = head_has_src and not head_has_ledger

state = ""
state_path = os.path.join(root, ".superpowers", "sdd", "current-task.json")
try:
    with open(state_path) as f:
        state = f.read().strip()
except OSError:
    pass

ledger_tail = ""
try:
    with open(os.path.join(root, ".superpowers", "sdd", "progress.md")) as f:
        lines = [l.rstrip() for l in f.readlines() if l.strip()]
        ledger_tail = "\n".join(lines[-2:])
except OSError:
    pass

out = []
out.append(f"=== SDD WORKFLOW RE-ORIENT (auto-injected on {source}) ===")
out.append(f"branch: {branch} | HEAD: {head}")
if src_dirty:
    out.append(f"UNCOMMITTED src/e2e changes ({len(src_dirty)} files) — likely a task mid-flight:")
    out.extend("  " + l for l in src_dirty[:12])
if unlogged:
    out.append("⚠ HEAD commit touches src/e2e but did NOT update progress.md — backfill the ledger before new work.")
if state:
    out.append("current-task.json (semantic state — verify against git, may be stale):")
    out.append(state)
if ledger_tail:
    out.append("ledger tail:")
    out.append(ledger_tail)
out.append(
    "RULES (hook-enforced + CLAUDE.md §1.1): every MTK task = read plan/spec → tier "
    "(金流/混合/純UI/測試) → ground-truth brief → dispatch impl (backend→Opus4.6, UI外觀→/agy) "
    "→ tsc+scoped spec → INDEPENDENT review (money→Opus 4.6, NEVER fable; general→Fable; "
    "UI→gemini pro; reviewer alone runs full e2e) → append dispatch-log.jsonl + progress.md "
    "IMMEDIATELY → commit (hook blocks commit without ledger). If mid-task after compaction: "
    "backfill missing steps BEFORE continuing. Update current-task.json at each step transition."
)
out.append("=== END SDD RE-ORIENT ===")

print("\n".join(out))
sys.exit(0)
