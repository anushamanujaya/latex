import { api } from './api';

export type ReversalKind = 'SUPPLIER_PAYMENT' | 'ADVANCE_REPAYMENT' | 'SUPPLIER_ADVANCE' | 'ADVANCE_ALLOCATION' | 'COMPANY_SETTLEMENT' | 'EXPENSE' | 'CASH_TRANSFER' | 'DISPATCH_ADJUSTMENT';

export function requestReversal(kind: ReversalKind, targetId: string, reason: string) {
  if (reason.trim().length < 5) throw new Error('Provide a reversal reason of at least five characters');
  return api('/reversal-requests', {
    method: 'POST',
    body: JSON.stringify({
      requestIdempotencyKey: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      kind,
      targetId,
      eventAt: new Date().toISOString(),
      reason: reason.trim(),
    }),
  });
}
