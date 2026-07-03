import { describe, it, expect } from 'vitest';
import { computeSessionOccupancy } from './capacity';
import type { EnrollmentStatus, EnrollmentType } from '@/types/database';

// Helper to create a minimal enrollment row
function mkEnrollment(overrides: {
  type: EnrollmentType;
  status: EnrollmentStatus;
  session_id?: string | null;
}): { type: EnrollmentType; status: EnrollmentStatus; session_id?: string | null } {
  return {
    type: overrides.type,
    status: overrides.status,
    session_id: overrides.session_id ?? null,
  };
}

describe('computeSessionOccupancy', () => {
  const SESSION_A = 'session-a';
  const SESSION_B = 'session-b';

  it('counts full enrollments for every session', () => {
    const enrollments = [
      mkEnrollment({ type: 'full', status: 'enrolled' }),
      mkEnrollment({ type: 'full', status: 'enrolled' }),
    ];
    const result = computeSessionOccupancy({
      enrollments,
      sessionId: SESSION_A,
      makeupCount: 0,
      transferInCount: 0,
      leaveCount: 0,
      transferOutCount: 0,
    });
    expect(result).toBe(2);
  });

  it('counts single enrollments only for their specific session', () => {
    const enrollments = [
      mkEnrollment({ type: 'single', status: 'enrolled', session_id: SESSION_A }),
      mkEnrollment({ type: 'single', status: 'enrolled', session_id: SESSION_B }),
    ];
    // Session A should only see the single enrollment for A
    const resultA = computeSessionOccupancy({
      enrollments,
      sessionId: SESSION_A,
      makeupCount: 0,
      transferInCount: 0,
      leaveCount: 0,
      transferOutCount: 0,
    });
    expect(resultA).toBe(1);

    // Session B should only see the single enrollment for B
    const resultB = computeSessionOccupancy({
      enrollments,
      sessionId: SESSION_B,
      makeupCount: 0,
      transferInCount: 0,
      leaveCount: 0,
      transferOutCount: 0,
    });
    expect(resultB).toBe(1);
  });

  it('does NOT count cancelled enrollments', () => {
    const enrollments = [
      mkEnrollment({ type: 'full', status: 'cancelled' }),
      mkEnrollment({ type: 'single', status: 'cancelled', session_id: SESSION_A }),
    ];
    const result = computeSessionOccupancy({
      enrollments,
      sessionId: SESSION_A,
      makeupCount: 0,
      transferInCount: 0,
      leaveCount: 0,
      transferOutCount: 0,
    });
    expect(result).toBe(0);
  });

  it('does NOT count waitlist enrollments', () => {
    const enrollments = [
      mkEnrollment({ type: 'full', status: 'waitlist' }),
      mkEnrollment({ type: 'single', status: 'waitlist', session_id: SESSION_A }),
    ];
    const result = computeSessionOccupancy({
      enrollments,
      sessionId: SESSION_A,
      makeupCount: 0,
      transferInCount: 0,
      leaveCount: 0,
      transferOutCount: 0,
    });
    expect(result).toBe(0);
  });

  it('counts pending_payment enrollments as active', () => {
    const enrollments = [
      mkEnrollment({ type: 'full', status: 'pending_payment' }),
    ];
    const result = computeSessionOccupancy({
      enrollments,
      sessionId: SESSION_A,
      makeupCount: 0,
      transferInCount: 0,
      leaveCount: 0,
      transferOutCount: 0,
    });
    expect(result).toBe(1);
  });

  it('counts pending_vote enrollments as active', () => {
    const enrollments = [
      mkEnrollment({ type: 'full', status: 'pending_vote' }),
      mkEnrollment({ type: 'single', status: 'pending_vote', session_id: SESSION_A }),
    ];
    const result = computeSessionOccupancy({
      enrollments,
      sessionId: SESSION_A,
      makeupCount: 0,
      transferInCount: 0,
      leaveCount: 0,
      transferOutCount: 0,
    });
    expect(result).toBe(2);
  });

  it('adds makeup count to occupancy', () => {
    const enrollments = [
      mkEnrollment({ type: 'full', status: 'enrolled' }),
    ];
    const result = computeSessionOccupancy({
      enrollments,
      sessionId: SESSION_A,
      makeupCount: 3,
      transferInCount: 0,
      leaveCount: 0,
      transferOutCount: 0,
    });
    expect(result).toBe(4); // 1 full + 3 makeup
  });

  it('adds transfer-in count to occupancy', () => {
    const enrollments = [
      mkEnrollment({ type: 'full', status: 'enrolled' }),
    ];
    const result = computeSessionOccupancy({
      enrollments,
      sessionId: SESSION_A,
      makeupCount: 0,
      transferInCount: 2,
      leaveCount: 0,
      transferOutCount: 0,
    });
    expect(result).toBe(3); // 1 full + 2 transfer-in
  });

  it('subtracts leave count from occupancy', () => {
    const enrollments = [
      mkEnrollment({ type: 'full', status: 'enrolled' }),
      mkEnrollment({ type: 'full', status: 'enrolled' }),
      mkEnrollment({ type: 'full', status: 'enrolled' }),
    ];
    const result = computeSessionOccupancy({
      enrollments,
      sessionId: SESSION_A,
      makeupCount: 0,
      transferInCount: 0,
      leaveCount: 2,
      transferOutCount: 0,
    });
    expect(result).toBe(1); // 3 full - 2 leave
  });

  it('subtracts transfer-out count from occupancy', () => {
    const enrollments = [
      mkEnrollment({ type: 'full', status: 'enrolled' }),
      mkEnrollment({ type: 'full', status: 'enrolled' }),
    ];
    const result = computeSessionOccupancy({
      enrollments,
      sessionId: SESSION_A,
      makeupCount: 0,
      transferInCount: 0,
      leaveCount: 0,
      transferOutCount: 1,
    });
    expect(result).toBe(1); // 2 full - 1 transfer-out
  });

  it('combined realistic case: full + single + makeup + transfer_in - leave - transfer_out', () => {
    const enrollments = [
      // 3 active full enrollments
      mkEnrollment({ type: 'full', status: 'enrolled' }),
      mkEnrollment({ type: 'full', status: 'enrolled' }),
      mkEnrollment({ type: 'full', status: 'pending_payment' }),
      // 1 cancelled full (should NOT count)
      mkEnrollment({ type: 'full', status: 'cancelled' }),
      // 1 waitlist full (should NOT count)
      mkEnrollment({ type: 'full', status: 'waitlist' }),
      // 1 single for this session
      mkEnrollment({ type: 'single', status: 'enrolled', session_id: SESSION_A }),
      // 1 single for different session (should NOT count)
      mkEnrollment({ type: 'single', status: 'enrolled', session_id: SESSION_B }),
      // 1 cancelled single for this session (should NOT count)
      mkEnrollment({ type: 'single', status: 'cancelled', session_id: SESSION_A }),
    ];
    // 3 full + 1 single + 2 makeup + 1 transfer_in - 1 leave - 1 transfer_out = 5
    const result = computeSessionOccupancy({
      enrollments,
      sessionId: SESSION_A,
      makeupCount: 2,
      transferInCount: 1,
      leaveCount: 1,
      transferOutCount: 1,
    });
    expect(result).toBe(5);
  });

  it('handles empty enrollments with only attendance deltas', () => {
    const result = computeSessionOccupancy({
      enrollments: [],
      sessionId: SESSION_A,
      makeupCount: 2,
      transferInCount: 1,
      leaveCount: 0,
      transferOutCount: 0,
    });
    expect(result).toBe(3); // 0 + 2 makeup + 1 transfer_in
  });

  it('can produce zero or negative occupancy (degenerate edge case)', () => {
    const enrollments = [
      mkEnrollment({ type: 'full', status: 'enrolled' }),
    ];
    const result = computeSessionOccupancy({
      enrollments,
      sessionId: SESSION_A,
      makeupCount: 0,
      transferInCount: 0,
      leaveCount: 1,
      transferOutCount: 1,
    });
    // 1 full - 1 leave - 1 transfer_out = -1 (edge case, mathematically possible)
    expect(result).toBe(-1);
  });
});
