/**
 * card-purchase.ts
 *
 * Pure validation helper for card purchase quantity.
 * Single source of truth for the "quantity must be a positive multiple of unit" rule,
 * used by both the server action (createCardOrder) and the UI (my_cards page).
 */

/**
 * Sanitize a purchase unit value: if it is not a positive finite integer,
 * fall back to 5 (the system default).
 */
export function sanitizePurchaseUnit(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0 || !Number.isInteger(raw)) {
    return 5;
  }
  return raw;
}

/**
 * Validate that `quantity` is a positive integer and a multiple of `unit`.
 *
 * `unit` is sanitized first: NaN, 0, negative, or non-integer values
 * fall back to 5 (system default).
 *
 * @param quantity - number of cards the user wants to buy
 * @param unit     - raw purchase unit from config (may be NaN/0/negative)
 * @returns `{ ok: true, unit }` on success, or `{ ok: false, message, unit }` on failure.
 *          `unit` in the return is the sanitized value actually used.
 */
export function validatePurchaseQuantity(
  quantity: number,
  unit: number,
): { ok: boolean; message?: string; unit: number } {
  const safeUnit = sanitizePurchaseUnit(unit);

  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
    return { ok: false, message: '購買數量必須為正整數', unit: safeUnit };
  }

  if (quantity % safeUnit !== 0) {
    return { ok: false, message: `購買數量需為 ${safeUnit} 的倍數`, unit: safeUnit };
  }

  return { ok: true, unit: safeUnit };
}
