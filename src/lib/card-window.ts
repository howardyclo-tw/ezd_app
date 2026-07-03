/**
 * card-window.ts
 *
 * Pure utility for computing the monthly card-purchase window.
 * "First Monday-to-Friday of each month" rule:
 *   - Find the first Monday of the month
 *   - The window runs Monday through Friday (5 calendar days)
 *
 * All dates are YYYY-MM-DD strings (Asia/Taipei convention).
 */

/**
 * Compute the first Monday..Friday window for the month containing `taipeiToday`.
 *
 * @param taipeiToday  YYYY-MM-DD date string (Asia/Taipei)
 * @returns `{ start, end }` both YYYY-MM-DD, where start = first Monday, end = that Friday
 */
export function getCardPurchaseWindow(taipeiToday: string): { start: string; end: string } {
  const [year, month] = taipeiToday.split('-').map(Number);

  // Day of week for the 1st of this month (0=Sun, 1=Mon, ..., 6=Sat)
  // Using UTC to avoid any local-timezone surprises in a pure function
  const dayOfWeek = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();

  // Offset from the 1st to the first Monday
  // Sun(0)->1, Mon(1)->0, Tue(2)->6, Wed(3)->5, Thu(4)->4, Fri(5)->3, Sat(6)->2
  const offset = (8 - dayOfWeek) % 7;
  const firstMonday = 1 + offset;
  const firstFriday = firstMonday + 4;

  const mm = String(month).padStart(2, '0');
  const startDay = String(firstMonday).padStart(2, '0');
  const endDay = String(firstFriday).padStart(2, '0');

  return {
    start: `${year}-${mm}-${startDay}`,
    end: `${year}-${mm}-${endDay}`,
  };
}

/**
 * Check whether `taipeiToday` falls within the first-Monday..Friday window.
 *
 * @param taipeiToday  YYYY-MM-DD date string (Asia/Taipei)
 * @returns true if taipeiToday is within [start, end] inclusive
 */
export function isCardWindowOpen(taipeiToday: string): boolean {
  const { start, end } = getCardPurchaseWindow(taipeiToday);
  return taipeiToday >= start && taipeiToday <= end;
}
