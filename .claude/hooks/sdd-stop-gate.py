#!/usr/bin/env python3
"""Stop hook: backstop for committed-but-unlogged work. Fires at most ONCE per stop
(respects stop_hook_active) and only when HEAD (< 24h old) touches src/e2e/supabase
without a progress.md update in the same commit — i.e. someone bypassed or predated
the commit gate. Normal mid-task turn-ends do NOT trigger (they have no fresh
unlogged commit).
"""
import sys, json, os, subprocess, time

try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)

if d.get("stop_hook_active"):
    sys.exit(0)  # never loop

root = os.environ.get("CLAUDE_PROJECT_DIR", ".")

def sh(args):
    try:
        return subprocess.check_output(args, cwd=root, text=True, timeout=5).strip()
    except Exception:
        return ""

head_ts = sh(["git", "log", "-1", "--format=%ct"])
if not head_ts or (time.time() - int(head_ts)) > 86400:
    sys.exit(0)

head_files = sh(["git", "show", "--name-only", "--format=", "HEAD"]).split("\n")
has_src = any(f.startswith(("src/", "e2e/", "supabase/")) for f in head_files if f)
has_ledger = any("progress.md" in f for f in head_files if f)

if has_src and not has_ledger:
    # Ledger updated in a later uncommitted state also counts as handled
    dirty = sh(["git", "status", "--porcelain", ".superpowers/sdd/progress.md"])
    if not dirty:
        sys.stderr.write(
            "SDD stop-gate: HEAD commits src/e2e changes but progress.md was not updated "
            "(commit-gate bypassed?). Backfill the ledger entry + dispatch-log.jsonl for "
            "this task now, then stop."
        )
        sys.exit(2)

sys.exit(0)
