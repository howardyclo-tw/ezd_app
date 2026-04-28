# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # Start dev server (Turbopack)
pnpm build        # Production build
pnpm lint         # ESLint
npx tsc --noEmit  # Type check without emitting
```

Package manager: **pnpm 10.27.0**

## Architecture

**Stack**: Next.js 16 (App Router) + React 19 + Supabase (PostgreSQL/Auth/RLS) + Tailwind 4 + Shadcn UI

**Deployment**: Vercel (hnd1 Tokyo). Two environments:
- `main` branch → production (`ezdapp.vercel.app`)
- `dev` branch → preview (`ezdapp-dev.vercel.app`)

**Two Supabase projects**:
- Dev: `mvxdxldwznbqycfgwqmc`
- Prod: `zhaloqbeguzsknodrxsm`

### Server Actions Pattern

All mutations go through Server Actions in `src/lib/supabase/actions.ts`. No API routes.

```
User → Server Action → getCurrentUser() (verify identity) → adminClient (DB operations) → revalidatePath
```

**Two Supabase clients**:
- `createClient()` (from `server.ts`): User's JWT, subject to RLS. Used only for identity verification.
- `createAdminClient()` (from `admin.ts`): Service role key, bypasses RLS. Used for all DB read/write in server actions.

This pattern exists because RLS policies are too restrictive for cross-user operations (capacity checks, attendance writes, cross-intent cleanup). Business logic validation happens in code, not RLS.

**Error handling**: All server actions wrapped with `safe()` from `safe-action.ts`:
- Dev: shows full error message
- Prod: shows generic "操作失敗！" message
- Some guards use `return { success: false, message }` instead of `throw` to ensure messages reach the user in production

### Route Structure

```
src/app/
  (auth)/login, register           # Public auth pages
  (protected)/                     # Auth-guarded via middleware + ProtectedRoute
    dashboard/                     # Profile, stats, admin shortcuts
      my_cards/                    # Card pool & purchase
      my_courses/                  # Upcoming, makeup, history
    courses/                       # Course group listing
      groups/[groupId]/            # Courses in a period
        [courseId]/                 # Attendance sheet (點名單) + edit
      new/                         # Admin: create course
    admin/members/, settings/      # Admin pages (role-gated in page)
    leader/rollcall/, approvals/, import/   # Leader tools
    guide/                         # User guide (from system_config)
```

No parallel routes or intercepting routes. Root `/` redirects to `/dashboard`.

### Auth Flow

Two-layer defense:
1. **Middleware** (`src/lib/supabase/middleware.ts`): Cookie-based session sync via `updateSession()`. Unauthenticated users redirect to `/login`. Logged-in users on `/` redirect to `/dashboard`.
2. **ProtectedRoute** (`src/components/layout/protected-route.tsx`): Server component in `(protected)/layout.tsx`. Re-verifies `getUser()`. Supports optional `requiredRole` prop with hierarchy check (`guest=0 < member=1 < admin=3`).

Individual admin/leader pages handle their own role guards beyond the layout-level check.

### Client-Side Context

`RoleProvider` (`src/components/providers/role-provider.tsx`): Exposes `role`, `userName`, `setRole`, `setUserName` via React context. Wrapped at root layout level.

### Key File Organization

```
src/lib/supabase/
  actions.ts        # All mutations (2400+ lines): enroll, leave, makeup, transfer, card, admin
  queries.ts        # Read-only queries used by server components
  card-utils.ts     # FIFO card deduction with expiry validation
  safe-action.ts    # Error wrapper (dev vs prod)
  server.ts         # User client (React-cached) + getServerProfile()
  admin.ts          # Admin client (service role)
  client.ts         # Browser-side Supabase client
  middleware.ts     # Session cookie sync + auth redirects
  import-actions.ts # Bulk data import logic

src/actions/user-actions.ts  # Dev-only role switcher (email-gated server action)
src/types/database.ts        # All TypeScript types and enums
src/lib/constants.ts         # Shared badge colors/labels for attendance and enrollment
```

### Date Handling

Always use Asia/Taipei timezone for date comparisons:
```typescript
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
```
Never use `new Date()` directly for date strings — causes UTC offset bugs on Vercel servers.

### Roles

`guest` (非社員) → `member` (社員) → `admin` (幹部)

No `leader` role in profiles. Course leaders (班長) tracked in `course_leaders` table. They can only take attendance for their assigned courses.

## Business Logic

Detailed rules in `docs/prd.md`. Key points:

- **Card system**: FIFO deduction by expiry date. Cards must be valid (`expires_at >= session_date`).
- **Makeup quota**: `min(absences, ceil(sessions/4) - used) + manual_quota`. Manual quota (幹部贈予) not subject to 1/4 cap.
- **Full enrollment**: Members only (guests blocked). Occupancy = full + single + makeup + transferIn - leave - transferOut per session.
- **Leave**: All enrollment types can take leave. Auto-approved. Cannot leave past sessions.
- **Transfer**: Full enrollment members only. Recipient must be a member. Limited to same-day before class.
- **Rejection guards**: Rejecting a leave is blocked if the absence is used as a makeup source.

## Dev vs Main Branch

Dev branch has:
- Orange "EZDANCE-DEV" header
- Group enrollment button visible
- Dev role toggle (if enabled)

Main branch has:
- White "EZDANCE" header
- Group enrollment button hidden (Phase 1: not yet launched)
- No dev tools

When merging dev to main, restore these prod-only settings after merge.

## Git Conventions

- Do not add `Co-Authored-By` lines in commits
- Do not auto-push — wait for explicit user request
- When merging to main: always verify header stays "EZDANCE" and group enrollment stays hidden

## Docs

- `docs/prd.md` — Product requirements, feature status, business rules
- `docs/system-overview.md` — Architecture, DB schema, technical decisions
- User guide content stored in `system_config` table (key: `user_guide`), editable by admins in-app
- `supabase/migrations/` — 9 SQL migration files (schema, seeds, RLS fixes, phase1 registration)
