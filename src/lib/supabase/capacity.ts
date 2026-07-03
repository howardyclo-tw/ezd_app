/**
 * Single source of truth for per-session occupancy computation.
 *
 * Formula:
 *   occupancy = activeFullCount + activeSingleCount(thisSession)
 *             + makeupCount + transferInCount
 *             - leaveCount - transferOutCount
 *
 * "Active" enrollment status = enrolled | pending_payment | pending_vote
 * (NOT cancelled, NOT waitlist)
 *
 * Replaces 3 inline implementations:
 *   1. actions.ts single-session enroll capacity guard
 *   2. courses/groups/[groupId]/page.tsx max-occupancy for isFull badge
 *   3. courses/groups/[groupId]/[courseId]/page.tsx per-session occupancy display
 */

import type { EnrollmentStatus, EnrollmentType } from '@/types/database';

/** Statuses that occupy a seat. */
const ACTIVE_STATUSES: ReadonlySet<EnrollmentStatus> = new Set([
  'enrolled',
  'pending_payment',
  'pending_vote',
]);

/** Minimal enrollment shape needed for the occupancy formula. */
export interface OccupancyEnrollment {
  type: EnrollmentType;           // 'full' | 'single'
  status: EnrollmentStatus;       // only active statuses count
  session_id?: string | null;     // required for single; ignored for full
}

/**
 * Input for computeSessionOccupancy.
 *
 * - `enrollments`: all enrollments for the course (caller filters by course_id
 *    upstream; the function filters by status/type/session internally).
 * - `sessionId`: the specific session being evaluated.
 * - `makeupCount`, `transferInCount`, `leaveCount`, `transferOutCount`:
 *    pre-counted approved attendance deltas for this session.
 */
export interface SessionOccupancyInput {
  enrollments: readonly OccupancyEnrollment[];
  sessionId: string;
  makeupCount: number;
  transferInCount: number;
  leaveCount: number;
  transferOutCount: number;
}

/**
 * Compute the number of occupied seats for a single session.
 *
 * This is the canonical occupancy formula used for capacity checks
 * (enrollment guards) and display (full/closed badges, session bars).
 */
export function computeSessionOccupancy(input: SessionOccupancyInput): number {
  const { enrollments, sessionId, makeupCount, transferInCount, leaveCount, transferOutCount } = input;

  let fullCount = 0;
  let singleCount = 0;

  for (const e of enrollments) {
    if (!ACTIVE_STATUSES.has(e.status)) continue;
    if (e.type === 'full') {
      fullCount++;
    } else if (e.type === 'single' && e.session_id === sessionId) {
      singleCount++;
    }
  }

  return fullCount + singleCount + makeupCount + transferInCount - leaveCount - transferOutCount;
}
