import { describe, it, expect } from 'vitest';
import { computeCurrentPeriod, countFreeAbsences, isBlacklisted, THRESHOLD } from './penalty';

// ---------------------------------------------------------------------------
// computeCurrentPeriod
// ---------------------------------------------------------------------------

describe('computeCurrentPeriod', () => {
  it('single member group: period = (valid_until - 1y, valid_until]', () => {
    const result = computeCurrentPeriod(
      [{ valid_until: '2027-06-30' }],
      '2026-07-12',
    );
    expect(result).toEqual({ periodStart: '2026-06-30', periodEnd: '2027-06-30' });
  });

  it('multiple member groups: uses latest valid_until', () => {
    const result = computeCurrentPeriod(
      [
        { valid_until: '2026-12-31' },
        { valid_until: '2027-06-30' },
        { valid_until: '2026-03-15' },
      ],
      '2026-07-12',
    );
    expect(result).toEqual({ periodStart: '2026-06-30', periodEnd: '2027-06-30' });
  });

  it('no member groups: fallback to calendar year of taipeiToday', () => {
    const result = computeCurrentPeriod([], '2026-07-12');
    expect(result).toEqual({ periodStart: '2026-01-01', periodEnd: '2026-12-31' });
  });

  it('no member groups: different year', () => {
    const result = computeCurrentPeriod([], '2025-01-15');
    expect(result).toEqual({ periodStart: '2025-01-01', periodEnd: '2025-12-31' });
  });

  it('valid_until exactly today: period still computed normally', () => {
    const result = computeCurrentPeriod(
      [{ valid_until: '2026-07-12' }],
      '2026-07-12',
    );
    expect(result).toEqual({ periodStart: '2025-07-12', periodEnd: '2026-07-12' });
  });

  it('valid_until in the past: still produces a valid period', () => {
    const result = computeCurrentPeriod(
      [{ valid_until: '2025-12-31' }],
      '2026-07-12',
    );
    expect(result).toEqual({ periodStart: '2024-12-31', periodEnd: '2025-12-31' });
  });

  it('leap year: Feb 29 valid_until minus 1 year overflows to Mar 1', () => {
    // 2028-02-29 minus 1 year: Date.UTC(2027, 1, 29) overflows to 2027-03-01
    const result = computeCurrentPeriod(
      [{ valid_until: '2028-02-29' }],
      '2027-06-01',
    );
    expect(result).toEqual({ periodStart: '2027-03-01', periodEnd: '2028-02-29' });
  });

  it('single group with valid_until on Jan 1: period spans previous year', () => {
    const result = computeCurrentPeriod(
      [{ valid_until: '2027-01-01' }],
      '2026-07-12',
    );
    expect(result).toEqual({ periodStart: '2026-01-01', periodEnd: '2027-01-01' });
  });
});

// ---------------------------------------------------------------------------
// countFreeAbsences
// ---------------------------------------------------------------------------

describe('countFreeAbsences', () => {
  const periodStart = '2026-01-01'; // exclusive
  const periodEnd = '2026-12-31';   // inclusive

  it('0 absences returns 0', () => {
    expect(countFreeAbsences([], periodStart, periodEnd)).toBe(0);
  });

  it('counts free absences within the period', () => {
    const absences = [
      { isFree: true, sessionDate: '2026-03-15' },
      { isFree: true, sessionDate: '2026-06-20' },
    ];
    expect(countFreeAbsences(absences, periodStart, periodEnd)).toBe(2);
  });

  it('does not count non-free absences', () => {
    const absences = [
      { isFree: false, sessionDate: '2026-03-15' },
      { isFree: true, sessionDate: '2026-06-20' },
      { isFree: false, sessionDate: '2026-09-10' },
    ];
    expect(countFreeAbsences(absences, periodStart, periodEnd)).toBe(1);
  });

  it('does not count absences outside the period (before start)', () => {
    const absences = [
      { isFree: true, sessionDate: '2025-12-15' },
      { isFree: true, sessionDate: '2026-06-20' },
    ];
    expect(countFreeAbsences(absences, periodStart, periodEnd)).toBe(1);
  });

  it('does not count absences outside the period (after end)', () => {
    const absences = [
      { isFree: true, sessionDate: '2027-01-05' },
      { isFree: true, sessionDate: '2026-06-20' },
    ];
    expect(countFreeAbsences(absences, periodStart, periodEnd)).toBe(1);
  });

  it('period start is exclusive: absence ON periodStart is NOT counted', () => {
    const absences = [
      { isFree: true, sessionDate: '2026-01-01' }, // exactly on start boundary
    ];
    expect(countFreeAbsences(absences, periodStart, periodEnd)).toBe(0);
  });

  it('period end is inclusive: absence ON periodEnd IS counted', () => {
    const absences = [
      { isFree: true, sessionDate: '2026-12-31' }, // exactly on end boundary
    ];
    expect(countFreeAbsences(absences, periodStart, periodEnd)).toBe(1);
  });

  it('mixed: some free some not, some in period some not', () => {
    const absences = [
      { isFree: true, sessionDate: '2025-11-01' },  // outside period
      { isFree: false, sessionDate: '2026-02-10' },  // not free
      { isFree: true, sessionDate: '2026-01-01' },   // on boundary (excluded)
      { isFree: true, sessionDate: '2026-01-02' },   // in period, free -> counted
      { isFree: true, sessionDate: '2026-12-31' },   // on end boundary -> counted
      { isFree: true, sessionDate: '2027-01-01' },   // after period
    ];
    expect(countFreeAbsences(absences, periodStart, periodEnd)).toBe(2);
  });

  it('all absences are non-free: returns 0', () => {
    const absences = [
      { isFree: false, sessionDate: '2026-03-01' },
      { isFree: false, sessionDate: '2026-04-01' },
      { isFree: false, sessionDate: '2026-05-01' },
    ];
    expect(countFreeAbsences(absences, periodStart, periodEnd)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isBlacklisted
// ---------------------------------------------------------------------------

describe('isBlacklisted', () => {
  it('THRESHOLD is 2', () => {
    expect(THRESHOLD).toBe(2);
  });

  it('count 0, no override -> not blacklisted', () => {
    expect(isBlacklisted(0, false)).toBe(false);
  });

  it('count 1, no override -> not blacklisted', () => {
    expect(isBlacklisted(1, false)).toBe(false);
  });

  it('count 2, no override -> blacklisted', () => {
    expect(isBlacklisted(2, false)).toBe(true);
  });

  it('count 3, no override -> blacklisted', () => {
    expect(isBlacklisted(3, false)).toBe(true);
  });

  it('count 2, has override -> not blacklisted (override clears it)', () => {
    expect(isBlacklisted(2, true)).toBe(false);
  });

  it('count 5, has override -> not blacklisted', () => {
    expect(isBlacklisted(5, true)).toBe(false);
  });

  it('count 0, has override -> not blacklisted (override irrelevant)', () => {
    expect(isBlacklisted(0, true)).toBe(false);
  });

  it('count 1, has override -> not blacklisted', () => {
    expect(isBlacklisted(1, true)).toBe(false);
  });
});
