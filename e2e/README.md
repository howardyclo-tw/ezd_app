# E2E Test Seed

**WARNING: The globalSetup (e2e/global-setup.ts) and seed-users script must ONLY target the DEV Supabase project (`mvxdxldwznbqycfgwqmc`). NEVER point them at production (`zhaloqbeguzsknodrxsm`). Both scripts abort automatically if they detect the production URL.**

Seeds the DEV Supabase database with deterministic fixtures for regression tests.

## Accounts

| Email | Password | Role | Notes |
|---|---|---|---|
| e2e-admin@mediatek.com | mediatek | admin | Review center, attendance, member admin |
| e2e-member@mediatek.com | mediatek | member | Linked to member group, 10 card balance |
| e2e-member2@mediatek.com | mediatek | member | Transfer recipient |
| e2e-guest@mediatek.com | mediatek | guest | Minimal permissions |

## Seeded Data

- **Member group**: `E2E Test Group 2026`, valid until 2026-12-31
- **Course group**: `E2E H2 2026 Course Group`, registration open (phase 1 active)
- **Courses**: E2E Basic Groove (normal), E2E Single Course, E2E Multi-Card Course (cards_per_session=2), E2E NTD Course (pricing_mode=ntd), E2E Workshop (workshop)
- **Sessions**: 2 past + 3 future for Basic Groove; 3 future for Single/NTD; 1 future for Multi-Card; 4 future for Workshop
- **Enrollments**: Member full-enrolled in Basic Groove + Workshop; single in Multi-Card; pending_payment in NTD
- **Card orders**: 10 confirmed cards + 2 used cards for the member (expires 2026-12-31)
- **Attendance**: Absence on past session (makeup source)

## Seeding Architecture

**Single source of truth: `e2e/global-setup.ts`** (Playwright globalSetup).

The globalSetup runs automatically before every Playwright suite. It uses the Supabase service-role client (PostgREST) to reset all DB state to the deterministic baseline. No SQL file is needed.

## Run Order

### Step 1: Create auth users (one-time)

```bash
node e2e/seed-users.mjs
```

This creates the four auth users via the Supabase Admin API (idempotent).
The `handle_new_user` trigger auto-creates profile rows with role=guest.

### Step 2: Run tests

```bash
pnpm e2e e2e/regression
```

The Playwright globalSetup (`e2e/global-setup.ts`) automatically re-seeds all DB state before every suite run. No manual seed step is needed.

### Step 3: Verify (optional)

```sql
-- 4 profiles with expected roles
SELECT name, role, card_balance, member_group_id IS NOT NULL AS has_group
FROM profiles
WHERE id IN (SELECT id FROM auth.users WHERE email LIKE 'e2e-%@mediatek.com');

-- 1 course group
SELECT title, period_start, period_end FROM course_groups WHERE id = 'e2e00000-0000-0000-0000-000000000010';

-- 5 courses
SELECT name, type, capacity, cards_per_session FROM courses WHERE group_id = 'e2e00000-0000-0000-0000-000000000010';
```

## Safety

- `global-setup.ts` aborts if `NEXT_PUBLIC_SUPABASE_URL` points at production (`zhaloqbeguzsknodrxsm`)
- `seed-users.mjs` aborts if `.env.local` points at production
- All upserts use `ON CONFLICT (id)` for idempotency
- User IDs resolved dynamically via `auth.admin.listUsers()` (no hardcoded UUIDs for auth)
