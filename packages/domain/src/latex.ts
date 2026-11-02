import { cents, type MoneyCents } from './money.js';

export const DEFAULT_DENSITY_FACTORS = {
  50: 200,
  60: 220,
  70: 240,
  80: 260,
  90: 280,
  100: 300,
  110: 320,
  120: 340,
  130: 360,
  140: 380,
  150: 400,
} as const;

export type DensityReading = keyof typeof DEFAULT_DENSITY_FACTORS;

export interface PurchaseCalculation {
  litresMilli: number;
  factorMilli: number;
  kgMilli: number;
  rateCentsPerKg: MoneyCents;
  subtotalCents: MoneyCents;
  adjustmentCents: MoneyCents;
  totalCents: MoneyCents;
}

export type PaymentStatus = 'PAID' | 'UNPAID' | 'PARTIALLY_PAID';

export function calculateSettlement(totalCents: number, cashPaidCents: number, advanceAppliedCents: number): {
  outstandingCents: MoneyCents;
  paymentStatus: PaymentStatus;
} {
  for (const [label, value] of Object.entries({ totalCents, cashPaidCents, advanceAppliedCents })) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`);
  }
  if (cashPaidCents + advanceAppliedCents > totalCents) throw new Error('Settlements cannot exceed purchase total');
  const outstanding = totalCents - cashPaidCents - advanceAppliedCents;
  return {
    outstandingCents: cents(outstanding),
    paymentStatus: outstanding === 0 ? 'PAID' : outstanding === totalCents ? 'UNPAID' : 'PARTIALLY_PAID',
  };
}

function divideHalfUp(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator)) throw new Error('Calculation exceeds safe integer range');
  const sign = Math.sign(numerator) || 1;
  return sign * Math.floor((Math.abs(numerator) + denominator / 2) / denominator);
}

export function calculatePurchase(args: {
  litresMilli: number;
  factorMilli: number;
  rateCentsPerKg: number;
  adjustmentCents?: number;
}): PurchaseCalculation {
  const { litresMilli, factorMilli, rateCentsPerKg, adjustmentCents = 0 } = args;
  for (const [label, value] of Object.entries(args)) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new Error(`${label} must be a non-negative safe integer`);
  }
  const kgMilli = divideHalfUp(litresMilli * factorMilli, 1000);
  const subtotal = divideHalfUp(kgMilli * rateCentsPerKg, 1000);
  const total = subtotal + adjustmentCents;
  if (total < 0) throw new Error('Adjustment cannot make a purchase total negative');
  return {
    litresMilli,
    factorMilli,
    kgMilli,
    rateCentsPerKg: cents(rateCentsPerKg),
    subtotalCents: cents(subtotal),
    adjustmentCents: cents(adjustmentCents),
    totalCents: cents(total),
  };
}

export function factorForReading(reading: number, table: Readonly<Record<number, number>> = DEFAULT_DENSITY_FACTORS): number {
  const factor = table[reading];
  if (factor === undefined) throw new Error(`Unsupported density reading: ${reading}`);
  return factor;
}
