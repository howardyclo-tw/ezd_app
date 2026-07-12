/**
 * Absence-penalty blacklist computation.
 *
 * All functions are PURE — no DB calls. The caller (server actions)
 * fetches data and passes it in, making these trivially unit-testable.
 */

/** Unexcused-absence threshold before blacklisting kicks in. */
export const THRESHOLD = 2;

/**
 * Compute the current penalty period based on member groups.
 *
 * - Takes the member group with the latest `valid_until`.
 * - Period = (valid_until - 1 year, valid_until]  (exclusive start, inclusive end).
 * - Fallback (no member groups): calendar year based on `taipeiToday`.
 *
 * Returns `{ periodStart, periodEnd }` as YYYY-MM-DD strings.
 * `periodStart` is the exclusive boundary (absences on that date are NOT counted).
 */
export function computeCurrentPeriod(
  memberGroups: { valid_until: string }[],
  taipeiToday: string, // YYYY-MM-DD
): { periodStart: string; periodEnd: string } {
  if (memberGroups.length === 0) {
    // Fallback: calendar year of taipeiToday
    const year = taipeiToday.slice(0, 4);
    // Jan 1 is the exclusive start (not counted), Dec 31 is inclusive end
    return {
      periodStart: `${year}-01-01`,
      periodEnd: `${year}-12-31`,
    };
  }

  // Find the latest valid_until across all groups
  const latestValidUntil = memberGroups
    .map((g) => g.valid_until)
    .sort()
    .pop()!;

  // Period start = valid_until minus 1 year (exclusive boundary)
  // Use UTC-explicit Date to avoid local-timezone drift
  const [y, m, d] = latestValidUntil.split('-').map(Number);
  const startUtc = new Date(Date.UTC(y - 1, m - 1, d));
  const periodStart = startUtc.toISOString().slice(0, 10);

  return {
    periodStart,
    periodEnd: latestValidUntil,
  };
}

/**
 * Count unexcused absences on free courses within a penalty period.
 *
 * Each item in `absences` represents an attendance record with status='absent'
 * that has already been joined with course pricing data.
 *
 * Period boundaries: start is EXCLUSIVE, end is INCLUSIVE.
 */
export function countFreeAbsences(
  absences: { isFree: boolean; sessionDate: string }[],
  periodStart: string,
  periodEnd: string,
): number {
  return absences.filter((a) => {
    if (!a.isFree) return false;
    // Exclusive start, inclusive end: sessionDate must be > periodStart AND <= periodEnd
    return a.sessionDate > periodStart && a.sessionDate <= periodEnd;
  }).length;
}

/**
 * Determine if a user is blacklisted.
 *
 * Blacklisted = absence count >= THRESHOLD AND no penalty override for the period.
 */
export function isBlacklisted(
  absenceCount: number,
  hasOverride: boolean,
): boolean {
  if (hasOverride) return false;
  return absenceCount >= THRESHOLD;
}
