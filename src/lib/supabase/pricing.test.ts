import { describe, it, expect } from 'vitest';
import { resolvePrice, isMemberActive } from './pricing';

describe('isMemberActive', () => {
  it('guest is never member', () => {
    expect(isMemberActive({ role: 'guest', member_valid_until: null, groupValidUntil: '2026-12-31' }, '2026-07-02')).toBe(false);
  });
  it('member with future group expiry is active', () => {
    expect(isMemberActive({ role: 'member', member_valid_until: null, groupValidUntil: '2026-12-31' }, '2026-07-02')).toBe(true);
  });
  it('member with expired group is inactive', () => {
    expect(isMemberActive({ role: 'member', member_valid_until: null, groupValidUntil: '2026-06-01' }, '2026-07-02')).toBe(false);
  });
});
describe('resolvePrice', () => {
  const base = { cards_per_session: 2, price_member_single: 300, price_guest_single: 400, price_member_full: 1000, price_guest_full: 1400, sessionCount: 6 };
  it('card mode single = cards_per_session', () => {
    expect(resolvePrice({ ...base, pricing_mode: 'card' }, true, 'single')).toEqual({ kind: 'card', cards: 2 });
  });
  it('card mode full = cards_per_session * sessionCount', () => {
    expect(resolvePrice({ ...base, pricing_mode: 'card' }, true, 'full')).toEqual({ kind: 'card', cards: 12 });
  });
  it('ntd member single', () => {
    expect(resolvePrice({ ...base, pricing_mode: 'ntd' }, true, 'single')).toEqual({ kind: 'ntd', amount: 300 });
  });
  it('ntd guest full', () => {
    expect(resolvePrice({ ...base, pricing_mode: 'ntd' }, false, 'full')).toEqual({ kind: 'ntd', amount: 1400 });
  });
  it('ntd with 0 price for the identity is free', () => {
    expect(resolvePrice({ ...base, pricing_mode: 'ntd', price_member_single: 0 }, true, 'single')).toEqual({ kind: 'free' });
  });
  it('free mode always free', () => {
    expect(resolvePrice({ ...base, pricing_mode: 'free' }, false, 'single')).toEqual({ kind: 'free' });
  });
});
