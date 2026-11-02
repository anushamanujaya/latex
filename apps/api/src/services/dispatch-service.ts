import mongoose, { type ClientSession } from 'mongoose';
import { assertContiguousDispatchBoundary, calculateDispatchMetrics } from '@latex/domain';
import { AppError, type AuthUser } from '../http.js';
import { AuditLog, BuyerLedgerEntry, CompanyInvoice, CompanyInvoiceAdjustment, Counter, DispatchBatch, DispatchFinancialAdjustment, DispatchReconciliation, Expense, Purchase } from '../models.js';

async function nextCounter(key: string, session: ClientSession) {
  const counter = await Counter.findOneAndUpdate({ key }, { $inc: { value: 1 } }, { upsert: true, returnDocument: 'after', session });
  if (!counter) throw new AppError(500, 'COUNTER_ERROR', `Could not allocate ${key} sequence`);
  return counter.value as number;
}

export async function previewDispatch(locationId: string, lastSequence: number, session?: ClientSession) {
  const previousQuery = DispatchBatch.findOne({ locationId, status: { $in: ['CONFIRMED', 'RECONCILED', 'FINALIZED'] } }).sort({ lastSequence: -1 }).lean();
  if (session) previousQuery.session(session);
  const previous = await previousQuery;
  const firstSequence = (previous?.lastSequence ?? 0) + 1;
  if (lastSequence < firstSequence) throw new AppError(422, 'INVALID_BOUNDARY', 'Boundary must follow the last confirmed dispatch');
  const allQuery = Purchase.find({ locationId, sequence: { $gte: firstSequence, $lte: lastSequence } }).sort({ sequence: 1 }).populate('supplierId', 'code name').lean();
  if (session) allQuery.session(session);
  const all = await allQuery;
  const present = new Set(all.map((purchase) => purchase.sequence));
  for (let sequence = firstSequence; sequence <= lastSequence; sequence += 1) if (!present.has(sequence)) throw new AppError(409, 'BOUNDARY_GAP', `Purchase sequence ${sequence} is missing`);
  if (all.some((purchase) => purchase.dispatchStatus === 'ASSIGNED' && !purchase.reversedAt)) throw new AppError(409, 'BOUNDARY_OVERLAP', 'Boundary contains a purchase assigned to another dispatch');
  const purchases = all.filter((purchase) => !purchase.reversedAt);
  if (!purchases.length) throw new AppError(409, 'EMPTY_BOUNDARY', 'Boundary has no eligible purchases');
  if (purchases.length === all.length) {
    try { assertContiguousDispatchBoundary(purchases.map((purchase) => purchase.sequence), firstSequence - 1, lastSequence); }
    catch { throw new AppError(409, 'BOUNDARY_GAP', 'Boundary contains non-contiguous purchase sequences'); }
  }
  return { firstSequence, lastSequence, purchases, voidedPurchases: all.filter((purchase) => purchase.reversedAt), totals: purchases.reduce((a, p) => ({ litresMilli: a.litresMilli + p.litresMilli, kgMilli: a.kgMilli + p.kgMilli, purchaseCostCents: a.purchaseCostCents + p.totalCents }), { litresMilli: 0, kgMilli: 0, purchaseCostCents: 0 }) };
}

type DraftInput = { idempotencyKey: string; locationId: string; lastSequence: number; buyerId: string; vehicleNumber: string; dispatchedAt: Date; notes?: string | undefined };

export async function createDispatchDraft(input: DraftInput, actor: AuthUser) {
  const existing = await DispatchBatch.findOne({ idempotencyKey: input.idempotencyKey });
  if (existing) return existing;
  const preview = await previewDispatch(input.locationId, input.lastSequence);
  const session = await mongoose.startSession();
  try {
    let draft: any;
    await session.withTransaction(async () => {
      const sequence = await nextCounter('dispatch', session);
      [draft] = await DispatchBatch.create([{ dispatchNumber: `DSP-${String(sequence).padStart(5, '0')}`, ...input, status: 'DRAFT', firstSequence: preview.firstSequence, purchaseCount: preview.purchases.length, totalLitresMilli: preview.totals.litresMilli, acquiredKgMilli: preview.totals.kgMilli, purchaseCostCents: preview.totals.purchaseCostCents, directExpenseCents: 0, adjustmentCents: 0 }], { session });
      await AuditLog.create([{ actorId: actor.id, action: 'DISPATCH_DRAFT_CREATED', entityType: 'DispatchBatch', entityId: draft._id, reason: input.notes ?? 'Boundary draft', after: { firstSequence: draft.firstSequence, lastSequence: draft.lastSequence, purchaseCount: draft.purchaseCount } }], { session });
    });
    return draft;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) { const duplicate = await DispatchBatch.findOne({ idempotencyKey: input.idempotencyKey }); if (duplicate) return duplicate; }
    throw error;
  } finally { await session.endSession(); }
}

export async function confirmDispatchDraft(dispatchId: string, idempotencyKey: string, actor: AuthUser) {
  const repeated = await DispatchBatch.findOne({ confirmationIdempotencyKey: idempotencyKey });
  if (repeated) return repeated;
  const session = await mongoose.startSession();
  try {
    let output: any;
    await session.withTransaction(async () => {
      const draft = await DispatchBatch.findOne({ _id: dispatchId, status: 'DRAFT' }).session(session);
      if (!draft) throw new AppError(404, 'DRAFT_DISPATCH_NOT_FOUND', 'Draft dispatch not found');
      const preview = await previewDispatch(draft.locationId, draft.lastSequence, session);
      if (preview.firstSequence !== draft.firstSequence || preview.purchases.length !== draft.purchaseCount || preview.totals.purchaseCostCents !== draft.purchaseCostCents) throw new AppError(409, 'DRAFT_STALE', 'Purchases changed after the draft; create a new preview');
      const claimed = await Purchase.updateMany({ _id: { $in: preview.purchases.map((p) => p._id) }, dispatchStatus: 'PENDING', reversedAt: { $exists: false } }, { $set: { dispatchStatus: 'ASSIGNED', dispatchId: draft._id } }, { session });
      if (claimed.modifiedCount !== preview.purchases.length) throw new AppError(409, 'DISPATCH_CONFLICT', 'Another operator changed this boundary; preview again');
      output = await DispatchBatch.findOneAndUpdate({ _id: draft._id, status: 'DRAFT' }, { $set: { status: 'CONFIRMED', confirmationIdempotencyKey: idempotencyKey, confirmedBy: actor.id, confirmedAt: new Date() } }, { returnDocument: 'after', session });
      if (!output) throw new AppError(409, 'DISPATCH_CONFIRM_CONFLICT', 'Draft was already changed');
      await AuditLog.create([{ actorId: actor.id, action: 'DISPATCH_CONFIRMED', entityType: 'DispatchBatch', entityId: draft._id, reason: 'Exact purchase boundary confirmed and locked', before: { status: 'DRAFT' }, after: { status: 'CONFIRMED', firstSequence: draft.firstSequence, lastSequence: draft.lastSequence, purchaseCount: draft.purchaseCount } }], { session });
    });
    return output;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) { const duplicate = await DispatchBatch.findOne({ confirmationIdempotencyKey: idempotencyKey }); if (duplicate) return duplicate; }
    throw error;
  } finally { await session.endSession(); }
}

export async function confirmDispatch(input: DraftInput & { acceptedKgMilli?: number | undefined; sellingRateCentsPerKg?: number | undefined; directExpenseCents: number }, actor: AuthUser) {
  const existing = await DispatchBatch.findOne({ idempotencyKey: input.idempotencyKey });
  if (existing) return existing;
  const draft = await createDispatchDraft(input, actor);
  return confirmDispatchDraft(String(draft._id), `${input.idempotencyKey}:confirm`, actor);
}

export async function reconcileDispatch(input: { idempotencyKey: string; dispatchId: string; eventAt: Date; acceptedKgMilli: number; sellingRateCentsPerKg: number; weighbridgeReference: string; weighbridgeDocumentName?: string | undefined; weighbridgeDocumentUrl?: string | undefined; discrepancyReason?: string | undefined; notes?: string | undefined; approvedBy: string }, actor: AuthUser) {
  if (await DispatchReconciliation.exists({ idempotencyKey: input.idempotencyKey })) return DispatchBatch.findById(input.dispatchId);
  const session = await mongoose.startSession();
  try {
    let output: any;
    await session.withTransaction(async () => {
      const dispatch = await DispatchBatch.findOne({ _id: input.dispatchId, status: { $in: ['CONFIRMED', 'RECONCILED', 'FINALIZED'] } }).session(session);
      if (!dispatch) throw new AppError(404, 'DISPATCH_NOT_RECONCILABLE', 'Confirmed dispatch not found');
      const [expenses, adjustments] = await Promise.all([
        Expense.aggregate([{ $match: { dispatchId: dispatch._id, allocationType: 'DIRECT_DISPATCH', status: 'POSTED' } }, { $group: { _id: null, cents: { $sum: '$amountCents' } } }]).session(session),
        DispatchFinancialAdjustment.aggregate([{ $match: { dispatchId: dispatch._id, status: 'POSTED' } }, { $group: { _id: null, cents: { $sum: '$amountCents' } } }]).session(session),
      ]);
      const directExpenseCents = expenses[0]?.cents ?? 0; const adjustmentCents = adjustments[0]?.cents ?? 0;
      const metrics = calculateDispatchMetrics({ acquiredKgMilli: dispatch.acquiredKgMilli, acceptedKgMilli: input.acceptedKgMilli, purchaseCostCents: dispatch.purchaseCostCents, sellingRateCentsPerKg: input.sellingRateCentsPerKg, directExpenseCents, adjustmentCents });
      if (metrics.quantityVarianceMilli !== 0 && !input.discrepancyReason) throw new AppError(422, 'DISCREPANCY_REASON_REQUIRED', 'A quantity discrepancy reason is required');
      const version = await DispatchReconciliation.countDocuments({ dispatchId: dispatch._id }).session(session) + 1;
      const before = { acceptedKgMilli: dispatch.acceptedKgMilli, sellingRateCentsPerKg: dispatch.sellingRateCentsPerKg, revenueCents: dispatch.revenueCents, netProfitCents: dispatch.netProfitCents };
      await DispatchReconciliation.create([{ ...input, version, quantityVarianceMilli: metrics.quantityVarianceMilli, quantityVarianceBasisPoints: metrics.quantityVarianceBasisPoints, previousSnapshot: before, resultingSnapshot: metrics, operatorId: actor.id }], { session });
      const invoice = await CompanyInvoice.findOne({ dispatchId: dispatch._id }).session(session);
      if (invoice && dispatch.revenueCents !== undefined && dispatch.revenueCents !== metrics.revenueCents) {
        const delta = metrics.revenueCents - dispatch.revenueCents; const newTotal = invoice.totalCents + delta;
        if (newTotal < 0) throw new AppError(409, 'INVOICE_ADJUSTMENT_CONFLICT', 'Reconciliation would make invoice total negative');
        const newOutstanding = Math.max(0, invoice.outstandingCents + delta);
        await CompanyInvoice.updateOne({ _id: invoice._id }, { $set: { totalCents: newTotal, outstandingCents: newOutstanding, status: newOutstanding === 0 ? 'PAID' : newOutstanding === newTotal ? 'UNPAID' : 'PARTIALLY_PAID' } }, { session });
        const number = await nextCounter('company-invoice-adjustment', session);
        const [adjustment] = await CompanyInvoiceAdjustment.create([{ adjustmentNumber: `CIA-${String(number).padStart(6, '0')}`, idempotencyKey: `${input.idempotencyKey}:invoice`, invoiceId: invoice._id, dispatchId: dispatch._id, buyerId: invoice.buyerId, amountCents: delta, type: delta >= 0 ? 'DEBIT' : 'CREDIT', eventAt: input.eventAt, reason: input.discrepancyReason ?? 'Dispatch reconciliation amendment', createdBy: actor.id }], { session });
        await BuyerLedgerEntry.create([{ buyerId: invoice.buyerId, eventAt: input.eventAt, type: 'ADJUSTMENT', receivableDeltaCents: delta, referenceType: 'CompanyInvoiceAdjustment', referenceId: adjustment._id, description: adjustment.reason, createdBy: actor.id }], { session });
      }
      output = await DispatchBatch.findOneAndUpdate({ _id: dispatch._id, status: dispatch.status }, { $set: { status: invoice ? 'FINALIZED' : 'RECONCILED', acceptedKgMilli: input.acceptedKgMilli, sellingRateCentsPerKg: input.sellingRateCentsPerKg, weighbridgeReference: input.weighbridgeReference, weighbridgeDocumentName: input.weighbridgeDocumentName, weighbridgeDocumentUrl: input.weighbridgeDocumentUrl, reconciledAt: input.eventAt, reconciledBy: actor.id, reconciliationApprovedBy: input.approvedBy, directExpenseCents, adjustmentCents, ...metrics } }, { returnDocument: 'after', session });
      if (!output) throw new AppError(409, 'RECONCILIATION_CONFLICT', 'Dispatch changed during reconciliation');
      await AuditLog.create([{ actorId: actor.id, action: version === 1 ? 'DISPATCH_RECONCILED' : 'DISPATCH_RECONCILIATION_CORRECTED', entityType: 'DispatchBatch', entityId: dispatch._id, reason: input.discrepancyReason ?? input.notes ?? 'Company weighbridge reconciliation', before, after: { version, ...metrics } }], { session });
    });
    return output;
  } catch (error) {
    if ((error as { code?: number }).code === 11000 && await DispatchReconciliation.exists({ idempotencyKey: input.idempotencyKey })) return DispatchBatch.findById(input.dispatchId);
    throw error;
  } finally { await session.endSession(); }
}
