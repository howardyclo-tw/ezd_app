import { describe, it, expect } from 'vitest';
import { validatePurchaseQuantity, sanitizePurchaseUnit } from './card-purchase';

describe('sanitizePurchaseUnit', () => {
  it('passes through a valid positive integer', () => {
    expect(sanitizePurchaseUnit(5)).toBe(5);
    expect(sanitizePurchaseUnit(10)).toBe(10);
    expect(sanitizePurchaseUnit(1)).toBe(1);
  });

  it('falls back to 5 for NaN', () => {
    expect(sanitizePurchaseUnit(NaN)).toBe(5);
  });

  it('falls back to 5 for 0', () => {
    expect(sanitizePurchaseUnit(0)).toBe(5);
  });

  it('falls back to 5 for negative values', () => {
    expect(sanitizePurchaseUnit(-3)).toBe(5);
    expect(sanitizePurchaseUnit(-1)).toBe(5);
  });

  it('falls back to 5 for Infinity', () => {
    expect(sanitizePurchaseUnit(Infinity)).toBe(5);
    expect(sanitizePurchaseUnit(-Infinity)).toBe(5);
  });

  it('falls back to 5 for non-integer floats', () => {
    expect(sanitizePurchaseUnit(2.5)).toBe(5);
    expect(sanitizePurchaseUnit(4.9)).toBe(5);
  });
});

describe('validatePurchaseQuantity', () => {
  describe('valid multiples', () => {
    it('accepts quantity=5 with unit=5', () => {
      const result = validatePurchaseQuantity(5, 5);
      expect(result).toEqual({ ok: true, unit: 5 });
    });

    it('accepts quantity=10 with unit=5', () => {
      const result = validatePurchaseQuantity(10, 5);
      expect(result).toEqual({ ok: true, unit: 5 });
    });

    it('accepts quantity=15 with unit=5', () => {
      const result = validatePurchaseQuantity(15, 5);
      expect(result).toEqual({ ok: true, unit: 5 });
    });

    it('accepts quantity=3 with unit=3', () => {
      const result = validatePurchaseQuantity(3, 3);
      expect(result).toEqual({ ok: true, unit: 3 });
    });

    it('accepts quantity=100 with unit=10', () => {
      const result = validatePurchaseQuantity(100, 10);
      expect(result).toEqual({ ok: true, unit: 10 });
    });
  });

  describe('non-multiple rejection', () => {
    it('rejects quantity=7 with unit=5', () => {
      const result = validatePurchaseQuantity(7, 5);
      expect(result.ok).toBe(false);
      expect(result.message).toBe('購買數量需為 5 的倍數');
      expect(result.unit).toBe(5);
    });

    it('rejects quantity=6 with unit=5', () => {
      const result = validatePurchaseQuantity(6, 5);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('5 的倍數');
    });

    it('rejects quantity=4 with unit=3', () => {
      const result = validatePurchaseQuantity(4, 3);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('3 的倍數');
    });

    it('rejects quantity=1 with unit=5', () => {
      const result = validatePurchaseQuantity(1, 5);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('5 的倍數');
    });
  });

  describe('zero quantity', () => {
    it('rejects quantity=0', () => {
      const result = validatePurchaseQuantity(0, 5);
      expect(result.ok).toBe(false);
      expect(result.message).toBe('購買數量必須為正整數');
    });
  });

  describe('negative quantity', () => {
    it('rejects quantity=-1', () => {
      const result = validatePurchaseQuantity(-1, 5);
      expect(result.ok).toBe(false);
      expect(result.message).toBe('購買數量必須為正整數');
    });

    it('rejects quantity=-5 (even though it would be a "multiple")', () => {
      const result = validatePurchaseQuantity(-5, 5);
      expect(result.ok).toBe(false);
      expect(result.message).toBe('購買數量必須為正整數');
    });
  });

  describe('NaN quantity', () => {
    it('rejects NaN quantity', () => {
      const result = validatePurchaseQuantity(NaN, 5);
      expect(result.ok).toBe(false);
      expect(result.message).toBe('購買數量必須為正整數');
    });

    it('rejects Infinity quantity', () => {
      const result = validatePurchaseQuantity(Infinity, 5);
      expect(result.ok).toBe(false);
      expect(result.message).toBe('購買數量必須為正整數');
    });

    it('rejects non-integer float quantity', () => {
      const result = validatePurchaseQuantity(5.5, 5);
      expect(result.ok).toBe(false);
      expect(result.message).toBe('購買數量必須為正整數');
    });
  });

  describe('unit NaN/0/negative fallback to 5', () => {
    it('unit=NaN falls back to 5: qty=5 ok, qty=7 rejected', () => {
      expect(validatePurchaseQuantity(5, NaN)).toEqual({ ok: true, unit: 5 });

      const bad = validatePurchaseQuantity(7, NaN);
      expect(bad.ok).toBe(false);
      expect(bad.message).toContain('5 的倍數');
      expect(bad.unit).toBe(5);
    });

    it('unit=0 falls back to 5: qty=5 ok, qty=7 rejected', () => {
      expect(validatePurchaseQuantity(5, 0)).toEqual({ ok: true, unit: 5 });

      const bad = validatePurchaseQuantity(7, 0);
      expect(bad.ok).toBe(false);
      expect(bad.message).toContain('5 的倍數');
      expect(bad.unit).toBe(5);
    });

    it('unit=-3 falls back to 5: qty=5 ok, qty=7 rejected', () => {
      expect(validatePurchaseQuantity(5, -3)).toEqual({ ok: true, unit: 5 });

      const bad = validatePurchaseQuantity(7, -3);
      expect(bad.ok).toBe(false);
      expect(bad.message).toContain('5 的倍數');
      expect(bad.unit).toBe(5);
    });

    it('unit=Infinity falls back to 5', () => {
      expect(validatePurchaseQuantity(5, Infinity)).toEqual({ ok: true, unit: 5 });
    });

    it('unit=2.5 (non-integer) falls back to 5', () => {
      expect(validatePurchaseQuantity(5, 2.5)).toEqual({ ok: true, unit: 5 });
    });
  });
});
