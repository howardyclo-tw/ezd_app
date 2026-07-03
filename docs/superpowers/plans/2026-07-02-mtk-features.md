# MTK Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the MTK requirements (regular/specialty/style course enrollment with unified pricing, payment review, MV voting, leader-willingness, absence-penalty blacklist, monthly card-purchase window) as self-service flows, replacing the SurveyCake + manual-cash process — without breaking existing production features.

**Architecture:** Unify the three cross-cutting concerns behind single modules instead of per-course-type branches: (1) a `pricing_mode` (card/ntd/free) resolver, (2) an atomic enrollment RPC that all paths call, (3) a `card_orders`→`orders` generalized payment table with one review center. Course type only sets form defaults. An allocation module (default `fcfs`) isolates the "先搶先贏" rule so future priority policies drop in without touching flows.

**Tech Stack:** Next.js 16 (App Router) + React 19 + Supabase (Postgres/Auth/RLS) + Tailwind 4 + Shadcn UI. Server Actions in `src/lib/supabase/actions.ts` wrapped by `safe()`. New: Postgres functions (RPC) for atomic writes; `@playwright/test` for E2E.

## Global Constraints

- Package manager **pnpm 10.27.0**. Dev server: `pnpm dev` (Turbopack). Type check: `npx tsc --noEmit`. Lint: `pnpm lint`. Build: `pnpm build`.
- Dev server binds `http://[::1]:3000` (IPv4 127.0.0.1:3000 is squatted). Use the IPv6 URL for E2E baseURL.
- All date/time comparisons use **Asia/Taipei**: `new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date())` → `"YYYY-MM-DD"`. **Never** `new Date()` on a date string for comparison.
- All DB reads/writes in server actions use `createAdminClient()` (service role); `createClient()` only to verify identity via `getCurrentUser()`. Business validation lives in code, not RLS.
- All server actions wrapped with `safe()`. User-facing guards that must show a message in prod use `return { success: false, message }` (not `throw`).
- **Two Supabase projects**: dev `mvxdxldwznbqycfgwqmc`, prod `zhaloqbeguzsknodrxsm`. **All migrations run against DEV first via `mcp__supabase__apply_migration`, verified, and applied to prod only after feature acceptance.**
- Work on the **`dev` branch** throughout. Do not push without explicit request. No `Co-Authored-By` lines in commits.
- **CI gate per phase (must all pass before marking a feature done):** `npx tsc --noEmit` clean, `pnpm build` succeeds, full E2E suite (happy + adversarial + regression) green, and **lint clean on changed files**. NOTE: whole-repo `pnpm lint` (ESLint flat config, Next 16) reports **430 pre-existing problems (318 errors / 112 warnings), mostly `no-explicit-any` in `actions.ts`** — NOT our debt and out of scope. So the lint gate is scoped to files this phase creates/modifies: **new files must be ESLint-clean; modified existing files must introduce no NEW violations** (baseline-compare or judge in review). Do not attempt whole-repo lint-clean.

## Ground-Truth Notes (verified against live dev DB 2026-07-02)

- **`src/types/database.ts` is STALE.** Live DB has: `member_groups(id, name, valid_until date, created_at)`; `profiles.member_group_id uuid` + `profiles.makeup_quota int` (and legacy `member_valid_until date` still present); `card_orders.remittance_bank_code`, `card_orders.include_membership bool`; `course_sessions.is_cancelled bool` + `cancel_note`. The types file must be corrected in Task 1.3 (manually — do NOT auto-generate over it; it contains hand-written helper functions and joined view types).
- **Repo migrations 001–009 do NOT create `member_groups`** — the live dev DB is ahead of the repo files. Source of truth = live DB. New migrations are applied via MCP and also saved as repo files `010+` for the changelog.
- `enrollments.status` is a plain `text` with default `'enrolled'` and **no CHECK/enum** → adding `pending_payment`/`pending_vote` needs no column-constraint change (only code + a documented value set).
- `enrollments.type` HAS `CHECK (type IN ('full','single'))`.
- `card_orders` already has `include_membership` (the $1800 add-on) and both remittance columns.
- No `playwright` dep and no `e2e/` dir yet — greenfield test harness (Phase 0).

## Shared Interface Contract (all phases depend on these exact names)

```typescript
// src/lib/date.ts
export function getTaipeiToday(): string;                 // "YYYY-MM-DD"
export function taipeiDateOf(d: Date): string;            // "YYYY-MM-DD" for a given instant

// src/types/database.ts (extended)
export type OrderType = 'card_purchase' | 'course_fee' | 'membership_fee';
export type OrderStatus = 'pending' | 'remitted' | 'confirmed' | 'rejected' | 'cancelled';
export type EnrollmentStatus =
  | 'enrolled' | 'waitlist' | 'cancelled' | 'pending_payment' | 'pending_vote';
export type PricingMode = 'card' | 'ntd' | 'free';
export type PollVoteType = 'single' | 'multi';
export type PollStatus = 'open' | 'published';
export interface MemberGroup { id: string; name: string; valid_until: string; created_at: string; }

// src/lib/supabase/pricing.ts
export type EnrollModeType = 'full' | 'single';
export type PriceResult =
  | { kind: 'card'; cards: number }
  | { kind: 'ntd'; amount: number }
  | { kind: 'free' };
export interface PricingInputs {
  pricing_mode: PricingMode;
  cards_per_session: number;
  price_member_single: number | null;
  price_guest_single: number | null;
  price_member_full: number | null;
  price_guest_full: number | null;
  sessionCount: number;
}
export function isMemberActive(
  args: { role: UserRole; member_valid_until: string | null; groupValidUntil: string | null },
  taipeiToday: string
): boolean;
export function resolvePrice(inputs: PricingInputs, isMember: boolean, mode: EnrollModeType): PriceResult;

// src/lib/allocation.ts
export type AllocationPolicy = 'fcfs';
export interface AllocationCandidate { enrollmentId: string; enrolledAt: string; }
export function allocate(
  candidates: AllocationCandidate[], capacity: number, policy: AllocationPolicy
): { granted: string[]; denied: string[] };

// src/lib/supabase/capacity.ts
export interface OccupancyRow { status: EnrollmentStatus; type: EnrollModeType; }
export interface AttendanceOccRow { status: string; }  // makeup / transfer_in / transfer_out / leave
// occupancy per session = (#full active) + (#single active for this session)
//   + makeup + transfer_in - leave - transfer_out ; "active" = enrolled|pending_payment|pending_vote
export function computeSessionOccupancy(
  enrollments: OccupancyRow[], attendance: AttendanceOccRow[]
): number;

// Postgres RPC (Phase 3) — called via adminClient.rpc(...)
// enroll_atomic(p_user uuid, p_course uuid, p_type text, p_session uuid,
//               p_status text, p_cards_to_deduct int, p_order_id uuid)
//   returns jsonb { ok: bool, enrollment_id: uuid, reason: text }
//   locks the course row, re-checks per-session capacity, inserts enrollment,
//   deducts cards FIFO (if p_cards_to_deduct>0), all in one transaction.
```

**"Active" enrollment (occupies a seat, blocks re-enroll):** `status IN ('enrolled','pending_payment','pending_vote')`. **Cancelled/waitlist do not occupy.**

---

## Phase 0 — E2E Harness + Regression Baseline

**Rationale (CI/CD spirit):** lock a green baseline of existing prod behavior BEFORE refactoring shared foundations. Every later phase re-runs these.

### Task 0.1: Install and configure Playwright

**Files:**
- Modify: `package.json` (add devDep + scripts)
- Create: `playwright.config.ts`
- Create: `e2e/fixtures/auth.ts`
- Create: `.gitignore` entry for `playwright-report/`, `test-results/`

**Interfaces:**
- Produces: `test` scripts `pnpm e2e`, `pnpm e2e:ui`; a `loginAs(page, role)` fixture reading seeded creds.

- [ ] **Step 1: Install Playwright**

Run: `pnpm add -D @playwright/test && pnpm exec playwright install chromium`
Expected: dependency added, chromium downloaded.

- [ ] **Step 2: Write `playwright.config.ts`**

```typescript
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,           // shared dev DB — serialize to keep assertions deterministic
  workers: 1,
  retries: 0,
  timeout: 30_000,
  use: {
    baseURL: 'http://[::1]:3000',
    trace: 'on-first-retry',
    locale: 'zh-TW',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
```

- [ ] **Step 3: Add scripts to `package.json`**

```json
"e2e": "playwright test",
"e2e:ui": "playwright test --ui"
```

- [ ] **Step 4: Write the auth fixture** `e2e/fixtures/auth.ts`

```typescript
import { Page, expect } from '@playwright/test';
export const ACCOUNTS = {
  admin:  { email: 'e2e-admin@mediatek.com',  password: 'mediatek' },
  member: { email: 'e2e-member@mediatek.com', password: 'mediatek' },
  guest:  { email: 'e2e-guest@mediatek.com',  password: 'mediatek' },
} as const;
export async function loginAs(page: Page, role: keyof typeof ACCOUNTS) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(ACCOUNTS[role].email);
  await page.getByLabel(/密碼|password/i).fill(ACCOUNTS[role].password);
  await page.getByRole('button', { name: /登入|login/i }).click();
  await expect(page).toHaveURL(/dashboard/);
}
```

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml playwright.config.ts e2e/fixtures/auth.ts .gitignore
git commit -m "test: add Playwright e2e harness (config + auth fixture)"
```

### Task 0.2: Seed script for deterministic E2E fixtures (dev DB)

**Files:**
- Create: `e2e/seed.sql` (idempotent seed)
- Create: `e2e/README.md` (how to run seed via Supabase MCP / psql)

**Interfaces:**
- Produces: seeded accounts (admin/member/guest), one `member_groups` row valid to year-end, one course group with a card-mode `normal` course, an `ntd` `workshop`, a `free` `style` course, sessions, and an `open` MV poll on a normal course.

- [ ] **Step 1: Write `e2e/seed.sql`** — idempotent upserts keyed by fixed UUIDs (so reruns are stable). **Pre-migration schema ONLY** (this seed feeds the Phase 0.3 regression baseline that runs before migrations 010/011). Include: 3 auth users + profiles (roles), a member_group `valid_until = <year>-12-31`, a course_group with `registration_phase1_start/end` around "now", one card-mode `normal` course with 2-3 future sessions, and a confirmed card pool for the member (`card_orders` status='confirmed', `profiles.card_balance` set). Use `ON CONFLICT DO UPDATE`. **Do NOT reference `pricing_mode`/`enroll_*`/`course_polls` — those don't exist until Phase 1.** Feature fixtures (`ntd`/`free` courses, MV polls) are appended to `seed.sql` in Tasks 5.2 / 6.1 once their columns exist.
- [ ] **Step 2: Document run command** in `e2e/README.md`: apply via `mcp__supabase__execute_sql` against dev project `mvxdxldwznbqycfgwqmc`, or `supabase db execute`. Note: auth users must be created via Supabase Admin API (same as app registration) — script includes a Node helper `e2e/seed-users.mjs` calling the admin API with the service role key from `.env.local`.
- [ ] **Step 3: Create `e2e/seed-users.mjs`** using `@supabase/supabase-js` admin `createUser` (idempotent: ignore "already registered").
- [ ] **Step 4: Run the seed** against dev; verify rows via `mcp__supabase__execute_sql` `SELECT`.
- [ ] **Step 5: Commit**

```bash
git add e2e/seed.sql e2e/seed-users.mjs e2e/README.md
git commit -m "test: e2e seed script (accounts + course archetypes + poll)"
```

### Task 0.3: Regression baseline specs (existing prod behavior)

**Files:**
- Create: `e2e/regression/card-purchase.spec.ts`
- Create: `e2e/regression/enroll-single.spec.ts`
- Create: `e2e/regression/attendance-leave.spec.ts`
- Create: `e2e/regression/admin-members.spec.ts`

**Interfaces:**
- Consumes: `loginAs`, seeded fixtures.

- [ ] **Step 1: Write `card-purchase.spec.ts`** — member logs in → my_cards → buy N cards (in current window; if window closed, open it via admin settings first) → submit remittance → admin approves in review center → card balance increases by N; assert FIFO expiry shown. This is the **canonical regression for the `orders` refactor** (Phase 1) — its behavior must stay identical.
- [ ] **Step 2: Write `enroll-single.spec.ts`** — member enrolls in a card-mode course single session → balance decreases by `cards_per_session` → roster shows the member.
- [ ] **Step 3: Write `attendance-leave.spec.ts`** — admin marks attendance present/absent; member takes leave on a future session (auto-approved); leave cannot be taken on a past session.
- [ ] **Step 4: Write `admin-members.spec.ts`** — admin edits a member's role and group; adjusts makeup quota; views card pool.
- [ ] **Step 5: Run baseline green**

Run: `pnpm dev` (background) then `pnpm e2e e2e/regression`
Expected: all PASS. Record as baseline in the tracker.

- [ ] **Step 6: Commit**

```bash
git add e2e/regression
git commit -m "test: regression baseline for card purchase, enroll, attendance, members"
```

---

## Phase 1 — Foundation: schema, types, pricing, cleanup

### Task 1.1: Migration 010 — generalize `card_orders` → `orders`

**Files:**
- Create: `supabase/migrations/010_generalize_orders.sql` (repo changelog copy)
- Apply via `mcp__supabase__apply_migration` (name `generalize_orders`) to dev.

**Interfaces:**
- Produces: table `orders` (was `card_orders`) with `order_type text NOT NULL DEFAULT 'card_purchase' CHECK (order_type IN ('card_purchase','course_fee','membership_fee'))`, `amount int` (generalized; keep `total_amount` for card orders, `amount` used by course_fee), `course_group_id uuid NULL`, nullable card-only columns unchanged. Status CHECK updated to include `rejected`.

- [ ] **Step 1: Write the migration SQL**

```sql
-- 010_generalize_orders.sql
ALTER TABLE card_orders RENAME TO orders;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_type text NOT NULL DEFAULT 'card_purchase';
ALTER TABLE orders ADD CONSTRAINT orders_type_chk
  CHECK (order_type IN ('card_purchase','course_fee','membership_fee'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount integer;          -- course_fee total NTD
ALTER TABLE orders ADD COLUMN IF NOT EXISTS course_group_id uuid REFERENCES course_groups(id);
UPDATE orders SET amount = total_amount WHERE amount IS NULL;
-- status: allow 'rejected' (was implicitly written by rejectCardOrder without a CHECK)
ALTER TABLE orders DROP CONSTRAINT IF EXISTS card_orders_status_chk;
ALTER TABLE orders ADD CONSTRAINT orders_status_chk
  CHECK (status IN ('pending','remitted','confirmed','rejected','cancelled'));
-- card_transactions.order_id FK auto-follows the rename; verify name unchanged.
-- RLS: recreate policies referencing the new table name (see step 2).
```

- [ ] **Step 2: Recreate RLS policies** for `orders` mirroring the old `card_orders` policies (self can read own; admin manage all). Query current policies first: `mcp__supabase__execute_sql` `SELECT polname, qual FROM pg_policies WHERE tablename='orders'`.
- [ ] **Step 3: Apply to dev** via `mcp__supabase__apply_migration`; verify with `list_tables verbose` that `orders` exists with new columns and `card_transactions_order_id_fkey` still targets `orders`.
- [ ] **Step 4: Grep + rewrite all `card_orders` references** in code to `orders` + `order_type='card_purchase'` where the query means "card purchases only":
  - `src/lib/supabase/actions.ts` (createCardOrder, submitRemittanceInfo, confirmCardOrder, rejectCardOrder, createCardOrderWithRemittance, adminAddCards paths)
  - `src/lib/supabase/queries.ts`, `src/lib/supabase/import-actions.ts`
  - `src/app/(protected)/dashboard/my_cards/page.tsx`, `src/components/dashboard/my-cards-client.tsx`
  - `src/components/leader/approvals-tabs-client.tsx`, `src/lib/ai/schema-context.ts`
- [ ] **Step 5: Type check + regression**

Run: `npx tsc --noEmit && pnpm e2e e2e/regression/card-purchase.spec.ts`
Expected: clean + PASS (behavior unchanged — this proves the rename is safe).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/010_generalize_orders.sql src
git commit -m "refactor: generalize card_orders -> orders (order_type, amount); regression green"
```

### Task 1.2: Migration 011 — courses pricing/enroll columns, allocation policy, new tables

**Files:**
- Create: `supabase/migrations/011_pricing_voting_penalty.sql`
- Apply to dev via MCP.

- [ ] **Step 1: Write SQL**

```sql
-- 011_pricing_voting_penalty.sql
-- courses: unified pricing + enroll switches
ALTER TABLE courses ADD COLUMN IF NOT EXISTS pricing_mode text NOT NULL DEFAULT 'card';
ALTER TABLE courses ADD CONSTRAINT courses_pricing_mode_chk
  CHECK (pricing_mode IN ('card','ntd','free'));
ALTER TABLE courses ADD COLUMN IF NOT EXISTS price_member_single integer;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS price_guest_single  integer;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS price_member_full   integer;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS price_guest_full    integer;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS enroll_full   boolean NOT NULL DEFAULT true;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS enroll_single boolean NOT NULL DEFAULT true;
-- allocation policy on the group (fcfs now; extensible later)
ALTER TABLE course_groups ADD COLUMN IF NOT EXISTS allocation_policy text NOT NULL DEFAULT 'fcfs';
-- enrollments: leader willingness + cancel reason + submission grouping
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS wants_leader boolean NOT NULL DEFAULT false;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES orders(id);
-- MV voting
CREATE TABLE IF NOT EXISTS course_polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title text NOT NULL,
  vote_type text NOT NULL CHECK (vote_type IN ('single','multi')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','published')),
  published_at timestamptz, published_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS poll_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES course_polls(id) ON DELETE CASCADE,
  label text NOT NULL, youtube_url text, is_winner boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS poll_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES course_polls(id) ON DELETE CASCADE,
  option_id uuid NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id),
  enrollment_id uuid REFERENCES enrollments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (poll_id, user_id, option_id)
);
-- absence-penalty manual override
CREATE TABLE IF NOT EXISTS penalty_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  period_end date NOT NULL,
  reason text, created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- RLS: enable + policies (admin manage all; self read own votes/enrollments)
ALTER TABLE course_polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE penalty_overrides ENABLE ROW LEVEL SECURITY;
-- (add policies mirroring existing tables; adminClient bypasses RLS for writes)
```

- [ ] **Step 2: Add RLS policies** mirroring existing conventions (read for authenticated; write via adminClient). Reference an existing table's policy via `pg_policies`.
- [ ] **Step 3: Apply to dev**; `list_tables verbose` to confirm all columns/tables/constraints.
- [ ] **Step 4: Backfill course defaults** by type (data update, not schema): `UPDATE courses SET pricing_mode='ntd', enroll_single=true, enroll_full=true WHERE type='workshop'; UPDATE courses SET pricing_mode='ntd', enroll_full=false, enroll_single=true WHERE type='style';` (normal stays `card`). NOTE: ntd courses now need prices — leave NULL; UI (Phase 2) forbids enrollment on a NULL-priced ntd option and admins fill prices.
- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/011_pricing_voting_penalty.sql
git commit -m "feat(db): pricing_mode/enroll switches, allocation_policy, voting + penalty tables"
```

### Task 1.3: Refresh `src/types/database.ts` to match live DB

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Add/fix types** — extend enums per Shared Interface Contract (`OrderType`, `OrderStatus`, extended `EnrollmentStatus`, `PricingMode`, `PollVoteType`, `PollStatus`); add `MemberGroup`; add `Profile.member_group_id`, `Profile.makeup_quota`; add `Course` pricing/enroll fields; add `Order` (rename `CardOrder`→`Order`, add `order_type`, `amount`, `course_group_id`, `remittance_bank_code`, `include_membership`); add `CourseSession.is_cancelled/cancel_note`; add `CoursePoll`, `PollOption`, `PollVote`, `PenaltyOverride`, `Enrollment.wants_leader/cancel_reason/order_id`. Keep `CardOrder` as a deprecated alias `export type CardOrder = Order;` to avoid a mass rename churn in one task.
- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: clean (fix any newly surfaced mismatches in consuming files).

- [ ] **Step 3: Commit**

```bash
git add src/types/database.ts src
git commit -m "types: sync database.ts with live schema (member_groups, orders, courses, voting)"
```

### Task 1.4: Date helper + unified `isMemberActive` + pricing resolver (pure, unit-tested)

**Files:**
- Create: `src/lib/date.ts`
- Create: `src/lib/supabase/pricing.ts`
- Create: `src/lib/supabase/pricing.test.ts` (vitest) — OR e2e-agnostic node test if vitest absent.

**Interfaces:** Produces `getTaipeiToday`, `taipeiDateOf`, `isMemberActive`, `resolvePrice` per contract.

- [ ] **Step 1: Check for a unit-test runner.** Run `node -e "console.log(!!require('./package.json').devDependencies?.vitest)"`. If false, `pnpm add -D vitest` and add script `"test": "vitest run"`.
- [ ] **Step 2: Write failing tests** `src/lib/supabase/pricing.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolvePrice, isMemberActive } from './pricing';

describe('isMemberActive', () => {
  it('guest is never member', () => {
    expect(isMemberActive({ role: 'guest', member_valid_until: null, groupValidUntil: '2026-12-31' }, '2026-07-02')).toBe(false);
  });
  it('member with future group expiry is active', () => {
    expect(isMemberActive({ role: 'member', member_valid_until: null, groupValidUntil: '2026-12-31' }, '2026-07-02')).toBe(true);
  });
  it('member with expired group is inactive', () => {
    expect(isMemberActive({ role: 'member', member_valid_until: null, groupValidUntil: '2026-06-01' }, '2026-07-02')).toBe(false);
  });
});
describe('resolvePrice', () => {
  const base = { cards_per_session: 2, price_member_single: 300, price_guest_single: 400, price_member_full: 1000, price_guest_full: 1400, sessionCount: 6 };
  it('card mode single = cards_per_session', () => {
    expect(resolvePrice({ ...base, pricing_mode: 'card' }, true, 'single')).toEqual({ kind: 'card', cards: 2 });
  });
  it('card mode full = cards_per_session * sessionCount', () => {
    expect(resolvePrice({ ...base, pricing_mode: 'card' }, true, 'full')).toEqual({ kind: 'card', cards: 12 });
  });
  it('ntd member single', () => {
    expect(resolvePrice({ ...base, pricing_mode: 'ntd' }, true, 'single')).toEqual({ kind: 'ntd', amount: 300 });
  });
  it('ntd guest full', () => {
    expect(resolvePrice({ ...base, pricing_mode: 'ntd' }, false, 'full')).toEqual({ kind: 'ntd', amount: 1400 });
  });
  it('ntd with 0 price for the identity is free', () => {
    expect(resolvePrice({ ...base, pricing_mode: 'ntd', price_member_single: 0 }, true, 'single')).toEqual({ kind: 'free' });
  });
  it('free mode always free', () => {
    expect(resolvePrice({ ...base, pricing_mode: 'free' }, false, 'single')).toEqual({ kind: 'free' });
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL** (`pnpm test` → module not found).
- [ ] **Step 4: Implement `src/lib/date.ts`**

```typescript
export function taipeiDateOf(d: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(d);
}
export function getTaipeiToday(): string { return taipeiDateOf(new Date()); }
```

- [ ] **Step 5: Implement `src/lib/supabase/pricing.ts`**

```typescript
import type { UserRole, PricingMode } from '@/types/database';
export type EnrollModeType = 'full' | 'single';
export type PriceResult =
  | { kind: 'card'; cards: number }
  | { kind: 'ntd'; amount: number }
  | { kind: 'free' };
export interface PricingInputs {
  pricing_mode: PricingMode; cards_per_session: number;
  price_member_single: number | null; price_guest_single: number | null;
  price_member_full: number | null; price_guest_full: number | null;
  sessionCount: number;
}
export function isMemberActive(
  args: { role: UserRole; member_valid_until: string | null; groupValidUntil: string | null },
  taipeiToday: string
): boolean {
  if (args.role === 'guest') return false;
  const until = args.groupValidUntil ?? args.member_valid_until;
  if (!until) return false;           // member role but no expiry → treat inactive (must have a group)
  return until >= taipeiToday;        // string compare works for YYYY-MM-DD
}
export function resolvePrice(i: PricingInputs, isMember: boolean, mode: EnrollModeType): PriceResult {
  if (i.pricing_mode === 'free') return { kind: 'free' };
  if (i.pricing_mode === 'card') {
    const cards = mode === 'full' ? i.cards_per_session * i.sessionCount : i.cards_per_session;
    return cards <= 0 ? { kind: 'free' } : { kind: 'card', cards };
  }
  const price = mode === 'single'
    ? (isMember ? i.price_member_single : i.price_guest_single)
    : (isMember ? i.price_member_full : i.price_guest_full);
  if (price == null) throw new Error('NTD price not set for this identity/mode');
  return price <= 0 ? { kind: 'free' } : { kind: 'ntd', amount: price };
}
```

- [ ] **Step 6: Run tests — expect PASS.** (`pnpm test`)
- [ ] **Step 7: Commit**

```bash
git add src/lib/date.ts src/lib/supabase/pricing.ts src/lib/supabase/pricing.test.ts package.json
git commit -m "feat: taipei date helper + unified isMemberActive + pricing resolver (unit tested)"
```

### Task 1.5: Collapse the 3 isMember implementations + remove dead code

**Files:**
- Modify: `src/lib/supabase/actions.ts` (createCardOrder identity/price block ~2399-2412), `src/lib/supabase/queries.ts` (delete `getCardPriceForUser`), `src/lib/supabase/import-actions.ts` (~170-192)
- Delete: `src/components/courses/enrollment-button.tsx` (dead code, no mount point)

- [ ] **Step 1: Replace each ad-hoc member check** with `isMemberActive({ role, member_valid_until, groupValidUntil }, getTaipeiToday())`, fetching `member_groups(valid_until)` for the acting user where needed. Card price stays `card_price_member`/`card_price_non_member` from system_config via the same `isMember` boolean.
- [ ] **Step 2: Delete `getCardPriceForUser`** (no callers — confirmed) and `enrollment-button.tsx` (grep to confirm zero imports first: `grep -rn "enrollment-button" src`).
- [ ] **Step 3: Type check + regression**

Run: `npx tsc --noEmit && pnpm e2e e2e/regression/card-purchase.spec.ts`
Expected: clean + PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: single isMemberActive across order/import; remove dead enrollment-button + getCardPriceForUser"
```

---

## Phase 2 — Unified order lifecycle + review center + refund-count fix

### Task 2.1: `course_fee` order creation + confirm/cancel side-effects

**Files:**
- Modify: `src/lib/supabase/actions.ts` (add `createCourseFeeOrder`, extend `confirmCardOrder`→`confirmOrder`, `rejectCardOrder`→`rejectOrder`/`cancelOrder` to branch on `order_type`)

**Interfaces:**
- Produces:
  - `createCourseFeeOrder(args: { userId, courseGroupId, amount, enrollmentIds: string[] }): Promise<{ orderId }>` — inserts `orders(order_type='course_fee', amount, status='pending')`, sets `enrollments.order_id` for the given rows.
  - `confirmOrder(orderId)` — if `course_fee`: set linked enrollments `status='enrolled'`; if `card_purchase`: existing issue-cards behavior; if the card_purchase is linked to enrollments (同步購卡), after issuing cards run deduction and flip those enrollments to `enrolled` (see 2.3).
  - `cancelOrder(orderId, reason)` — set order `cancelled`, linked enrollments `cancelled` + `cancel_reason`, release seats, refund any deducted cards by the correct count.

- [ ] **Step 1: Write happy-path e2e** `e2e/features/course-fee-order.spec.ts` — guest enrolls in an `ntd` workshop single → enrollment `pending_payment`, order `pending`; guest submits remittance → `remitted`; admin confirms → enrollment `enrolled`, seat counted. (Will fail until implemented.)
- [ ] **Step 2: Implement** the three functions above; reuse existing `submitRemittanceInfo` (generalize to any `order_type`).
- [ ] **Step 3: Run e2e — PASS.**
- [ ] **Step 4: Commit** `feat: course_fee order lifecycle (create/confirm/cancel) with enrollment side-effects`.

### Task 2.2: Fix hard-coded 1-card refund/re-deduct in `reviewSingleEnrollment`

**Files:** Modify `src/lib/supabase/actions.ts` (reviewSingleEnrollment ~2691-2750)

- [ ] **Step 1: Write e2e** — a `card`-mode course with `cards_per_session=3`; admin rejects a single enrollment → exactly 3 cards refunded (not 1).
- [ ] **Step 2: Replace the literal `1`** with the course's `cards_per_session` (and, for full enrollments, `* sessionCount`).
- [ ] **Step 3: e2e PASS + regression green.**
- [ ] **Step 4: Commit** `fix: refund/re-deduct uses cards_per_session, not hard-coded 1`.

### Task 2.3: Review center — "報名繳費" tab + guard confirm authority

**Files:**
- Modify: `src/components/leader/approvals-tabs-client.tsx` (add tab), `src/app/(protected)/leader/approvals/page.tsx` (load course_fee + linked-card orders), server actions from 2.1.

- [ ] **Step 1: Write e2e (happy)** — admin sees a course_fee order in the new tab with member/course/amount/remittance; confirm → enrollment enrolled; cancel → seat released.
- [ ] **Step 2: Write e2e (adversarial)** — non-admin (member) calling `confirmOrder` directly is rejected server-side (role guard in the action, not just UI). Simulate via `page.request`/`fetch` to the server action or a thin test route; assert failure + order unchanged.
- [ ] **Step 3: Implement** the tab (mirror existing tab styling) + ensure every order action re-verifies `role==='admin'` server-side.
- [ ] **Step 4: e2e PASS.**
- [ ] **Step 5: Commit** `feat: review center 報名繳費 tab + server-side confirm authority guard`.

---

## Phase 3 — Capacity module + allocation + atomic enroll RPC

### Task 3.1: Extract `computeSessionOccupancy` (single source of truth)

**Files:** Create `src/lib/supabase/capacity.ts` + `capacity.test.ts`; modify the 3 inline occupancy sites (`actions.ts:384-411`, `courses/groups/[groupId]/page.tsx:94-150`, course detail page) to call it.

- [ ] **Step 1: Write failing unit tests** covering the formula incl. `pending_payment`/`pending_vote` counting as active, `cancelled`/`waitlist` not, and makeup/transfer/leave deltas.
- [ ] **Step 2: Implement** `computeSessionOccupancy` per contract; refactor call sites.
- [ ] **Step 3: tests PASS + regression green** (single-enroll occupancy unchanged).
- [ ] **Step 4: Commit** `refactor: single computeSessionOccupancy; count pending seats`.

### Task 3.2: Allocation module (`fcfs`)

**Files:** Create `src/lib/allocation.ts` + `allocation.test.ts`.

- [ ] **Step 1: Write failing tests** — `fcfs` sorts by `enrolledAt` asc, grants first `capacity`, denies the rest; ties broken by `enrollmentId` for determinism.
- [ ] **Step 2: Implement** `allocate`.
- [ ] **Step 3: tests PASS.**
- [ ] **Step 4: Commit** `feat: allocation module (fcfs, extensible policy interface)`.

### Task 3.3: Atomic enrollment RPC

**Files:** Create `supabase/migrations/012_enroll_atomic.sql`; apply to dev via MCP. Modify `batchEnrollInSessions`, `batchEnrollInCourses`, and the (revived) full path to call the RPC.

**Interfaces:** Produces Postgres function `enroll_atomic(...)` per contract; returns `jsonb`.

- [ ] **Step 1: Write the function** — `SELECT ... FROM courses WHERE id=p_course FOR UPDATE` (row lock), recompute per-session occupancy inside the txn, if `< capacity` insert the enrollment (status = p_status), if `p_cards_to_deduct>0` deduct FIFO from `orders` (card_purchase, confirmed, not expired vs session date) updating `orders.used` + insert `card_transactions` + update `profiles.card_balance`; return `{ok:true, enrollment_id}`; on capacity fail return `{ok:false, reason:'full'}` and rollback.
- [ ] **Step 2: Apply to dev; write concurrency e2e** — fire 2 parallel enrolls at a capacity-1 session (via `Promise.all` of two `page.request` calls or two contexts); assert exactly one `enrolled`, one `full`. (Adversarial: no overselling.)
- [ ] **Step 3: Rewire `batchEnrollInSessions`/`batchEnrollInCourses`** to call RPC (fixes the missing-capacity-check hole in batchEnrollInCourses).
- [ ] **Step 4: e2e PASS + full regression green.**
- [ ] **Step 5: Commit** `feat: atomic enroll RPC (row-lock capacity + FIFO deduct); fixes oversell + batch capacity gap`.

### Task 3.4: Fix waitlist "取消候補" wiring bug

**Files:** Modify `src/components/courses/course-detail-client.tsx:646` (bind to `handleCancelEnrollment`, not `handleCancel`).

- [ ] **Step 1: e2e** — waitlisted user clicks 取消候補 → waitlist entry removed. (Currently no-op.)
- [ ] **Step 2: Fix the binding.**
- [ ] **Step 3: e2e PASS.**
- [ ] **Step 4: Commit** `fix: waitlist cancel button bound to correct handler`.

---

## Phase 4 — Card purchase rules (window / n-multiple / expiry cascade)

### Task 4.1: Monthly-first-week purchase window

**Files:** Create `src/lib/card-window.ts` + test; modify `createCardOrder` guard + `my_cards/page.tsx` `isPurchaseOpen`; add `card_purchase_mode` to `system-config-client.tsx` KNOWN_KEYS.

- [ ] **Step 1: Failing tests** for `getCardPurchaseWindow(taipeiToday) → {start,end}` = first Monday of month + following Friday; `isWindowOpen(today)`.
- [ ] **Step 2: Implement**; when `card_purchase_mode='monthly_first_week'` use it, else manual `card_purchase_open/start/end`.
- [ ] **Step 3: e2e (adversarial)** — POST a purchase outside the window directly to the action → rejected server-side.
- [ ] **Step 4: tests + e2e PASS.**
- [ ] **Step 5: Commit** `feat: monthly first-week card purchase window (config-toggled) + server guard`.

### Task 4.2: n-multiple purchase unit

**Files:** Add `card_purchase_unit` to system_config seed + KNOWN_KEYS; guard in `createCardOrder`; UI reads unit for step/min in `my-cards-client.tsx` (remove hard-coded 5/20; use the already-passed `minPurchase` prop).

- [ ] **Step 1: e2e (adversarial)** — quantity not a multiple of unit, and negative/zero, rejected server-side.
- [ ] **Step 2: Implement** `quantity % unit === 0 && quantity > 0` guard + UI stepper from config.
- [ ] **Step 3: e2e PASS + regression (default unit 5 still works).**
- [ ] **Step 4: Commit** `feat: n-multiple card purchase unit (config) + server validation`.

### Task 4.3: Expiry = member-group sync + cascade on group extension

**Files:** Modify `createCardOrder` (expiry from buyer's own group), `updateMemberGroup` (cascade), remove `card_expire_month` from KNOWN_KEYS + config; update the hard-coded expiry copy in `my-cards-client.tsx:518-520`.

- [ ] **Step 1: e2e** — (a) buyer's card `expires_at` = their group's `valid_until`; (b) admin extends the group's `valid_until` → existing confirmed card pools whose expiry equalled the old value are updated and balances recomputed.
- [ ] **Step 2: Implement** cascade in `updateMemberGroup` (update matching `orders` + `syncCardBalance` per affected user).
- [ ] **Step 3: e2e PASS.**
- [ ] **Step 4: Commit** `feat: card expiry syncs to member group; cascade on group extension; drop card_expire_month`.

---

## Phase 5 — Enrollment wizard + single add-enroll + modify-as-rebook + gating

### Task 5.1: Enroll gating by `enroll_full`/`enroll_single` + time windows (server-enforced)

**Files:** Modify `batchEnrollInSessions` (add `enrollment_start_at/end_at` window check — currently missing), the full path (add phase1 window from `course_groups`), and `courses.type`/`pricing_mode` guards; enforce `courses.enroll_single/enroll_full`.

- [ ] **Step 1: e2e (adversarial)** — single-enroll a course with `enroll_single=false` (e.g. a style course before add-phase) via direct action call → rejected; full-enroll outside phase1 window → rejected; single-enroll outside the course window → rejected.
- [ ] **Step 2: Implement** guards (return `{success:false, message}`), all times Asia/Taipei.
- [ ] **Step 3: e2e PASS + regression.**
- [ ] **Step 4: Commit** `feat: server-enforced enroll-mode switches + registration windows`.

### Task 5.2: Course form — pricing_mode + prices + enroll switches + defaults by type

**Files:** Modify `src/components/admin/course-form.tsx` (schema + fields), `createCourse`/`updateCourse` actions.

- [ ] **Step 1: e2e** — admin creates an `ntd` workshop with member/guest × single/full prices and both enroll switches; creating an `ntd` course with a blank required price shows validation; a `style` course defaults to `ntd` + single-only + member price 0.
- [ ] **Step 2: Implement** conditional fields (show NTD prices only when `pricing_mode='ntd'`; show cards_per_session only when `card`), type→default prefill.
- [ ] **Step 3: e2e PASS.**
- [ ] **Step 4: Commit** `feat: course form pricing mode + NTD prices + enroll switches with type defaults`.

### Task 5.3: Enrollment wizard page (multi-step)

**Files:** Create `src/app/(protected)/courses/groups/[groupId]/register/page.tsx` + `register-wizard-client.tsx`; server action `submitGroupEnrollment(payload)`.

**Interfaces:**
- Produces `submitGroupEnrollment(payload: { groupId, selections: Array<{courseId, mode:'full', wantsLeader:boolean, votes?: Array<{pollId, optionIds:string[]}>}>, buyCards?: {quantity, remittance?}, includeMembership?: boolean }): Promise<{ perCourse: Array<{courseId, status:'enrolled'|'pending_payment'|'pending_vote', reason?}>, orderId?: string }>` — one atomic submission per course via `enroll_atomic`; MV courses → `pending_vote` (no deduction); card courses with enough balance → `enrolled`; card shortfall or ntd → `pending_payment` + course_fee/card order.

- [ ] **Step 1: e2e (happy)** — member enters `/register` inside phase1 window: selects a card normal course (enough balance → enrolled), a card course with shortfall (→ prompts buy-cards + remittance → pending_payment), an MV course (→ pending_vote), toggles 想當班長 on one; completion screen shows each course's status. Assert DB rows/statuses.
- [ ] **Step 2: e2e (adversarial)** — direct `submitGroupEnrollment` with (a) a course whose `enroll_full=false` → that course rejected; (b) a client-sent price/amount field is ignored (amount is server-resolved via `resolvePrice`); (c) selecting a full course → that course `full`, others still succeed.
- [ ] **Step 3: Implement** wizard steps (选课 → MV 选歌 → 班长意愿 → 费用结算 → 完成), mirroring existing dialog components; server action composes resolvePrice + enroll_atomic + order creation. YouTube embeds via poll_options.youtube_url.
- [ ] **Step 4: e2e PASS.**
- [ ] **Step 5: Commit** `feat: multi-step group enrollment wizard + submitGroupEnrollment (pricing + atomic + orders)`.

### Task 5.4: Modify-as-rebook (作廢重報) — atomic

**Files:** Add `resubmitGroupEnrollment` (RPC or transactional action) that cancels the prior submission (release seats, refund deducted cards, cancel pending/remitted orders — but REFUSE if any linked order is `confirmed`), then re-runs `submitGroupEnrollment` with a new timestamp.

- [ ] **Step 1: e2e (happy)** — modify a submission before phase1 end: old enrollments cancelled, new ones created with later `enrolled_at`.
- [ ] **Step 2: e2e (adversarial)** — (a) attempt to modify after a linked order is `confirmed` → blocked with message, original intact (no seat loss); (b) rapid repeated resubmit does not leak seats or double-refund cards (assert balance + occupancy conserved).
- [ ] **Step 3: Implement** with a single transaction (RPC) so partial failure can't strand seats; strong UI warning before submit.
- [ ] **Step 4: e2e PASS.**
- [ ] **Step 5: Commit** `feat: modify enrollment = atomic void-and-rebook (loses early-bird order); guard confirmed orders`.

### Task 5.5: Single add-enroll integrated with pricing + no-cancel rule

**Files:** Modify `SessionEnrollmentDialog` + `batchEnrollInSessions` to route via `resolvePrice` (card→deduct, ntd→order, free→immediate through blacklist guard); harden `cancelEnrollment` to server-side rule.

- [ ] **Step 1: e2e (adversarial)** — an `enrolled` (paid) user calls `cancelEnrollment` directly → rejected (only waitlist/pending-unpaid cancellable by self); confirm a guest self-cancel of a free style enrollment is also blocked (anti seat-churn).
- [ ] **Step 2: Implement** the pricing routing + `cancelEnrollment` guard (`status` + type check).
- [ ] **Step 3: e2e PASS + regression (card single-enroll unchanged).**
- [ ] **Step 4: Commit** `feat: single add-enroll via pricing resolver; server-enforced no-self-cancel`.

---

## Phase 6 — MV voting + open-ballot settlement

### Task 6.1: Poll authoring in course form + tally view

**Files:** Modify `course-form.tsx` (add/edit polls + options + youtube); server actions `upsertCoursePoll`, `deleteCoursePoll`; admin course page tally block.

- [ ] **Step 1: e2e** — admin adds a single-choice "拍攝歌曲" poll + a multi "副歌" poll with 5 options each; tally shows 0 votes.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: e2e PASS.**
- [ ] **Step 4: Commit** `feat: MV poll authoring + live tally`.

### Task 6.2: Vote-in-wizard (report = vote) with integrity guards

**Files:** Wizard step 2 writes `poll_votes` bound to the created `pending_vote` enrollment.

- [ ] **Step 1: e2e (adversarial)** — (a) submit a vote for a poll on a course the user did NOT select → rejected; (b) submit two single-choice options → rejected (single=one option); (c) vote after poll `published` → rejected; (d) forge another user's `enrollment_id` on a vote → rejected (server binds enrollment to the acting user).
- [ ] **Step 2: Implement** vote writes inside `submitGroupEnrollment` with server-side validation (poll open, option belongs to poll, single/multi cardinality, enrollment belongs to caller). UNIQUE(poll,user,option) prevents dup.
- [ ] **Step 3: e2e PASS.**
- [ ] **Step 4: Commit** `feat: MV vote-on-enroll with integrity guards`.

### Task 6.3: Publish + settle RPC (top-k, tie by admin, fcfs on overflow)

**Files:** `supabase/migrations/013_publish_poll.sql` RPC `publish_poll(poll_id, winner_option_ids[])`; server action `publishPollResults`.

**Interfaces:** `publishPollResults(pollId, winnerOptionIds)` — marks winners, poll `published`; for each MV course, gathers `pending_vote` enrollments whose votes intersect winners, runs `allocate(candidates, capacity, 'fcfs')`; granted → run pricing (card deduct or pending_payment + order), denied/non-voters-of-winner → `cancelled` + reason.

- [ ] **Step 1: e2e (happy)** — with votes seeded, admin publishes top-1/top-2 (adjusting a tie); voters of winners within capacity → enrolled/pending_payment; over-capacity later voters → cancelled(超額); non-winner voters → cancelled(未投中). Assert statuses + reasons.
- [ ] **Step 2: e2e (adversarial)** — non-admin `publishPollResults` rejected; double-publish is idempotent/blocked; settlement is atomic (no partial seat assignment on error).
- [ ] **Step 3: Implement** RPC + action.
- [ ] **Step 4: e2e PASS + regression.**
- [ ] **Step 5: Commit** `feat: MV publish+settle (top-k, tie override, fcfs overflow, auto-cancel)`.

---

## Phase 7 — Absence-penalty blacklist

### Task 7.1: Penalty computation + report guard

**Files:** Create `src/lib/supabase/penalty.ts` (`computeCurrentPeriod()`, `countUnexcusedFreeAbsences(userId)`, `isBlacklisted(userId)`) + test; guard inside `enroll_atomic` caller path for `free` enrollments.

**Interfaces:** period = latest `member_groups.valid_until` and (valid_until − 1 year, valid_until]; violation = `attendance_records.status='absent'` on a session of a course where `resolvePrice(...).kind==='free'` within period; blacklisted = count ≥ 2 AND no `penalty_overrides` row for that `period_end`.

- [ ] **Step 1: Failing unit tests** for period math + threshold + override clears it.
- [ ] **Step 2: Implement**; wire a guard so a blacklisted user's attempt to enroll in any `free` course is rejected with the reason + violation detail.
- [ ] **Step 3: e2e (adversarial)** — user with 2 unexcused free-course absences is blocked from a free style course via (a) wizard, (b) single dialog, (c) direct action; a `penalty_overrides` row re-enables; converting one absence to leave (attendance edit) drops them below threshold and re-enables automatically.
- [ ] **Step 4: tests + e2e PASS.**
- [ ] **Step 5: Commit** `feat: absence-penalty computation + free-course enroll guard (all paths)`.

### Task 7.2: Blacklist admin tab

**Files:** Add "黑名單" tab to review center: list violators (name / count / each violation course+date / blacklisted? / 解鎖 button → writes `penalty_overrides`). Style matches existing tabs.

- [ ] **Step 1: e2e** — tab lists a violator with count≥2 flagged; admin clicks 解鎖 → override written, status flips to allowed; non-admin cannot open/act (server guard).
- [ ] **Step 2: Implement.**
- [ ] **Step 3: e2e PASS.**
- [ ] **Step 4: Commit** `feat: blacklist admin tab (view violations + unlock via override)`.

---

## Phase 8 — App-inline status/notifications + final gates

### Task 8.1: Status surfacing in my_courses / my_cards + dashboard todos

**Files:** Modify `src/app/(protected)/dashboard/my_courses/*` and `my_cards`; add status badges (待開票/待繳費/已成立/已取消+`cancel_reason`) and a "待補匯款" entry point; dashboard todo count.

- [ ] **Step 1: e2e** — a member with a `pending_payment` order sees 待繳費 + remittance entry; a `pending_vote` shows 待開票; a `cancelled(未投中)` shows the reason.
- [ ] **Step 2: Implement** using existing badge constants (`src/lib/constants.ts`).
- [ ] **Step 3: e2e PASS.**
- [ ] **Step 4: Commit** `feat: app-inline enrollment/order status surfacing + dashboard todos`.

### Task 8.2: Full-suite gate + tracker finalize

- [ ] **Step 1: Run everything** — `npx tsc --noEmit && pnpm lint && pnpm build && pnpm test && pnpm e2e`. All green.
- [ ] **Step 2: Update `docs/mtk-feature-tracker.md`** — mark implemented/E2E columns; confirm every requirement row has ✅ across H/A/R or a noted exception.
- [ ] **Step 3: Prod migration checklist** — apply migrations 010–013 + data backfills to prod `zhaloqbeguzsknodrxsm` via MCP in order; re-run smoke E2E against a prod-like env; confirm CLAUDE.md prod invariants (EZDANCE header, group enrollment visibility decision) are intact.
- [ ] **Step 4: Commit** `docs: finalize MTK feature tracker; all gates green`.

---

## Phase 9 — Repo-wide lint-debt cleanup (scheduled; runs LAST)

**Context:** The repo was scaffolded on Next 16 + ESLint 9 with a broken `next lint` script and an ESLint-9-ignored `.eslintrc.json`, so lint never ran until Task 0.4. Result: **430 pre-existing problems (318 errors / 112 warnings), overwhelmingly `@typescript-eslint/no-explicit-any`** in `src/lib/supabase/actions.ts` and peers. This phase drives the whole repo to lint-clean.

**Why last (not now):** (1) It's a large, behavior-risky diff — replacing `any` with real types routinely surfaces latent bugs; it must run with the FULL e2e safety net (regression + all feature suites) in place, which only exists after Phase 8. (2) It dovetails with Task 1.3's refreshed `database.ts` types and the typed row shapes introduced across Phases 1–7 — many `any`s become trivially typeable once those exist, so doing it after avoids re-work. (3) It must not block or entangle the MTK feature delivery.

### Task 9.1: Auto-fixable + mechanical rules
- [ ] Run `npx eslint . --fix` for the 3 auto-fixable problems + any trivially mechanical rules (prefer-const, unused imports); run tsc + full e2e; commit per rule-group.

### Task 9.2: `no-explicit-any` elimination, file-by-file
- [ ] For each high-count file (start with `actions.ts`), replace `any` with real types (Supabase row types from refreshed `database.ts`, generics, `unknown` + narrowing). After each file: `npx tsc --noEmit`, `npx eslint <file>` clean, run the e2e suites that cover that file's behavior, commit. Never weaken types with `// eslint-disable` except where genuinely unavoidable (documented).

### Task 9.3: Remaining warnings + whole-repo gate flip
- [ ] Clear residual warnings; once `pnpm lint` (whole repo) is clean, flip the CI gate from "changed-files" to "whole-repo lint clean" and update the plan's Global Constraints + tracker.

---

## Self-Review

**Spec coverage** (spec §→task):
- §3 data model → T1.1/1.2/1.3; §4 pricing → T1.4/1.5; §5 enroll engine/RPC/allocation/rebook → P3, T5.1/5.3/5.4; §6 orders/review → P2; §7 wizard → T5.3; §8 single add-enroll → T5.5; §9 blacklist → P7; §10 MV → P6; §11 card rules → P4; §12 bug fixes → T1.1(rejected type),T1.5(dead code/isMember),T2.2(refund count),T3.3(batch capacity),T3.4(waitlist),T5.1(window),T1.3(stale types); §13 notifications → T8.1; §14 migration → T1.1/1.2 + T8.2 prod; §15 E2E happy/adversarial/regression → P0 baseline + per-feature adversarial specs throughout. **No uncovered spec section.**

**Placeholder scan:** foundation SQL/code fully written (T1.1/1.2/1.4); UI-heavy tasks (wizard, tabs, forms) specify files + server-action signatures + concrete happy/adversarial e2e assertions rather than pre-baked JSX, mirroring existing components — acceptable per "follow established patterns."

**Type consistency:** names used across phases (`isMemberActive`, `resolvePrice`, `PriceResult`, `computeSessionOccupancy`, `allocate`, `enroll_atomic`, `submitGroupEnrollment`, `OrderType/OrderStatus/EnrollmentStatus`) all trace to the Shared Interface Contract. `orders` (not `card_orders`) used from T1.1 onward; `CardOrder` kept as alias to bound churn.

## Adversarial E2E Charter (spec §15) — enforced per-task above, indexed here

- Bypass-UI/direct-action authority: T2.3, T5.1, T5.5, T6.3, T7.1 (all mutations re-verify role/ownership server-side).
- Free-course abuse: T7.1 (blacklist across all paths), T5.5 (no self-cancel churn), T7.1 (guest can't get free where ntd>0 — enforced by resolvePrice in T5.3/5.5).
- Vote manipulation: T6.2 (non-selected course, cardinality, post-publish, forged enrollment_id).
- Capacity/concurrency: T3.3 (parallel oversell), T5.4 (rebook seat/refund conservation).
- Payment fraud: T4.1 (out-of-window), T4.2 (non-multiple/negative), T5.3b (client price ignored — server resolves), T2.3 (self-confirm blocked).
- IDOR / others' rights: T5.4a (confirmed-order protection), T5.5 (others' enrollment), transfer rules unchanged (regression), T6.2d (forged enrollment_id).
- Timezone boundaries: windows/expiry/period all Asia/Taipei (T4.1, T4.3, T7.1); add a boundary spec asserting a UTC-vs-Taipei midnight case in T4.1.
- Regression: P0 baseline re-run as the CI gate at the end of every phase.
