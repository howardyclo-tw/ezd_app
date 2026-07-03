import { describe, it, expect } from 'vitest';
import { getCardPurchaseWindow, isCardWindowOpen } from './card-window';

describe('getCardPurchaseWindow', () => {
  // May 2026: May 1 = Friday -> first Monday = May 4, Friday = May 8
  it('May 2026 (1st is Friday): window is 4th-8th', () => {
    expect(getCardPurchaseWindow('2026-05-15')).toEqual({ start: '2026-05-04', end: '2026-05-08' });
    expect(getCardPurchaseWindow('2026-05-01')).toEqual({ start: '2026-05-04', end: '2026-05-08' });
  });

  // June 2026: June 1 = Monday -> first Monday = June 1, Friday = June 5
  it('June 2026 (1st is Monday): window is 1st-5th', () => {
    expect(getCardPurchaseWindow('2026-06-01')).toEqual({ start: '2026-06-01', end: '2026-06-05' });
    expect(getCardPurchaseWindow('2026-06-03')).toEqual({ start: '2026-06-01', end: '2026-06-05' });
  });

  // July 2026: July 1 = Wednesday -> first Monday = July 6, Friday = July 10
  it('July 2026 (1st is Wednesday): window is 6th-10th', () => {
    expect(getCardPurchaseWindow('2026-07-01')).toEqual({ start: '2026-07-06', end: '2026-07-10' });
    expect(getCardPurchaseWindow('2026-07-10')).toEqual({ start: '2026-07-06', end: '2026-07-10' });
  });

  // August 2026: Aug 1 = Saturday -> first Monday = Aug 3, Friday = Aug 7
  it('August 2026 (1st is Saturday): window is 3rd-7th', () => {
    expect(getCardPurchaseWindow('2026-08-01')).toEqual({ start: '2026-08-03', end: '2026-08-07' });
  });

  // February 2026: Feb 1 = Sunday -> first Monday = Feb 2, Friday = Feb 6
  it('February 2026 (1st is Sunday): window is 2nd-6th', () => {
    expect(getCardPurchaseWindow('2026-02-15')).toEqual({ start: '2026-02-02', end: '2026-02-06' });
  });

  // January 2027: Jan 1 = Friday -> first Monday = Jan 4, Friday = Jan 8
  it('January 2027 (year rollover, 1st is Friday): window is 4th-8th', () => {
    expect(getCardPurchaseWindow('2027-01-05')).toEqual({ start: '2027-01-04', end: '2027-01-08' });
  });

  // September 2026: Sep 1 = Tuesday -> first Monday = Sep 7, Friday = Sep 11
  it('September 2026 (1st is Tuesday): window is 7th-11th', () => {
    expect(getCardPurchaseWindow('2026-09-01')).toEqual({ start: '2026-09-07', end: '2026-09-11' });
  });

  // November 2026: Nov 1 = Sunday -> first Monday = Nov 2, Friday = Nov 6
  it('November 2026 (1st is Sunday): window is 2nd-6th', () => {
    expect(getCardPurchaseWindow('2026-11-01')).toEqual({ start: '2026-11-02', end: '2026-11-06' });
  });
});

describe('isCardWindowOpen', () => {
  // June 2026: window is June 1-5
  it('returns true on the first Monday (start of window)', () => {
    expect(isCardWindowOpen('2026-06-01')).toBe(true);
  });

  it('returns true mid-window (Wednesday)', () => {
    expect(isCardWindowOpen('2026-06-03')).toBe(true);
  });

  it('returns true on Friday (end of window)', () => {
    expect(isCardWindowOpen('2026-06-05')).toBe(true);
  });

  it('returns false on Saturday after first week', () => {
    expect(isCardWindowOpen('2026-06-06')).toBe(false);
  });

  // May 2026: window is May 4-8
  it('returns false before the window (May 1, which is before first Monday May 4)', () => {
    expect(isCardWindowOpen('2026-05-01')).toBe(false);
  });

  it('returns true on window start (May 4)', () => {
    expect(isCardWindowOpen('2026-05-04')).toBe(true);
  });

  it('returns false mid-month (May 15)', () => {
    expect(isCardWindowOpen('2026-05-15')).toBe(false);
  });

  // July 2026: window is July 6-10
  it('returns false on July 1 (before first Monday July 6)', () => {
    expect(isCardWindowOpen('2026-07-01')).toBe(false);
  });

  it('returns true on July 6 (first Monday)', () => {
    expect(isCardWindowOpen('2026-07-06')).toBe(true);
  });

  it('returns true on July 10 (Friday)', () => {
    expect(isCardWindowOpen('2026-07-10')).toBe(true);
  });

  it('returns false on July 11 (Saturday after window)', () => {
    expect(isCardWindowOpen('2026-07-11')).toBe(false);
  });

  // August 2026 (month starts on Saturday): window Aug 3-7
  it('returns false on Aug 1 (Saturday, before window)', () => {
    expect(isCardWindowOpen('2026-08-01')).toBe(false);
  });

  it('returns true on Aug 3 (Monday, window start)', () => {
    expect(isCardWindowOpen('2026-08-03')).toBe(true);
  });

  // February 2026 (month starts on Sunday): window Feb 2-6
  it('returns false on Feb 1 (Sunday, before window)', () => {
    expect(isCardWindowOpen('2026-02-01')).toBe(false);
  });

  it('returns true on Feb 2 (Monday, window start)', () => {
    expect(isCardWindowOpen('2026-02-02')).toBe(true);
  });

  // End of month: Dec 2026 (Dec 1=Tue), window Dec 7-11
  it('returns false on Dec 31 (well after window)', () => {
    expect(isCardWindowOpen('2026-12-31')).toBe(false);
  });
});
