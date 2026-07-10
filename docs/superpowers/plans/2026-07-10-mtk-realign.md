# MTK 需求再對齊 — 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the 6 mechanisms from the 2026-07-10 realign design spec (v2) — waitlist engine, membership combined, staggered windows, admin early-bird, settings tabs, payment deadline — with comprehensive verification at every level (user story, UI, code, security). Additionally, backfill test gaps for existing features.

**Spec source:** `docs/superpowers/specs/2026-07-10-mtk-realign-design.md` (v2) + `docs/superpowers/specs/2026-07-07-payment-deadline-design.md`

**Prereqs completed:** S0 RLS hardening (migration 016, commit 62abe78); 5S spec realignment (commit 17b85b7).

**Inherits all constraints** from the main plan (`docs/superpowers/plans/2026-07-02-mtk-features.md`) — especially: no self-review, 100% important-feature coverage, test-scope policy, workflow contention rule, UX rules, doc sync at phase gate.

---

## Ground Truth Snapshot (2026-07-10)

### Current Test Inventory

| Category | Files | Count | Notes |
|---|---|---|---|
| Unit: pricing | pricing.test.ts | 16 | resolvePrice + isMemberActive |
| Unit: capacity | capacity.test.ts | 13 | computeSessionOccupancy |
| Unit: allocation | allocation.test.ts | 7 | fcfs allocate |
| Unit: card-window | card-window.test.ts | 24 | window open/close logic |
| Unit: card-purchase | card-purchase.test.ts | 37 | FIFO deduction + validation |
| **Unit subtotal** | **5 files** | **97** | |
| E2E features | 18 files | ~63 | enroll gating, identity, order lifecycle, register wizard, etc. |
| E2E journeys | 2 files | 8 | admin-journey(3), student-journey(5) |
| E2E regression | 7 files | ~13 | card, enroll, attendance, makeup, transfer, waitlist-cancel |
| **E2E subtotal** | **27 files** | **~84** | |
| **TOTAL** | **32 files** | **~181** | |

### Coverage Gap Analysis

| Feature Area | Happy | Adversarial | Security | Mutation | Gap |
|---|---|---|---|---|---|
| Card purchase | ✅ | ✅ | S0 | ✅ | — |
| Card window | ✅ | ✅ | — | — | — |
| Enroll gating (guards) | 2H | 4A | S0 | — | ⚠️ no mutation guards |
| Enroll identity | 2H | 3A | — | — | — |
| Order lifecycle (D1/D2/D3) | 1H | 3A | S0 | 1 | — |
| Register wizard | 7H | 0A | — | — | 🔴 adversarial: price tamper, duplicate submit |
| Register modify | 2H | 0A | — | — | 🔴 adversarial: modify confirmed order |
| Resubmit rebook | 2H | 1A | — | — | — |
| Waitlist cancel | 1H | 0A | — | — | 🔴 adversarial: cancel enrolled (not waitlist) |
| **NEW: Waitlist engine** | — | — | — | — | 🔴 ALL |
| **NEW: Membership combined** | — | — | — | — | 🔴 ALL |
| **NEW: Staggered windows** | — | — | — | — | 🔴 ALL |
| **NEW: Admin early-bird** | — | — | — | — | 🔴 ALL |
| **NEW: Payment deadline** | — | — | — | — | 🔴 ALL |
| **NEW: Settings tabs** | — | — | — | — | 🔴 UI |
| RLS post-S0 | — | — | — | — | 🔴 regression test |

### Guard Functions (actions.ts lines 35–112)

| Guard | Line | What it checks | Modified by |
|---|---|---|---|
| `guardPricingMode` | 35 | pricing_mode !== 'card' → reject | — |
| `guardEnrollFull` | 43 | enroll_full === false → reject | — |
| `guardEnrollSingle` | 51 | enroll_single === false → reject | — |
| `guardEnrollFullIdentity` | 59 | member-only + !isMember → reject | — |
| `guardEnrollSingleIdentity` | 67 | member-only + !isMember → reject | — |
| `guardGroupPhase1Window` | 80 | start > now → 尚未開始; end < now → 已截止 | 5T.3 (staggered) + 5T.4 (admin) |
| `guardCourseWindow` | 101 | start > now → 尚未開始; end < now → 已截止 | 5T.3 (staggered) + 5T.4 (admin) |

### Key Server Actions (will be modified)

| Action | Line | Modified by task |
|---|---|---|
| `enrollInCourse` | 123 | 5T.2 (waitlist path) |
| `batchEnrollInCourses` | 322 | 5T.2 (waitlist) + 5T.5 (membership carrier) |
| `batchEnrollInSessions` | 482 | 5T.2 (waitlist) |
| `cancelEnrollment` | 758 | 5T.2 (waitlist promote trigger) |
| `confirmOrder` | 3030 | 5T.5 (grantMembership unify) |
| `cancelOrder` | 2964 | 5T.2 (waitlist promote trigger) |
| `rejectOrder` | 3223 | 5T.2 (waitlist promote trigger) |
| `submitGroupEnrollment` | 3519 | 5T.5 (membership carrier) + 5U.2 (deadline) |
| `resubmitGroupEnrollment` | 3912 | 5U.2 (deadline recalc) |

### Migration Sequence

| # | Name | Content | Status |
|---|---|---|---|
| 016 | rls_hardening | DROP write policies + REVOKE RPCs | ✅ done (S0) |
| 017 | realign_schema | waitlist_enabled, nonmember_delay_days, include_membership backfill, promote_from_waitlist RPC, enroll_atomic v2 | pending |
| 018 | payment_deadline | course_groups.payment_deadline_days, enrollments.payment_deadline_at, enroll_atomic p_payment_deadline_at | pending |
| 019 | settings_seed | system_config seed missing keys + card_purchase_unit default=3 | pending |

---

## Phase 5T — Engine Core (Migration 017 + Server Logic)

> Engine-first: all server-side mechanisms before any UI. Spec §1–4 + §7.

### Task 5T.1: Migration 017 — realign_schema

**Tier:** 金流/守衛 (money/guard/RPC) → Opus 4.6, effort high

**Files:**
- Create: `supabase/migrations/017_realign_schema.sql`
- Modify: `src/types/database.ts` (add new column types)
- Apply via `mcp__supabase__apply_migration` to dev

**Scope:**
```sql
BEGIN;
-- 1. courses: waitlist + staggered
ALTER TABLE courses ADD COLUMN IF NOT EXISTS waitlist_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS nonmember_delay_days INTEGER;

-- 2. include_membership: already exists in live DB, add to repo formally
-- (backfill: ensure column exists; it does, but migration chain needs it)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS include_membership BOOLEAN DEFAULT false;

-- 3. enroll_atomic v2: add p_allow_waitlist + p_payment_deadline_at
CREATE OR REPLACE FUNCTION enroll_atomic(
  p_user_id UUID,
  p_course_id UUID,
  p_type TEXT,
  p_session_id UUID DEFAULT NULL,
  p_status TEXT DEFAULT 'enrolled',
  p_cards_to_deduct INTEGER DEFAULT 0,
  p_order_id UUID DEFAULT NULL,
  p_allow_waitlist BOOLEAN DEFAULT false,
  p_payment_deadline_at TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB AS $$ ... $$;
-- waitlist path: if capacity full + p_allow_waitlist → status='waitlist', waitlist_position=max+1

-- 4. promote_from_waitlist RPC
CREATE OR REPLACE FUNCTION promote_from_waitlist(
  p_course_id UUID,
  p_session_id UUID DEFAULT NULL
) RETURNS JSONB AS $$ ... $$;
-- SELECT min waitlist_position FOR UPDATE SKIP LOCKED
-- card mode → FIFO deduct; fail → skip, try next
-- ntd+price>0 → pending_payment (create course_fee order)
-- free/ntd-price-0 → enrolled
-- clear waitlist_position

COMMIT;
```

**Acceptance criteria:**
- [ ] Migration applies cleanly to dev DB
- [ ] `courses` table has `waitlist_enabled` (bool, default false) + `nonmember_delay_days` (int, nullable)
- [ ] `orders.include_membership` column exists (bool, default false)
- [ ] `enroll_atomic` accepts `p_allow_waitlist` + `p_payment_deadline_at` params
- [ ] `promote_from_waitlist` RPC exists and is callable by service role only (REVOKE from anon/authenticated in same migration)
- [ ] `database.ts` types updated
- [ ] `npx tsc --noEmit` clean

**Verification:**
- **Code level:** `npx tsc --noEmit` passes; `mcp__supabase__execute_sql` confirms columns + RPCs exist
- **Security level:** new RPCs REVOKE'd from anon+authenticated (service-role only via adminClient)

---

### Task 5T.2: Waitlist Engine — Server Actions

**Tier:** 金流/守衛 → Opus 4.6, effort high

**Files:**
- Modify: `src/lib/supabase/actions.ts` — enrollInCourse, batchEnrollInCourses, batchEnrollInSessions (add `courses.waitlist_enabled` fetch + pass `p_allow_waitlist` to enroll_atomic); cancelEnrollment, cancelOrder, rejectOrder (add waitlist promotion trigger)

**Scope:**
1. **Enroll path:** all enrollment callers fetch `courses.waitlist_enabled`, pass to `enroll_atomic`. When RPC returns `status='waitlist'`, caller returns `{ success: true, status: 'waitlist', position: N }`.
2. **Promote triggers:** after any successful seat-freeing action (cancelEnrollment, cancelOrder cascade, rejectOrder cascade), call `adminClient.rpc('promote_from_waitlist', { p_course_id, p_session_id })`.
3. **submitGroupEnrollment** already calls `batchEnrollInCourses` / `batchEnrollInSessions` — the waitlist param flows through.

**Acceptance criteria:**
- [ ] `enrollInCourse` with full course + `waitlist_enabled=true` → status='waitlist' + position returned
- [ ] `batchEnrollInCourses` with full course + waitlist → waitlist enrollment created
- [ ] `batchEnrollInSessions` with full course + waitlist → waitlist enrollment created
- [ ] `cancelEnrollment` triggers `promote_from_waitlist` for the freed course
- [ ] `cancelOrder` cascade triggers promotion
- [ ] `rejectOrder` cascade triggers promotion
- [ ] `npx tsc --noEmit` clean

**Verification — 4 levels:**

| Level | Test | ID |
|---|---|---|
| **User story** | 「課程額滿時，學員可加入候補；有人取消後自動遞補」 | US-WL |
| **Code** | enroll_atomic returns `{ok:true, status:'waitlist', waitlist_position:1}` when full + allowed | C-WL-1 |
| **Code** | promote_from_waitlist returns promoted enrollment ID | C-WL-2 |
| **Code** | card-mode promotion: FIFO deduct succeeds → enrolled | C-WL-3 |
| **Code** | card-mode promotion: insufficient cards → skip, promote next | C-WL-4 |
| **E2E happy** | Full course → enroll → waitlist → cancel occupant → auto-promoted to enrolled | H-WL-1 |
| **E2E happy** | Full card course → waitlist → cancel → auto-promoted + cards deducted | H-WL-2 |
| **E2E adversarial** | waitlist_enabled=false + full course → rejected (existing behavior preserved) | A-WL-1 |
| **E2E adversarial** | Card-mode waitlist + insufficient cards → skipped, next in line promoted | A-WL-2 |
| **E2E adversarial** | Concurrent cancel + enroll race → no double-occupy (RPC row lock) | A-WL-3 |
| **E2E mutation** | Remove promote trigger from cancelEnrollment → A-WL-1 test must still pass but H-WL-1 goes red (occupant cancelled but nobody promoted) | M-WL-1 |
| **Security** | promote_from_waitlist callable only via service role; client RPC call → permission denied | S-WL-1 |

**New e2e spec files:**
- `e2e/features/waitlist-engine.spec.ts` — H-WL-1, H-WL-2, A-WL-1, A-WL-2, A-WL-3, M-WL-1
- Update `e2e/global-setup.ts` — add fixture course with `waitlist_enabled=true` + capacity 1

---

### Task 5T.3: Staggered Windows — Guard Modifications

**Tier:** 混合 (server guard) → Opus 4.6, effort high

**Files:**
- Modify: `src/lib/supabase/actions.ts` — `guardGroupPhase1Window` (line 80) + `guardCourseWindow` (line 101): add `nonmember_delay_days` param, shift start for non-members
- Modify callers: `batchEnrollInCourses`, `batchEnrollInSessions`, `submitGroupEnrollment` — pass course's `nonmember_delay_days` + `isMember` to guards

**Scope:**
```typescript
// guardGroupPhase1Window: add params
async function guardGroupPhase1Window(
  supabase: any,
  courseGroupId: string | null,
  opts?: { nonmemberDelayDays?: number | null; isMember?: boolean; isAdmin?: boolean }
): Promise<string | null> {
  // ...existing fetch...
  const delayMs = (!opts?.isMember && !opts?.isAdmin && opts?.nonmemberDelayDays)
    ? opts.nonmemberDelayDays * 86400_000 : 0;
  const effectiveStart = new Date(new Date(group.registration_phase1_start).getTime() + delayMs);
  if (effectiveStart > now) {
    return opts?.nonmemberDelayDays && !opts?.isMember
      ? `社員優先報名中，${formatDate(effectiveStart)} 開放` : '整期報名尚未開始';
  }
  // ...existing end check (unchanged — same deadline for all)...
}
```

**Acceptance criteria:**
- [ ] Non-member sees "社員優先報名中，MM/DD 開放" when within delay period
- [ ] Member enrolls at original start time (unaffected by delay)
- [ ] Admin enrolls at original start time (unaffected by delay)
- [ ] Same end time for all identities (delay only affects start)
- [ ] `nonmember_delay_days = NULL` → no delay (existing behavior)
- [ ] `npx tsc --noEmit` clean

**Verification — 4 levels:**

| Level | Test | ID |
|---|---|---|
| **User story** | 「報名先開社員，非社員延後 N 天才能報」 | US-SW |
| **Code** | guardGroupPhase1Window with delay=3, non-member, start=today → blocked with correct message | C-SW-1 |
| **Code** | guardGroupPhase1Window with delay=3, member, start=today → passes | C-SW-2 |
| **Code** | guardCourseWindow with delay=2, non-member → blocked | C-SW-3 |
| **E2E happy** | Non-member blocked during delay → after delay passes → enrolls | H-SW-1 |
| **E2E adversarial** | Member enrolls during non-member delay period (not affected) | A-SW-1 |
| **E2E adversarial** | Admin enrolls during non-member delay period (not affected) | A-SW-2 |
| **E2E adversarial** | Non-member reaches end time → still blocked (delay doesn't extend end) | A-SW-3 |
| **Security** | Client-side date manipulation cannot bypass server guard | S-SW-1 |

**New e2e spec files:**
- `e2e/features/staggered-window.spec.ts` — H-SW-1, A-SW-1, A-SW-2, A-SW-3
- Update `e2e/global-setup.ts` — add fixture course with `nonmember_delay_days=2`

---

### Task 5T.4: Admin Early-Bird — Guard Bypass

**Tier:** 混合 (server guard) → Opus 4.6, effort high

**Files:**
- Modify: `src/lib/supabase/actions.ts` — `guardGroupPhase1Window` + `guardCourseWindow`: skip "not started" for admin; keep all other checks
- Modify callers to pass `isAdmin` to guards

**Scope:**
```typescript
// In guardGroupPhase1Window, after computing effectiveStart:
if (opts?.isAdmin && effectiveStart > now) {
  // admin skips "not started" — but NOT "已截止"
  // skip this check, continue to end check
} else if (effectiveStart > now) {
  return ...;
}
```

**Acceptance criteria:**
- [ ] Admin can enroll before window start
- [ ] Admin still blocked when window has ended (已截止)
- [ ] Admin still blocked by capacity (額滿)
- [ ] Admin still subject to pricing and eligibility guards
- [ ] Non-admin behavior unchanged
- [ ] `npx tsc --noEmit` clean

**Verification — 4 levels:**

| Level | Test | ID |
|---|---|---|
| **User story** | 「幹部可在報名開始前先行報名作業」 | US-AE |
| **Code** | guardGroupPhase1Window with isAdmin=true, start=future → passes | C-AE-1 |
| **Code** | guardGroupPhase1Window with isAdmin=true, end=past → rejects | C-AE-2 |
| **E2E happy** | Admin enrolls before window open → success | H-AE-1 |
| **E2E adversarial** | Admin enrolls after window closed → rejected | A-AE-1 |
| **E2E adversarial** | Admin enrolls in full course → rejected (capacity not bypassed) | A-AE-2 |
| **E2E adversarial** | Non-admin before window → still rejected | A-AE-3 |
| **E2E mutation** | Remove admin bypass → H-AE-1 goes red | M-AE-1 |

**New e2e spec file:**
- `e2e/features/admin-early-bird.spec.ts` — H-AE-1, A-AE-1, A-AE-2, A-AE-3, M-AE-1

---

### Task 5T.5: Membership Combined — Carrier Order + grantMembership

**Tier:** 金流 (money) → Opus 4.6, effort max

**Files:**
- Modify: `src/lib/supabase/actions.ts`:
  - `submitGroupEnrollment` (~line 3519): detect non-member + "include membership" flag → first order becomes carrier (`include_membership=true`, amount += 1800)
  - `confirmOrder` (~line 3030): unify `grantMembership()` call for ANY order_type with `include_membership=true`
  - New helper: `grantMembership(userId, adminClient)` — update role → member (if not admin), assign to latest member_group, set member_valid_until
  - `cancelOrder` / `rejectOrder`: ensure cascade cancels all carrier-linked enrollments (existing cascade mechanism, verify it works for membership carrier)

**Scope — contingency invariant:**
- Non-member selects "同時加入社員" → all enrollments use member pricing (`effectiveIsMember=true`)
- BUT all are `pending_payment` until carrier order confirmed
- Carrier cancel/reject → all linked enrollments cascade-cancel → no member benefit without payment

**Acceptance criteria:**
- [ ] Non-member wizard with include_membership → carrier order has `include_membership=true` + amount includes 1800
- [ ] confirmOrder on carrier → grantMembership (role=member, group assigned, valid_until set)
- [ ] Carrier cancel → all sibling enrollments cancelled → no membership granted
- [ ] Already-member submitting → include_membership=false (no double charge)
- [ ] grantMembership is idempotent (already member → no-op)
- [ ] All enrollment prices use member rates when include_membership selected
- [ ] `npx tsc --noEmit` clean

**Verification — 4 levels:**

| Level | Test | ID |
|---|---|---|
| **User story** | 「非社員報名同時繳入社費，一次完成」 | US-MC |
| **Code** | grantMembership: sets role='member' + member_group + valid_until | C-MC-1 |
| **Code** | grantMembership: already member → no-op | C-MC-2 |
| **Code** | submitGroupEnrollment: non-member + include → carrier order amount += 1800 | C-MC-3 |
| **E2E happy** | Non-member → wizard + include_membership → pending_payment → confirm carrier → enrolled + now member | H-MC-1 |
| **E2E adversarial** | Carrier cancelled → all enrollments cancelled + membership NOT granted | A-MC-1 |
| **E2E adversarial** | Already-member selects include → include_membership=false, no 1800 added | A-MC-2 |
| **E2E adversarial** | Carrier rejected → same cascade as cancel | A-MC-3 |
| **E2E mutation** | Remove grantMembership call from confirmOrder → H-MC-1 enrolls but user is NOT member | M-MC-1 |
| **Security** | Client cannot set include_membership on arbitrary orders (server resolves from wizard state) | S-MC-1 |

**New e2e spec files:**
- `e2e/features/membership-combined.spec.ts` — H-MC-1, A-MC-1, A-MC-2, A-MC-3, M-MC-1
- Update `e2e/global-setup.ts` — ensure non-member test user available

---

### Task 5T.6: Phase 5T Integration Gate

**Tier:** 測試 → orchestrator runs personally

**Scope:** Full suite clean run after all 5T tasks complete.

**Acceptance criteria:**
- [ ] `npx tsc --noEmit` clean
- [ ] `pnpm test` all unit tests pass
- [ ] Full e2e suite (regression + features + journeys) — single-threaded, clean
- [ ] Lint: no new violations in changed files
- [ ] All new e2e specs (waitlist-engine, staggered-window, admin-early-bird, membership-combined) green
- [ ] Update dashboard + redeploy Artifact
- [ ] Append progress.md ledger

**Expected test count after 5T:** ~97 unit + ~104 e2e ≈ 201 total (adding ~20 new e2e)

---

## Phase 5U — Payment Deadline (Migration 018)

> Spec: `docs/superpowers/specs/2026-07-07-payment-deadline-design.md`

### Task 5U.1: Migration 018 — payment_deadline

**Tier:** 金流/守衛 → Opus 4.6, effort high

**Files:**
- Create: `supabase/migrations/018_payment_deadline.sql`
- Modify: `src/types/database.ts`
- Apply to dev via MCP

**Scope:**
```sql
ALTER TABLE course_groups ADD COLUMN payment_deadline_days INTEGER;
ALTER TABLE enrollments ADD COLUMN payment_deadline_at TIMESTAMPTZ;
-- enroll_atomic already updated in 017 to accept p_payment_deadline_at
```

**Acceptance criteria:**
- [ ] Migration applies cleanly
- [ ] Columns exist in dev DB
- [ ] Types updated
- [ ] `npx tsc --noEmit` clean

---

### Task 5U.2: Deadline Calculation + expireEnrollment

**Tier:** 金流 → Opus 4.6, effort max

**Files:**
- Modify: `src/lib/supabase/actions.ts`:
  - `submitGroupEnrollment`: compute `payment_deadline_at = enrolled_at + deadline_days * 86400000` for pending_payment enrollments
  - `resubmitGroupEnrollment`: recalculate deadline for new enrollments
  - `batchEnrollInSessions`: pass deadline from course → group → deadline_days
  - New: `expireEnrollment(enrollmentId)` — idempotent cancel of overdue enrollment + order cascade + waitlist promote
  - `createCourseGroup` / `updateCourseGroup`: validate `deadline_days > 0 || null` (reject 0)

**Scope:**
- Only `pending_payment` enrollments get deadline; `enrolled`/`waitlist` do NOT
- `order.status = 'remitted'` → skip expiry (already paid)
- Idempotent: already-cancelled enrollment → no-op
- After cancel → trigger `promote_from_waitlist`

**Acceptance criteria:**
- [ ] pending_payment enrollment has `payment_deadline_at` set correctly
- [ ] enrolled enrollment has `payment_deadline_at = null`
- [ ] expireEnrollment cancels overdue enrollment
- [ ] expireEnrollment skips remitted orders
- [ ] expireEnrollment cascades order cancel when all siblings cancelled
- [ ] expireEnrollment triggers waitlist promotion
- [ ] deadline_days=0 rejected by server
- [ ] resubmit recalculates deadline
- [ ] `npx tsc --noEmit` clean

---

### Task 5U.3: Lazy Check + Cron

**Tier:** 混合 → Opus 4.6, effort high

**Files:**
- Modify: `src/app/(protected)/dashboard/page.tsx` — lazy check on page load
- Modify: `src/app/(protected)/dashboard/my_cards/page.tsx` — lazy check on page load
- Create: `supabase/functions/expire-unpaid-enrollments/index.ts` — hourly cron

**Scope:**
- Lazy check: query user's overdue pending_payment enrollments → call expireEnrollment for each → BEFORE rendering data
- Cron: global sweep all overdue enrollments → batch expire → hourly

**Acceptance criteria:**
- [ ] Page load expires overdue enrollments before rendering
- [ ] Cron function exists and handles batch expiry
- [ ] Both paths idempotent (safe to run concurrently)
- [ ] Remitted orders protected from both paths

---

### Task 5U.4: Payment Deadline Verification

**Tier:** 測試 → Opus 4.6, effort high (test authoring)

**Files:**
- Create: `e2e/features/payment-deadline.spec.ts`
- Modify: `e2e/global-setup.ts` — fixture group with `payment_deadline_days=1`

**Verification — 4 levels:**

| Level | Test | ID |
|---|---|---|
| **User story** | 「報名後有繳費期限，逾期自動取消」 | US-PD |
| **Code** | `payment_deadline_at` computed correctly from enrolled_at + days | C-PD-1 |
| **Code** | expireEnrollment: pending_payment + overdue → cancelled | C-PD-2 |
| **Code** | expireEnrollment: remitted → not cancelled | C-PD-3 |
| **Code** | deadline_days=0 → server rejects | C-PD-4 |
| **E2E happy** | Group with deadline=1 → enroll → pending_payment has deadline_at | H-PD-1 |
| **E2E happy** | Overdue enrollment → page load → auto-cancelled + waitlist promoted | H-PD-2 |
| **E2E happy** | No deadline (NULL) → enrollment never expires | H-PD-3 |
| **E2E adversarial** | Remitted order → overdue → NOT cancelled (remitted protection) | A-PD-1 |
| **E2E adversarial** | Resubmit → new deadline recalculated (not inherited) | A-PD-2 |
| **E2E adversarial** | Concurrent: expire + remit race → remitted wins | A-PD-3 |
| **E2E mutation** | Remove remitted guard → A-PD-1 goes red | M-PD-1 |

---

### Task 5U.5: Phase 5U Integration Gate

**Tier:** 測試 → orchestrator

**Acceptance criteria:** same as 5T.6 pattern — tsc + unit + full e2e + lint + dashboard + ledger.

**Expected test count after 5U:** ~97 unit + ~115 e2e ≈ 212 total

---

## Phase 5V — UI Layer (Settings + Waitlist + Staggered + Deadline UI)

> All UI tasks. Frontend visual → `/agy` (Gemini pro); logic → Opus 4.6.

### Task 5V.1: Migration 019 — settings_seed

**Tier:** 測試/文件 (seed data) → Sonnet, effort high

**Files:**
- Create: `supabase/migrations/019_settings_seed.sql`
- Apply to dev via MCP

**Scope:**
```sql
INSERT INTO system_config (key, value, description) VALUES
  ('card_purchase_unit', '3', '堂卡購買單位（張）')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
-- Any other missing keys from KNOWN_KEYS
```

**Acceptance criteria:**
- [ ] Migration applies cleanly
- [ ] All KNOWN_KEYS have corresponding rows in system_config

---

### Task 5V.2: Settings Tabs UI

**Tier:** 純 UI → `/agy` (Gemini pro), effort high

**Files:**
- Modify: `src/app/(protected)/admin/settings/page.tsx` (or equivalent settings component)

**Scope:** 3 tabs — 購卡設定 / 繳費設定 / 系統設定 — using shadcn Tabs. Reorganize existing config keys into tabs. No logic change.

**Acceptance criteria:**
- [ ] Settings page has 3 tabs
- [ ] Tab assignment matches spec §5.2
- [ ] All existing functionality preserved
- [ ] Visual review: consistent with existing shadcn patterns

**Verification:**
- Visual: `/agy` Gemini pro review
- Smoke test: admin can navigate tabs + edit values + save

---

### Task 5V.3: Waitlist UI — Student + Admin

**Tier:** 混合 (UI + server data) → Opus 4.6 (logic) + `/agy` (visual)

**Files:**
- Modify: student course enrollment buttons — show "加入候補" when full + waitlist_enabled
- Modify: student my_courses — show "候補中（第 N 順位）" for waitlist enrollments
- Modify: admin course form — add `waitlist_enabled` toggle
- Modify: admin roster — waitlist section with position + count

**Acceptance criteria:**
- [ ] Full + waitlist_enabled → button says "加入候補" (not "額滿")
- [ ] Waitlist enrollment shows position in my_courses
- [ ] Admin form has waitlist toggle
- [ ] Admin roster shows waitlist section with positions
- [ ] `waitlist_enabled=false` → existing "額滿" behavior unchanged

**Verification:**

| Level | Test | ID |
|---|---|---|
| **UI** | Student sees "加入候補" button for full+waitlist course | UI-WL-1 |
| **UI** | Student sees "候補中（第 1 順位）" in my_courses | UI-WL-2 |
| **UI** | Admin roster shows waitlist block | UI-WL-3 |
| **Journey** | Student enrolls → waitlist → sees position → someone cancels → auto-promoted → sees "已報名" | J-WL-1 |

---

### Task 5V.4: Staggered Window UI

**Tier:** 純 UI → `/agy` (Gemini pro) + Opus 4.6 (text logic)

**Files:**
- Modify: enrollment buttons — show delay message for non-members
- Modify: admin course form — add `nonmember_delay_days` field

**Acceptance criteria:**
- [ ] Non-member sees "社員優先報名中，MM/DD 開放"
- [ ] Member sees normal enrollment button
- [ ] Admin form has delay days input

**Verification:**

| Level | Test | ID |
|---|---|---|
| **UI** | Non-member sees delay message with correct date | UI-SW-1 |
| **UI** | Admin form shows delay field | UI-SW-2 |

---

### Task 5V.5: Payment Deadline UI

**Tier:** 混合 → Opus 4.6 (logic) + `/agy` (visual)

**Files:**
- Modify: student my_cards (payment records) — deadline display on pending orders
- Modify: register wizard completion step — deadline warning
- Modify: admin group form — `payment_deadline_days` input
- Modify: admin review center — deadline column

**Acceptance criteria:**
- [ ] Pending order shows "繳費期限：YYYY/MM/DD HH:mm"
- [ ] Near-expiry (< 24h) shows red warning
- [ ] Wizard completion shows deadline warning
- [ ] Admin group form has deadline days input
- [ ] Admin review center shows deadline column

**Verification:**

| Level | Test | ID |
|---|---|---|
| **UI** | Pending order card shows deadline date | UI-PD-1 |
| **UI** | Near-expiry order shows red warning | UI-PD-2 |
| **UI** | Wizard completion shows deadline message | UI-PD-3 |
| **UI** | Admin group form has deadline field | UI-PD-4 |
| **Journey** | Student registers → sees deadline → pays before deadline → confirmed | J-PD-1 |

---

### Task 5V.6: Membership Combined UI (Wizard Enhancement)

**Tier:** 混合 → Opus 4.6, effort high

**Files:**
- Modify: register wizard — add "同時加入社員" checkbox for non-members
- Show membership fee (1800) line item when checked
- Total amount updates dynamically

**Acceptance criteria:**
- [ ] Non-member sees "同時加入社員" checkbox
- [ ] Checking adds 1800 to total display
- [ ] Already-member: checkbox hidden
- [ ] Submission sends `includeMembership: true` to server action

**Verification:**

| Level | Test | ID |
|---|---|---|
| **UI** | Non-member wizard shows membership checkbox | UI-MC-1 |
| **UI** | Checking adds 1800 to total | UI-MC-2 |
| **UI** | Member: checkbox hidden | UI-MC-3 |

---

### Task 5V.7: Phase 5V Integration Gate

**Tier:** 測試 → orchestrator

**Acceptance criteria:** tsc + unit + full e2e + lint + visual review + dashboard + ledger.

**Expected test count after 5V:** ~97 unit + ~125 e2e ≈ 222 total

---

## Phase 5W — Comprehensive Verification Sweep

> User mandate: "verification 是最重要的." This phase backfills test gaps for ALL existing features + new mechanisms, at every level.

### Task 5W.1: Test Gap Backfill — Existing Features

**Tier:** 測試 → Opus 4.6, effort high

**Scope:** Address every 🔴 and ⚠️ from the Coverage Gap Analysis table.

**New tests to write:**

| Spec File | Tests | Category | Fills Gap |
|---|---|---|---|
| `e2e/features/register-wizard.spec.ts` (extend) | A-RW-1: wizard submit with tampered price → server uses resolvePrice, ignores client | adversarial | register wizard adversarial |
| `e2e/features/register-wizard.spec.ts` (extend) | A-RW-2: double-submit (click twice rapidly) → second idempotent or blocked | adversarial | duplicate submit |
| `e2e/features/register-modify.spec.ts` (extend) | A-RM-1: modify after order confirmed → rejected by resubmitGroupEnrollment guard | adversarial | register modify adversarial |
| `e2e/regression/waitlist-cancel.spec.ts` (extend) | A-WC-1: cancel enrolled enrollment (not waitlist) → rejected | adversarial | waitlist cancel adversarial |
| `e2e/features/enroll-gating.spec.ts` (extend) | M-EG-1: remove guardEnrollFull → test goes red | mutation | enroll gating mutation |
| `e2e/features/enroll-gating.spec.ts` (extend) | M-EG-2: remove guardCourseWindow → test goes red | mutation | enroll gating mutation |

**Acceptance criteria:**
- [ ] All 6 new tests written and passing
- [ ] Each adversarial test verifies server-side rejection (not just UI disabled button)
- [ ] Each mutation test documents which guard it validates

---

### Task 5W.2: Security Regression Tests

**Tier:** 金流/守衛 → Opus 4.6, effort max

**Scope:** Verify S0 hardening holds under all new mechanisms.

**New tests:**

| Spec File | Tests | Verifies |
|---|---|---|
| `e2e/security/rls-hardening.spec.ts` (create) | S-RLS-1: user-scoped client INSERT into orders → denied | orders write policy dropped |
| `e2e/security/rls-hardening.spec.ts` | S-RLS-2: user-scoped client UPDATE enrollments → denied | enrollments write policy dropped |
| `e2e/security/rls-hardening.spec.ts` | S-RLS-3: user-scoped client UPDATE profiles.role → denied | profiles UPDATE policy dropped |
| `e2e/security/rls-hardening.spec.ts` | S-RLS-4: anon call to enroll_atomic RPC → permission denied | REVOKE EXECUTE |
| `e2e/security/rls-hardening.spec.ts` | S-RLS-5: anon call to promote_from_waitlist → permission denied | REVOKE EXECUTE (017) |
| `e2e/security/rls-hardening.spec.ts` | S-RLS-6: authenticated call to promote_from_waitlist → permission denied | REVOKE EXECUTE (017) |

**Implementation approach:** These tests use the e2e-test-actions route to execute direct Supabase client operations and verify they fail. Alternatively, use direct `@supabase/supabase-js` client in tests with the user's JWT.

**Acceptance criteria:**
- [ ] All 6 security tests pass (i.e., all forbidden operations correctly denied)
- [ ] Tests use real user tokens, not service-role
- [ ] Tests are independent of UI (pure API-level)

---

### Task 5W.3: Journey Tests — Dual-Role Comprehensive

**Tier:** 測試 → Opus 4.6, effort high

**Scope:** Extend existing journey tests to cover new mechanisms.

**New journey scenarios:**

| Spec File | Test | Coverage |
|---|---|---|
| `e2e/journeys/student-journey.spec.ts` (extend) | J-S-WL: student → course full → waitlist → cancel → promoted → enrolled | waitlist + cancel lifecycle |
| `e2e/journeys/student-journey.spec.ts` (extend) | J-S-MC: non-member → register + include_membership → pay → confirmed + member | membership combined lifecycle |
| `e2e/journeys/admin-journey.spec.ts` (extend) | J-A-EB: admin → enroll before window → success | admin early-bird lifecycle |
| `e2e/journeys/admin-journey.spec.ts` (extend) | J-A-DL: admin → set deadline → student enrolls → overdue → auto-cancelled | deadline lifecycle |

**Acceptance criteria:**
- [ ] All 4 new journey tests pass
- [ ] Each test covers full lifecycle (not just one step)
- [ ] Tests use dual-role perspective (student acts → admin verifies, or vice versa)

---

### Task 5W.4: Unit Test Extensions

**Tier:** 測試 → Sonnet (mechanical), effort high

**Scope:** Add unit tests for new pure-logic code.

| File | New Tests | Coverage |
|---|---|---|
| `src/lib/supabase/pricing.test.ts` (extend) | isMemberActive edge cases: expired yesterday, expires today, null group | pricing edge |
| `src/lib/supabase/capacity.test.ts` (extend) | waitlist enrollment does NOT count in occupancy | capacity + waitlist |

**Acceptance criteria:**
- [ ] All new unit tests pass
- [ ] `pnpm test` full green

---

### Task 5W.5: Phase 5W Final Gate — Full Verification

**Tier:** 測試 → orchestrator

**This is the comprehensive gate before moving to Phase 6.**

**Acceptance criteria:**
- [ ] `npx tsc --noEmit` — 0 errors
- [ ] `pnpm test` — all unit tests pass
- [ ] Full e2e suite — all specs green (single-threaded clean run)
- [ ] `pnpm lint` — no new violations in any changed file across Phases 5T/5U/5V/5W
- [ ] `pnpm build` — production build succeeds
- [ ] Security regression (rls-hardening.spec.ts) — all 6 pass
- [ ] Journey tests — all pass (including new 4)
- [ ] Dashboard updated with final counts
- [ ] Artifact redeployed
- [ ] Progress ledger updated
- [ ] Reflection written to memory

**Expected final test count after 5W:**
- Unit: ~101 (97 + 4 new)
- E2E: ~141 (125 + 6 backfill + 6 security + 4 journeys)
- **Total: ~242**

---

## Verification Matrix — Complete Cross-Reference

> Every mechanism × every verification level. This is the master checklist.

| Mechanism | User Story | E2E Happy | E2E Adversarial | E2E Mutation | Security | Unit | Journey |
|---|---|---|---|---|---|---|---|
| **Waitlist engine** | US-WL | H-WL-1,2 | A-WL-1,2,3 | M-WL-1 | S-WL-1 | capacity.test | J-S-WL |
| **Membership combined** | US-MC | H-MC-1 | A-MC-1,2,3 | M-MC-1 | S-MC-1 | — | J-S-MC |
| **Staggered windows** | US-SW | H-SW-1 | A-SW-1,2,3 | — | S-SW-1 | — | — |
| **Admin early-bird** | US-AE | H-AE-1 | A-AE-1,2,3 | M-AE-1 | — | — | J-A-EB |
| **Payment deadline** | US-PD | H-PD-1,2,3 | A-PD-1,2,3 | M-PD-1 | — | — | J-A-DL |
| **Settings tabs** | — | smoke | — | — | — | — | — |
| **RLS hardening (S0)** | — | — | — | — | S-RLS-1..6 | — | — |
| **Existing: register** | — | 7H (exist) | A-RW-1,2 (new) | — | — | — | — |
| **Existing: modify** | — | 2H (exist) | A-RM-1 (new) | — | — | — | — |
| **Existing: waitlist cancel** | — | 1H (exist) | A-WC-1 (new) | — | — | — | — |
| **Existing: enroll guards** | — | 2H (exist) | 4A (exist) | M-EG-1,2 (new) | — | — | — |

---

## Execution Order & Dependencies

```
Phase 5T (Engine Core)
  5T.1 Migration 017 ──┐
  5T.2 Waitlist ────────┤ (depends on 017)
  5T.3 Staggered ───────┤ (depends on 017)
  5T.4 Admin EB ────────┤ (depends on 017, composes with 5T.3)
  5T.5 Membership ──────┘ (depends on 017)
  5T.6 Gate ──────────────── (after all 5T.*)

Phase 5U (Payment Deadline)
  5U.1 Migration 018 ──┐
  5U.2 Expire logic ───┤ (depends on 018 + 5T.2 for promote)
  5U.3 Lazy + Cron ────┤ (depends on 5U.2)
  5U.4 Tests ──────────┘ (depends on 5U.2+3)
  5U.5 Gate ──────────────── (after all 5U.*)

Phase 5V (UI Layer)
  5V.1 Migration 019 ──── (independent)
  5V.2 Settings tabs ──── (depends on 5V.1, independent of 5T/5U)
  5V.3 Waitlist UI ─────── (depends on 5T.2)
  5V.4 Staggered UI ────── (depends on 5T.3)
  5V.5 Deadline UI ─────── (depends on 5U.2)
  5V.6 Membership UI ───── (depends on 5T.5)
  5V.7 Gate ──────────────── (after all 5V.*)

Phase 5W (Verification Sweep)
  5W.1 Gap backfill ────── (after 5V gate)
  5W.2 Security tests ──── (after 5V gate)
  5W.3 Journey tests ───── (after 5V gate, uses all new UI)
  5W.4 Unit extensions ──── (after 5T gate)
  5W.5 Final gate ─────────── (after ALL 5W.*)
```

**Parallelism opportunities:**
- 5T.2, 5T.3, 5T.4 can run in parallel after 5T.1 (independent guard changes, different functions)
- 5V.2 can start during 5U (independent of engine)
- 5W.4 can start during 5V (unit tests don't need UI)

---

## Dispatch Summary

| Task | Type | Model | Effort | Tool |
|---|---|---|---|---|
| 5T.1 | 金流/RPC | Opus 4.6 | high | Agent |
| 5T.2 | 金流/守衛 | Opus 4.6 | high | Agent |
| 5T.3 | 混合 | Opus 4.6 | high | Agent |
| 5T.4 | 混合 | Opus 4.6 | high | Agent |
| 5T.5 | 金流 | Opus 4.6 | max | Agent |
| 5T.6 | gate | orchestrator | — | — |
| 5U.1 | 金流/RPC | Opus 4.6 | high | Agent |
| 5U.2 | 金流 | Opus 4.6 | max | Agent |
| 5U.3 | 混合 | Opus 4.6 | high | Agent |
| 5U.4 | 測試 | Opus 4.6 | high | Agent |
| 5U.5 | gate | orchestrator | — | — |
| 5V.1 | 測試/文件 | Sonnet | high | Agent |
| 5V.2 | 純 UI | /agy pro | high | agy |
| 5V.3 | 混合 UI | Opus 4.6 + /agy | high | Agent + agy |
| 5V.4 | 純 UI | /agy pro | high | agy |
| 5V.5 | 混合 UI | Opus 4.6 + /agy | high | Agent + agy |
| 5V.6 | 混合 UI | Opus 4.6 | high | Agent |
| 5V.7 | gate | orchestrator | — | — |
| 5W.1 | 測試 | Opus 4.6 | high | Agent |
| 5W.2 | 金流/守衛 | Opus 4.6 | max | Agent |
| 5W.3 | 測試 | Opus 4.6 | high | Agent |
| 5W.4 | 測試 | Sonnet | high | Agent |
| 5W.5 | gate | orchestrator | — | — |

**Review policy per task (no self-review):**
- Engine tasks (5T.2–5T.5, 5U.2–5U.3): independent Opus 4.6 reviewer, runs full e2e
- UI tasks (5V.2–5V.6): Gemini pro visual review + Opus logic review
- Test tasks (5W.1–5W.4): Opus 4.6 reviewer (verify tests are anti-false-green)
- Gates (5T.6, 5U.5, 5V.7, 5W.5): orchestrator direct, clean full suite

---

## IMPACT MAP (test scope per task — 驗者不自驗)

| Task | Implementer runs | Reviewer runs |
|---|---|---|
| 5T.1 | `tsc --noEmit` + MCP verify | full e2e |
| 5T.2 | `tsc` + waitlist-engine.spec | full e2e |
| 5T.3 | `tsc` + staggered-window.spec + enroll-gating.spec | full e2e |
| 5T.4 | `tsc` + admin-early-bird.spec | full e2e |
| 5T.5 | `tsc` + membership-combined.spec + order-lifecycle.spec | full e2e |
| 5U.1 | `tsc` + MCP verify | full e2e |
| 5U.2 | `tsc` + payment-deadline.spec | full e2e |
| 5U.3 | `tsc` + payment-deadline.spec | full e2e |
| 5U.4 | all new deadline specs | full e2e |
| 5V.1 | `tsc` + MCP verify | full e2e |
| 5V.2 | `tsc` + visual check | full e2e |
| 5V.3 | `tsc` + waitlist-engine.spec | full e2e |
| 5V.4 | `tsc` + staggered-window.spec | full e2e |
| 5V.5 | `tsc` + payment-deadline.spec | full e2e |
| 5V.6 | `tsc` + membership-combined.spec | full e2e |
| 5W.1 | all 6 new backfill specs | full e2e |
| 5W.2 | all 6 security specs | full e2e |
| 5W.3 | all 4 journey specs | full e2e |
| 5W.4 | `pnpm test` | full e2e |
