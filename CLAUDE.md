# CLAUDE.md

Guidance for Claude Code in this repository. **Sections 1–3 are binding agent rules; the rest is project reference.**

## 1. Operating Rules (MUST)

- Communicate with the user primarily in 繁體中文.
- **MTK build = subagent-driven development** (user's standing authorization — no per-task re-confirmation needed). One task = an Implement phase and an INDEPENDENT Review phase, both pinned via `opts.model: 'claude-opus-4-6'` (fallback `claude-opus-4-8` if unavailable — tell the user). **Follow `docs/superpowers/mtk-execution-playbook.md` verbatim** for the script template, brief clauses, review schema, impact map, effort table, and phase-gate checklist.
- **No self-review, ever.** The orchestrator never accepts a task by reading the diff itself; an independent reviewer verifies by running tests and MUTATION-TESTING guards (removed guard ⇒ test must go red). Reviewer severity labels do NOT override user rules: money/important features need 100% happy+adversarial coverage before a task counts as done.
- **Anti-false-green:** adversarial tests must invoke the real server action, assert DB state, and fail if the guard were removed. No UI-only tests claiming server coverage; no tautological assertions.
- **Test scope is assigned by the orchestrator** (impact map in the playbook), never chosen by the implementer (驗者不自驗). Implementer runs only its assigned specs; **the reviewer alone runs the full e2e suite** (two concurrent Playwright runs against the one dev server cause false timeouts); orchestrator does one clean full run at each phase end.
- **Fixtures:** `e2e/global-setup.ts` is the single seed source. Add isolated fixtures with new fixed UUIDs; never mutate shared baseline values.
- **UX rules (gate conditions):** every UI phase needs a 幹部/學員 dual-perspective UX spec section BEFORE implementation; new pages must have a visible entry point for their target role (no entry = not done); every async status (待繳費/待開票/已取消+原因) must be visible to its owner AND to admins; closed windows render friendly disabled states, not raw errors; UI uses existing shadcn components/tokens and badges from `src/lib/constants.ts` only — no new color literals; phase gates include dual-role journey e2e (`e2e/journeys/*`). Source: `docs/superpowers/specs/2026-07-05-mtk-ux-addendum.md` §0.
- After every task, append to the ledger `.superpowers/sdd/progress.md`. At every phase end: full-suite gate → update dashboard (progress + coverage matrix) → redeploy Artifact (fixed URL) → reflection to memory.

## 2. Git Conventions (MUST)

- Do NOT add `Co-Authored-By` lines in commits.
- Do NOT push unless the user explicitly asks. A PreToolUse hook blocks `git push`; when the user explicitly requests a push, `touch .claude/allow-push`, push, then remove it. Do not fight the hook otherwise.
- Migrations: sequential numbering in `supabase/migrations/` (no gaps; next = 015). Apply to DEV first via `mcp__supabase__apply_migration`, save the same SQL as a repo file. Prod only at Phase 8 cutover.
- When merging dev → main: header must stay "EZDANCE" (white), group-enrollment/register entry stays hidden (Phase 1 not launched).

## 3. Critical Coding Rules

- **Dates:** Asia/Taipei for all date comparisons: `new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date())`. Never bare `new Date()` against a date string. timestamptz columns compare as instants (`new Date(col) > new Date()`) — do NOT convert them to Taipei date strings.
- **Server Actions only** (no API routes) in `src/lib/supabase/actions.ts`: `getCurrentUser()` verifies identity → `createAdminClient()` (service role, bypasses RLS) does all DB work → `revalidatePath`. Business validation lives in code, not RLS.
- All actions wrapped with `safe()` (`safe-action.ts`). User-facing guards `return { success: false, message }` (throw messages are masked in prod).
- Identity for pricing/eligibility = `isMemberActive()` from `src/lib/supabase/pricing.ts` (active member incl. admin; expired member = non-member). Never write ad-hoc member checks.
- All enrollment inserts go through the `enroll_atomic` RPC (row-lock + in-txn capacity + FIFO deduct). Prices are always server-resolved via `resolvePrice` — client-sent amounts are ignored.
- Dev server: `http://[::1]:3000` (IPv4 127.0.0.1:3000 is squatted). Browser darkreader hydration warnings = user's extension, not an app bug.

## Commands

```bash
pnpm dev          # Dev server (Turbopack) — binds [::1]:3000
pnpm build        # Production build
pnpm lint         # ESLint (flat config; repo has ~430 legacy problems — Phase 9; changed files must add none)
npx tsc --noEmit  # Type check
pnpm test         # Vitest unit suite
pnpm exec playwright test e2e/regression e2e/features   # Full e2e (globalSetup reseeds dev DB + auth storageState)
```

Package manager: **pnpm 10.27.0**

## Architecture

**Stack**: Next.js 16 (App Router) + React 19 + Supabase (PostgreSQL/Auth/RLS) + Tailwind 4 + Shadcn UI

**Deployment**: Vercel (hnd1). `main` → production (`ezdapp.vercel.app`), `dev` → preview (`ezdapp-dev.vercel.app`).

**Supabase projects**: dev `mvxdxldwznbqycfgwqmc`, prod `zhaloqbeguzsknodrxsm`.

**Route structure**: `(auth)/login,register`; `(protected)/dashboard` (my_cards, my_courses), `courses/groups/[groupId]` (+ `[courseId]` attendance, + `register` full-term wizard), `admin/members|settings`, `leader/rollcall|approvals|import`, `guide`. Root `/` → `/dashboard`.

**Auth**: middleware cookie sync (`updateSession`) + `ProtectedRoute` layout re-verification with role hierarchy `guest=0 < member=1 < admin=3`. Course leaders (班長) live in `course_leaders`, not a role.

**Key files**:

```
src/lib/supabase/
  actions.ts        # ALL mutations (~3800 lines): enroll (enrollInCourse legacy / batchEnrollInCourses / batchEnrollInSessions / submitGroupEnrollment / resubmitGroupEnrollment), orders (createCardOrder / createCourseFeeOrder / confirmOrder / cancelOrder / rejectOrder), guards (guardPricingMode / guardEnrollFull / guardEnrollSingle / guardGroupPhase1Window / guardCourseWindow), admin ops
  pricing.ts        # resolvePrice + isMemberActive (unit-tested)
  capacity.ts       # computeSessionOccupancy (single source of truth)
  card-utils.ts     # FIFO deduction + syncCardBalance
  queries.ts / server.ts / admin.ts / client.ts / middleware.ts / safe-action.ts / import-actions.ts
src/lib/allocation.ts, card-window.ts, card-purchase.ts, date.ts, constants.ts (badge colors/labels)
src/app/api/e2e-test-actions/route.ts   # LOCAL-ONLY (NODE_ENV-gated) test route → remove before prod
src/types/database.ts                    # types & enums
e2e/global-setup.ts                      # single seed source + auth storageState
supabase/migrations/                     # 001–014 (sequential; next 015)
```

## Business Logic (current code state)

- **Unified orders** table (`order_type`: card_purchase / course_fee / membership_fee; status pending→remitted→confirmed / rejected / cancelled). Review center tab 繳費對帳 handles all types; confirm/reject admin-only, cancel admin-or-owner.
- **Pricing**: per-course `pricing_mode` card/ntd/free + identity prices (member/guest × single/full; 0 = free for that identity). Type defaults: 常態→card, 專攻/風格→ntd (style: single-only, member 0).
- **Enrollment**: full-term window = group `registration_phase1_start/end`; single window = course `enrollment_start_at/end_at`; switches `enroll_full`/`enroll_single`. Statuses: enrolled / pending_payment / pending_vote / waitlist / cancelled — pending_* occupy seats. Wizard `/register` → `submitGroupEnrollment`; modify = atomic void-and-rebook (`resubmitGroupEnrollment`, refuses confirmed orders). Self-cancel: only waitlist or unpaid pending (enrolled 不可自行取消).
- **Eligibility (#32, landing in Task 5R.1)**: per-course `enroll_full_identity`/`enroll_single_identity` ('all'/'member'). Until 5R.1 lands, a legacy blanket "guests cannot full-enroll" throw still exists — scheduled for removal; target state lives in the decision log.
- **Cards**: FIFO by expiry; expiry = buyer's member-group `valid_until`, cascades on group extension; purchase window monthly-first-week (config) with n-multiple unit validation.
- **Makeup quota**: `min(absences, ceil(sessions/4) - used) + manual_quota`. Leave: only future sessions; rejection guards intact.

## Docs Map

- `docs/mtk-decision-log.md` — client-facing decisions (as-is → to-be), **check before changing any business rule**
- `docs/superpowers/specs/2026-07-02-mtk-features-design.md` + `2026-07-05-mtk-ux-addendum.md` — engine + UX specs
- `docs/superpowers/plans/2026-07-02-mtk-features.md` — phased plan (Phase 5R next → 6 MV voting → 7 blacklist → 8 notifications/prod → 9 lint debt)
- `docs/superpowers/mtk-execution-playbook.md` — HOW to execute tasks (templates; binding)
- `.superpowers/sdd/progress.md` — ledger (append-only log of every task)
- `docs/mtk-progress-dashboard.html` — dashboard source (**gitignored**, local-only; published as Artifact, fixed URL: https://claude.ai/code/artifact/ad61dd29-f0c3-4840-8049-7e24478a6cff)
- `docs/prd.md`, `docs/system-overview.md` — legacy product/architecture reference (prd 未含 MTK 決策,以 decision log 為準)
- User guide content: `system_config` key `user_guide` (in-app editable)
