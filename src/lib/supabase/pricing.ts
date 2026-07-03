import type { UserRole, PricingMode } from '@/types/database';
export type EnrollModeType = 'full' | 'single';
export type PriceResult =
  | { kind: 'card'; cards: number }
  | { kind: 'ntd'; amount: number }
  | { kind: 'free' };
export interface PricingInputs {
  pricing_mode: PricingMode; cards_per_session: number;
  price_member_single: number | null; price_guest_single: number | null;
  price_member_full: number | null; price_guest_full: number | null;
  sessionCount: number;
}
export function isMemberActive(
  args: { role: UserRole; member_valid_until: string | null; groupValidUntil: string | null },
  taipeiToday: string
): boolean {
  if (args.role === 'guest') return false;
  const until = args.groupValidUntil ?? args.member_valid_until;
  if (!until) return false;           // member role but no expiry → treat inactive (must have a group)
  return until >= taipeiToday;        // string compare works for YYYY-MM-DD
}
export function resolvePrice(i: PricingInputs, isMember: boolean, mode: EnrollModeType): PriceResult {
  if (i.pricing_mode === 'free') return { kind: 'free' };
  if (i.pricing_mode === 'card') {
    const cards = mode === 'full' ? i.cards_per_session * i.sessionCount : i.cards_per_session;
    return cards <= 0 ? { kind: 'free' } : { kind: 'card', cards };
  }
  const price = mode === 'single'
    ? (isMember ? i.price_member_single : i.price_guest_single)
    : (isMember ? i.price_member_full : i.price_guest_full);
  if (price == null) throw new Error('NTD price not set for this identity/mode');
  return price <= 0 ? { kind: 'free' } : { kind: 'ntd', amount: price };
}
