import { describe, expect, it } from 'vitest';
import { calculatePurchase, calculateSettlement, DEFAULT_DENSITY_FACTORS, factorForReading } from './latex.js';
import { assertContiguousDispatchBoundary, calculateDispatchProfit } from './dispatch.js';

describe('latex business arithmetic', () => {
  it('calculates the canonical purchase without floating point money', () => {
    expect(calculatePurchase({ litresMilli: 10_000, factorMilli: 400, rateCentsPerKg: 82_000 })).toMatchObject({
      kgMilli: 4_000, subtotalCents: 328_000, totalCents: 328_000,
    });
  });

  it('preserves every supplied density lookup', () => {
    expect(DEFAULT_DENSITY_FACTORS).toEqual({ 50: 200, 60: 220, 70: 240, 80: 260, 90: 280, 100: 300, 110: 320, 120: 340, 130: 360, 140: 380, 150: 400 });
  });

  it('rejects interpolation and unsupported readings', () => expect(() => factorForReading(55)).toThrow('Unsupported'));

  it('calculates finalized batch profit', () => {
    expect(calculateDispatchProfit({ purchaseCostCents: 82_000_000, acceptedKgMilli: 1_000_000, sellingRateCentsPerKg: 90_000, expenseCents: 500_000 })).toEqual({
      revenueCents: 90_000_000, grossProfitCents: 8_000_000, netProfitCents: 7_500_000,
    });
  });

  it('applies a prior advance without changing procurement cost', () => {
    const purchase = calculatePurchase({ litresMilli: 10_000, factorMilli: 400, rateCentsPerKg: 82_000 });
    const settlement = calculateSettlement(purchase.totalCents, 228_000, 100_000);
    expect(purchase.totalCents).toBe(328_000);
    expect(settlement).toEqual({ outstandingCents: 0, paymentStatus: 'PAID' });
  });

  it('keeps unpaid and partially paid obligations explicit', () => {
    expect(calculateSettlement(328_000, 0, 0)).toEqual({ outstandingCents: 328_000, paymentStatus: 'UNPAID' });
    expect(calculateSettlement(328_000, 100_000, 0)).toEqual({ outstandingCents: 228_000, paymentStatus: 'PARTIALLY_PAID' });
  });

  it('accepts only an exact inclusive dispatch boundary', () => {
    expect(() => assertContiguousDispatchBoundary([101, 102, 103], 100, 103)).not.toThrow();
    expect(() => assertContiguousDispatchBoundary([101, 103], 100, 103)).toThrow('gap');
    expect(() => assertContiguousDispatchBoundary([101, 102, 102], 100, 103)).toThrow('unique and contiguous');
  });
});
