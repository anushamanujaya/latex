import { cents, type MoneyCents } from './money.js';

export function calculateDispatchProfit(args: {
  purchaseCostCents: number;
  acceptedKgMilli: number;
  sellingRateCentsPerKg: number;
  expenseCents: number;
  adjustmentCents?: number;
}): { revenueCents: MoneyCents; grossProfitCents: MoneyCents; netProfitCents: MoneyCents } {
  const revenue = Math.floor((args.acceptedKgMilli * args.sellingRateCentsPerKg + 500) / 1000);
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
  const quantityVarianceBasisPoints = Math.round(quantityVarianceMilli * 10_000 / args.acquiredKgMilli);
  const profitMarginBasisPoints = profit.revenueCents === 0 ? 0 : Math.round(profit.netProfitCents * 10_000 / profit.revenueCents);
  const costPerAcquiredKgCents = Math.round(args.purchaseCostCents * 1000 / args.acquiredKgMilli);
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
