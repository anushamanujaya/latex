import { cents, type MoneyCents } from './money.js';

function roundedRatio(numerator: number, multiplier: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(multiplier) || !Number.isSafeInteger(denominator) || denominator <= 0) throw new Error('Ratio inputs must be safe integers with a positive denominator');
  const scaled = BigInt(numerator) * BigInt(multiplier);
  const magnitude = (scaled < 0n ? -scaled : scaled) + BigInt(denominator) / 2n;
  const result = Number(magnitude / BigInt(denominator) * (scaled < 0n ? -1n : 1n));
  if (!Number.isSafeInteger(result)) throw new Error('Ratio exceeds safe integer range');
  return result;
}

export function calculateDispatchProfit(args: {
  purchaseCostCents: number;
  acceptedKgMilli: number;
  sellingRateCentsPerKg: number;
  expenseCents: number;
  adjustmentCents?: number;
}): { revenueCents: MoneyCents; grossProfitCents: MoneyCents; netProfitCents: MoneyCents } {
  for (const [label, value] of Object.entries(args)) {
    if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`);
  }
  if (args.purchaseCostCents < 0 || args.acceptedKgMilli < 0 || args.sellingRateCentsPerKg < 0 || args.expenseCents < 0) throw new Error('Dispatch amounts cannot be negative');
  const revenue = Number((BigInt(args.acceptedKgMilli) * BigInt(args.sellingRateCentsPerKg) + 500n) / 1000n);
  const gross = revenue - args.purchaseCostCents;
  const net = gross - args.expenseCents + (args.adjustmentCents ?? 0);
  return { revenueCents: cents(revenue), grossProfitCents: cents(gross), netProfitCents: cents(net) };
}

export function calculateDispatchMetrics(args: {
  acquiredKgMilli: number; acceptedKgMilli: number; purchaseCostCents: number; sellingRateCentsPerKg: number;
  directExpenseCents: number; adjustmentCents?: number;
}) {
  if (args.acquiredKgMilli <= 0) throw new Error('Acquired KG must be positive');
  if (args.acceptedKgMilli < 0 || args.purchaseCostCents < 0 || args.sellingRateCentsPerKg < 0 || args.directExpenseCents < 0) throw new Error('Dispatch values cannot be negative');
  const profit = calculateDispatchProfit({ purchaseCostCents: args.purchaseCostCents, acceptedKgMilli: args.acceptedKgMilli, sellingRateCentsPerKg: args.sellingRateCentsPerKg, expenseCents: args.directExpenseCents, adjustmentCents: args.adjustmentCents ?? 0 });
  const quantityVarianceMilli = args.acceptedKgMilli - args.acquiredKgMilli;
  const quantityVarianceBasisPoints = roundedRatio(quantityVarianceMilli, 10_000, args.acquiredKgMilli);
  const profitMarginBasisPoints = profit.revenueCents === 0 ? 0 : roundedRatio(profit.netProfitCents, 10_000, profit.revenueCents);
  const costPerAcquiredKgCents = roundedRatio(args.purchaseCostCents, 1000, args.acquiredKgMilli);
  return { ...profit, quantityVarianceMilli, quantityVarianceBasisPoints, profitMarginBasisPoints, costPerAcquiredKgCents };
}

export function assertContiguousDispatchBoundary(sequences: readonly number[], previousLastSequence: number, lastSequence: number): void {
  const firstSequence = previousLastSequence + 1;
  if (lastSequence < firstSequence) throw new Error('Boundary must follow the previous dispatch');
  if (sequences.length !== lastSequence - firstSequence + 1) throw new Error('Dispatch boundary contains a gap');
  sequences.forEach((sequence, index) => {
    if (sequence !== firstSequence + index) throw new Error('Dispatch sequences must be unique and contiguous');
  });
}
