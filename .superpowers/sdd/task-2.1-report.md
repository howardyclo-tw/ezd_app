### Task 2.1 Report: course_fee order lifecycle

**Status**: DONE

#### What was built

1. **`createCourseFeeOrder({ userId, courseGroupId, amount, enrollmentIds })`** (line 2709)
   - Inserts `orders(order_type='course_fee', status='pending', amount=<NTD>)`
   - Links given enrollmentIds by setting `enrollments.order_id`
   - Uses `createAdminClient()` (service role) since this is called internally by the enrollment flow

2. **`confirmOrder(orderId)`** (line 2559) — generalized from `confirmCardOrder`
   - Branches on `order_type`:
     - `card_purchase`: existing behavior preserved (issue cards, sync balance, membership upgrade, card_transaction record)
     - `course_fee`: flips linked enrollments from `pending_payment`/`pending_vote` to `enrolled`
     - `membership_fee`: no-op side-effects (future)
   - `confirmCardOrder` is now a thin wrapper that delegates to `confirmOrder`

3. **`cancelOrder(orderId, reason?)`** (line 2511) — generalized from `cancelCardOrder`
   - Branches on `order_type`:
     - `card_purchase`: existing behavior (just set order status, no enrollment side-effects)
     - `course_fee`: cancels linked enrollments (`pending_payment`/`pending_vote` -> `cancelled`) with `cancel_reason`
   - `cancelCardOrder` is now a thin wrapper

4. **`rejectOrder(orderId, reason?)`** (line 2659) — generalized from `rejectCardOrder`
   - Branches on `order_type`:
     - `card_purchase`: existing behavior (sync card balance after rejection)
     - `course_fee`: cancels linked enrollments (including `enrolled` status) with `cancel_reason`
   - `rejectCardOrder` is now a thin wrapper

5. **`submitRemittanceInfo`** (line 2468) — generalized
   - Removed `.eq('order_type', 'card_purchase')` filter so it works for any order_type

#### Call sites preserved

- `src/components/leader/approvals-tabs-client.tsx`: imports `confirmCardOrder` and `rejectCardOrder` unchanged (they now delegate to generalized versions)
- `src/components/dashboard/my-cards-client.tsx`: imports `cancelCardOrder` unchanged (delegates to `cancelOrder`)

#### Verification

- **tsc**: `npx tsc --noEmit` clean (zero errors)
- **Lint**: no new violations introduced (all existing violations are pre-existing `@typescript-eslint/no-explicit-any`)
- **e2e regression**: `card-purchase.spec.ts` passes (1 passed, 31.5s) -- proves card_purchase confirm/approve path unchanged
- **course_fee branch**: verified by code inspection. Cannot be e2e tested until Task 2.3 (review-center UI) and Phase 5 (enrollment entry point). The transitions are:
  - `createCourseFeeOrder` -> order(pending) + enrollments get order_id
  - `submitRemittanceInfo` -> order(pending -> remitted)
  - `confirmOrder` (course_fee branch) -> order(confirmed) + enrollments(pending_payment/pending_vote -> enrolled)
  - `cancelOrder` (course_fee branch) -> order(cancelled) + enrollments(pending_payment/pending_vote -> cancelled)
  - `rejectOrder` (course_fee branch) -> order(rejected) + enrollments(any active -> cancelled)

#### Seat semantics

Enrollment status `cancelled` does not occupy a seat (per SEAT SEMANTICS rule: only `enrolled`, `pending_payment`, `pending_vote` occupy). So cancelling/rejecting a course_fee order automatically releases seats since the linked enrollments move to `cancelled`.
