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

export function assertContiguousDispatchBoundary(sequences: readonly number[], previousLastSequence: number, lastSequence: number): void {
  const firstSequence = previousLastSequence + 1;
  if (lastSequence < firstSequence) throw new Error('Boundary must follow the previous dispatch');
  if (sequences.length !== lastSequence - firstSequence + 1) throw new Error('Dispatch boundary contains a gap');
  sequences.forEach((sequence, index) => {
    if (sequence !== firstSequence + index) throw new Error('Dispatch sequences must be unique and contiguous');
  });
}
