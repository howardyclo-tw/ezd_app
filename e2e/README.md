# E2E Test Seed

Seeds the DEV Supabase database with deterministic fixtures for regression tests.

## Accounts

| Email | Password | Role | Notes |
|---|---|---|---|
| e2e-admin@mediatek.com | mediatek | admin | Review center, attendance, member admin |
| e2e-member@mediatek.com | mediatek | member | Linked to member group, 10 card balance |
| e2e-guest@mediatek.com | mediatek | guest | Minimal permissions |

## Seeded Data

- **Member group**: `E2E Test Group 2026`, valid until 2026-12-31
- **Course group**: `E2E H2 2026 Course Group`, registration open (phase 1 active)
- **Course**: `E2E Basic Groove` (normal, card-mode, capacity 20, published)
- **Sessions**: 3 future sessions (7/14/21 days from seed date)
- **Card order**: 10 confirmed cards for the member (expires 2026-12-31)
- **Card transaction**: Purchase ledger entry matching the order

## Run Order

### Step 1: Create auth users

```bash
node e2e/seed-users.mjs
```

This creates the three auth users via the Supabase Admin API (idempotent).
The `handle_new_user` trigger auto-creates profile rows with role=guest.

### Step 2: Apply seed SQL

Via Supabase MCP:
```
mcp__supabase__execute_sql(project_id: 'mvxdxldwznbqycfgwqmc', query: <contents of seed.sql>)
```

Via psql (if you have direct access):
```bash
psql "$DATABASE_URL" -f e2e/seed.sql
```

Via Supabase CLI:
```bash
supabase db execute --project-ref mvxdxldwznbqycfgwqmc < e2e/seed.sql
```

### Step 3: Verify

```sql
-- 3 profiles with expected roles
SELECT name, role, card_balance, member_group_id IS NOT NULL AS has_group
FROM profiles
WHERE id IN (SELECT id FROM auth.users WHERE email LIKE 'e2e-%@mediatek.com');

-- 1 course group
SELECT title, period_start, period_end FROM course_groups WHERE id = 'e2e00000-0000-0000-0000-000000000010';

-- 1 course
SELECT name, type, capacity, cards_per_session FROM courses WHERE id = 'e2e00000-0000-0000-0000-000000000020';

-- 3 sessions
SELECT session_date, session_number FROM course_sessions WHERE course_id = 'e2e00000-0000-0000-0000-000000000020';
```

## Safety

- Scripts validate `.env.local` points at DEV (not prod `zhaloqbeguzsknodrxsm`)
- All INSERTs use `ON CONFLICT (id) DO UPDATE` for idempotency
- User IDs resolved via `SELECT id FROM auth.users WHERE email = ...` (no hardcoded UUIDs for auth)
