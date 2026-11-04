import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDatabase, disconnectDatabase } from './db.js';
import type { AuthUser } from './http.js';
import { decideApproval, requestApproval, reversalApprovalPayload, type ReversalInput, type ReversalKind } from './services/approval-service.js';
import {
  AdvanceAllocation, AdvanceRepayment, BuyerCompany, BuyerLedgerEntry, CashBankTransaction, CashierShift, CompanyInvoice, CompanySettlement, DispatchBatch, Purchase,
  Supplier, SupplierAdvance, SupplierLedgerEntry, SupplierPayment, User,
} from './models.js';
import {
  closeCashierShift, createCashBankAccount, createCompanyInvoice, issueSupplierAdvance, listCashBankAccountsWithBalances,
  openCashierShift, postCompanySettlement, postSupplierPayment, recordAdvanceRepayment, reverseCompanySettlement,
  reverseAdvanceAllocation, reverseAdvanceRepayment, reverseSupplierAdvance, reverseSupplierPayment,
} from './services/financial-service.js';

const enabled = process.env.RUN_FINANCIAL_INTEGRATION === 'true';

describe.runIf(enabled)('Phase A transactional financial flows', () => {
  const marker = randomUUID().slice(0, 8);
  let actor: AuthUser;
  let checker: AuthUser;
  let supplierId: string;
  let accountId: string;
  let shiftId: string;
  let purchaseId: string;

  beforeAll(async () => {
    await connectDatabase();
    const user = await User.create({ name: `Finance Test ${marker}`, email: `finance-${marker}@test.local`, passwordHash: 'not-used-by-service-tests', role: 'ADMIN', active: true });
    actor = { id: String(user._id), name: user.name, role: 'ADMIN' };
    const checkerUser = await User.create({ name: `Finance Checker ${marker}`, email: `finance-checker-${marker}@test.local`, passwordHash: 'not-used-by-service-tests', role: 'ACCOUNTANT', active: true });
    checker = { id: String(checkerUser._id), name: checkerUser.name, role: 'ACCOUNTANT' };
    const supplier = await Supplier.create({ code: `T-${marker}`, name: `Test Supplier ${marker}`, active: true });
    supplierId = String(supplier._id);
    const account = await createCashBankAccount({ idempotencyKey: randomUUID(), code: `TC-${marker}`, name: `Test Cash ${marker}`, type: 'CASH', openingBalanceCents: 500_000 }, actor);
    accountId = String(account._id);
    const shift = await openCashierShift({ idempotencyKey: randomUUID(), accountId, locationId: `TEST-${marker}`, openedAt: new Date(), openingFloatCents: 500_000 }, actor);
    shiftId = String(shift._id);
    const purchase = await Purchase.create({
      billNumber: `TB-${marker}`, idempotencyKey: randomUUID(), locationId: `TEST-${marker}`, sequence: 1, supplierId, eventAt: new Date(), densityReading: 100,
      densityVersion: 1, factorMilli: 300, litresMilli: 10_000, kgMilli: 3_000, rateCentsPerKg: 33_333, rateSourceId: user._id,
      subtotalCents: 100_000, adjustmentCents: 0, totalCents: 100_000, cashPaidCents: 0, advanceAppliedCents: 0,
      outstandingCents: 100_000, paymentStatus: 'UNPAID', dispatchStatus: 'PENDING', operatorId: user._id,
    });
    purchaseId = String(purchase._id);
    await SupplierLedgerEntry.create({ supplierId, eventAt: purchase.eventAt, type: 'PURCHASE_OBLIGATION', payableDeltaCents: 100_000, advanceDeltaCents: 0, referenceType: 'Purchase', referenceId: purchase._id, createdBy: user._id });
  });

  afterAll(async () => { if (enabled) await disconnectDatabase(); });

  async function approvedReversal(kind: ReversalKind, targetId: string, input: Omit<ReversalInput, 'approvalId'>, model: any): Promise<ReversalInput> {
    const source = await model.findById(targetId).lean();
    const approval = await requestApproval({ idempotencyKey: randomUUID(), operation: 'REVERSAL', targetId, payload: reversalApprovalPayload(kind, targetId, input, source.updatedAt), requestReason: input.reason }, actor);
    await decideApproval(String(approval._id), { approve: true, reason: 'Independent reversal check' }, checker);
    return { ...input, approvalId: String(approval._id) };
  }

  it('posts idempotent allocated supplier payments and reverses with compensation', async () => {
    const idempotencyKey = randomUUID();
    const input = { idempotencyKey, supplierId, amountCents: 100_000, paymentMethod: 'CASH' as const, accountId, eventAt: new Date(), approvedBy: actor.id, allocations: [{ purchaseId, amountCents: 100_000 }] };
    const first = await postSupplierPayment(input, actor);
    const duplicate = await postSupplierPayment(input, actor);
    expect(String(duplicate._id)).toBe(String(first._id));
    expect(await SupplierPayment.countDocuments({ idempotencyKey })).toBe(1);
    expect((await Purchase.findById(purchaseId).lean())?.outstandingCents).toBe(0);
    expect((await Purchase.findById(purchaseId).lean())?.totalCents).toBe(100_000);
    await reverseSupplierPayment(String(first._id), await approvedReversal('SUPPLIER_PAYMENT', String(first._id), { idempotencyKey: randomUUID(), reason: 'Integration correction', eventAt: new Date() }, SupplierPayment), actor);
    expect((await Purchase.findById(purchaseId).lean())?.outstandingCents).toBe(100_000);
    expect(await CashBankTransaction.countDocuments({ referenceType: 'SupplierPayment', referenceId: first._id })).toBe(2);
  });

  it('tracks advances and repayments without changing procurement cost', async () => {
    const advance = await issueSupplierAdvance({ idempotencyKey: randomUUID(), supplierId, issuedCents: 50_000, issuedAt: new Date(), paymentMethod: 'CASH', accountId, approvedBy: actor.id }, actor);
    await recordAdvanceRepayment({ idempotencyKey: randomUUID(), advanceId: String(advance._id), amountCents: 20_000, accountId, paymentMethod: 'CASH', eventAt: new Date() }, actor);
    const stored = await SupplierAdvance.findById(advance._id).lean();
    expect(stored?.issuedCents - stored?.allocatedCents - stored?.repaidCents).toBe(30_000);
    expect((await Purchase.findById(purchaseId).lean())?.totalCents).toBe(100_000);
  });

  it('reverses advance recovery and issuance without rewriting either original', async () => {
    const advance = await issueSupplierAdvance({ idempotencyKey: randomUUID(), supplierId, issuedCents: 30_000, issuedAt: new Date(), paymentMethod: 'CASH', accountId, approvedBy: actor.id }, actor);
    await SupplierAdvance.updateOne({ _id: advance._id }, { $set: { allocatedCents: 30_000 } });
    await Purchase.updateOne({ _id: purchaseId }, { $set: { outstandingCents: 70_000, advanceAppliedCents: 30_000, paymentStatus: 'PARTIALLY_PAID' } });
    const allocation = await AdvanceAllocation.create({ advanceId: advance._id, purchaseId, amountCents: 30_000, allocatedBy: actor.id });
    await SupplierLedgerEntry.create({ supplierId, eventAt: new Date(), type: 'ADVANCE_ALLOCATED', payableDeltaCents: -30_000, advanceDeltaCents: -30_000, referenceType: 'Purchase', referenceId: purchaseId, createdBy: actor.id });
    await reverseAdvanceAllocation(String(allocation._id), await approvedReversal('ADVANCE_ALLOCATION', String(allocation._id), { idempotencyKey: randomUUID(), reason: 'Integration allocation correction', eventAt: new Date() }, AdvanceAllocation), actor);
    expect((await Purchase.findById(purchaseId).lean())?.outstandingCents).toBe(100_000);
    expect((await SupplierAdvance.findById(advance._id).lean())?.allocatedCents).toBe(0);
    const reversed = await reverseSupplierAdvance(String(advance._id), await approvedReversal('SUPPLIER_ADVANCE', String(advance._id), { idempotencyKey: randomUUID(), reason: 'Integration advance correction', eventAt: new Date() }, SupplierAdvance), actor);
    expect(reversed.status).toBe('REVERSED');
    expect(await AdvanceAllocation.countDocuments({ _id: allocation._id, reversedAt: { $exists: true } })).toBe(1);
  });

  it('reverses a cash repayment with a compensating supplier and cash entry', async () => {
    const advance = await issueSupplierAdvance({ idempotencyKey: randomUUID(), supplierId, issuedCents: 10_000, issuedAt: new Date(), paymentMethod: 'CASH', accountId, approvedBy: actor.id }, actor);
    const repayment = await recordAdvanceRepayment({ idempotencyKey: randomUUID(), advanceId: String(advance._id), amountCents: 4_000, accountId, paymentMethod: 'CASH', eventAt: new Date() }, actor);
    await reverseAdvanceRepayment(String(repayment._id), await approvedReversal('ADVANCE_REPAYMENT', String(repayment._id), { idempotencyKey: randomUUID(), reason: 'Integration repayment correction', eventAt: new Date() }, AdvanceRepayment), actor);
    expect((await AdvanceRepayment.findById(repayment._id).lean())?.status).toBe('REVERSED');
    expect((await SupplierAdvance.findById(advance._id).lean())?.repaidCents).toBe(0);
    await reverseSupplierAdvance(String(advance._id), await approvedReversal('SUPPLIER_ADVANCE', String(advance._id), { idempotencyKey: randomUUID(), reason: 'Integration advance correction', eventAt: new Date() }, SupplierAdvance), actor);
  });

  it('posts and reverses company settlements while preserving invoice revenue', async () => {
    const buyer = await BuyerCompany.create({ name: `Test Buyer ${marker}`, active: true });
    const dispatch = await DispatchBatch.create({ dispatchNumber: `TD-${marker}`, idempotencyKey: randomUUID(), locationId: `TEST-${marker}`, status: 'RECONCILED', buyerId: buyer._id, vehicleNumber: 'TEST-1', firstSequence: 1, lastSequence: 1, purchaseCount: 1, totalLitresMilli: 10_000, acquiredKgMilli: 3_000, purchaseCostCents: 100_000, acceptedKgMilli: 3_000, sellingRateCentsPerKg: 40_000, revenueCents: 120_000, directExpenseCents: 0, grossProfitCents: 20_000, netProfitCents: 20_000, dispatchedAt: new Date(), confirmedBy: actor.id, confirmedAt: new Date(), reconciledAt: new Date(), reconciledBy: actor.id });
    const invoice = await createCompanyInvoice({ idempotencyKey: randomUUID(), dispatchId: String(dispatch._id), issuedAt: new Date() }, actor);
    const receipt = await postCompanySettlement({ idempotencyKey: randomUUID(), invoiceId: String(invoice._id), amountCents: 70_000, accountId, paymentMethod: 'CASH', eventAt: new Date() }, actor);
    expect((await CompanyInvoice.findById(invoice._id).lean())?.outstandingCents).toBe(50_000);
    await reverseCompanySettlement(String(receipt._id), await approvedReversal('COMPANY_SETTLEMENT', String(receipt._id), { idempotencyKey: randomUUID(), reason: 'Integration correction', eventAt: new Date() }, CompanySettlement), actor);
    const restored = await CompanyInvoice.findById(invoice._id).lean();
    expect(restored?.outstandingCents).toBe(120_000);
    expect(restored?.totalCents).toBe(120_000);
    expect((await BuyerLedgerEntry.aggregate([{ $match: { buyerId: buyer._id } }, { $group: { _id: null, balance: { $sum: '$receivableDeltaCents' } } }]))[0].balance).toBe(120_000);
  });

  it('reconciles the shift from immutable signed movements', async () => {
    const closed = await closeCashierShift(shiftId, { idempotencyKey: randomUUID(), countedCashCents: 470_000, closedAt: new Date() }, actor);
    expect(closed.expectedCashCents).toBe(470_000);
    expect(closed.varianceCents).toBe(0);
    expect((await CashierShift.findById(shiftId).lean())?.status).toBe('CLOSED');
    const account = (await listCashBankAccountsWithBalances()).find((item) => String(item._id) === accountId);
    expect(account?.balanceCents).toBe(470_000);
  });
});
