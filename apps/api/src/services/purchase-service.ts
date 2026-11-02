import mongoose, { type ClientSession } from 'mongoose';
import { calculatePurchase, calculateSettlement } from '@latex/domain';
import { AppError, type AuthUser } from '../http.js';
import { AdvanceAllocation, AuditLog, Counter, DensityFactorVersion, Purchase, PurchaseRate, Supplier, SupplierAdvance, SupplierLedgerEntry } from '../models.js';

export interface CreatePurchaseInput {
  idempotencyKey: string; locationId: string; supplierId: string; eventAt: Date; litresMilli: number; densityReading: number;
  cashPaidCents: number; advanceApplications: { advanceId: string; amountCents: number }[]; adjustmentCents: number; notes?: string | undefined;
}

async function nextCounter(key: string, session: ClientSession): Promise<number> {
  const counter = await Counter.findOneAndUpdate({ key }, { $inc: { value: 1 } }, { upsert: true, returnDocument: 'after', session });
  if (!counter) throw new AppError(500, 'COUNTER_ERROR', 'Could not allocate sequence');
  return counter.value as number;
}

export async function createPurchase(input: CreatePurchaseInput, actor: AuthUser) {
  const existing = await Purchase.findOne({ idempotencyKey: input.idempotencyKey });
  if (existing) return existing;
  const session = await mongoose.startSession();
  try {
    let result: InstanceType<typeof Purchase> | undefined;
    await session.withTransaction(async () => {
      if (!await Supplier.exists({ _id: input.supplierId, active: true }).session(session)) throw new AppError(404, 'SUPPLIER_NOT_FOUND', 'Active supplier not found');
      const density = await DensityFactorVersion.findOne({ effectiveFrom: { $lte: input.eventAt } }).sort({ effectiveFrom: -1 }).session(session);
      if (!density) throw new AppError(409, 'DENSITY_CONFIG_MISSING', 'No effective density table');
      const entry = density.entries.find((item: { reading: number }) => item.reading === input.densityReading);
      if (!entry) throw new AppError(422, 'INVALID_DENSITY_READING', 'The selected reading is not configured');
      const rate = await PurchaseRate.findOne({ effectiveFrom: { $lte: input.eventAt } }).sort({ effectiveFrom: -1 }).session(session);
      if (!rate) throw new AppError(409, 'RATE_MISSING', 'No effective purchase rate');
      const calculated = calculatePurchase({ litresMilli: input.litresMilli, factorMilli: entry.factorMilli, rateCentsPerKg: rate.rateCentsPerKg, adjustmentCents: input.adjustmentCents });
      const advanceAppliedCents = input.advanceApplications.reduce((sum, item) => sum + item.amountCents, 0);
      let settlement;
      try { settlement = calculateSettlement(calculated.totalCents, input.cashPaidCents, advanceAppliedCents); }
      catch { throw new AppError(422, 'OVERPAYMENT', 'Settlements cannot exceed purchase total'); }
      const { outstandingCents, paymentStatus } = settlement;
      const sequence = await nextCounter(`purchase:${input.locationId}`, session);
      const billSequence = await nextCounter('bill', session);
      const docs = await Purchase.create([{
        billNumber: `LAT-${String(billSequence).padStart(6, '0')}`, idempotencyKey: input.idempotencyKey, locationId: input.locationId, sequence,
        supplierId: input.supplierId, eventAt: input.eventAt, densityReading: input.densityReading, densityVersion: density.version,
        ...calculated, rateSourceId: rate._id, cashPaidCents: input.cashPaidCents, advanceAppliedCents, outstandingCents,
        paymentStatus, notes: input.notes, operatorId: actor.id,
      }], { session });
      result = docs[0];
      if (!result) throw new AppError(500, 'PURCHASE_CREATE_FAILED', 'Purchase was not created');
      await SupplierLedgerEntry.create([{ supplierId: input.supplierId, eventAt: input.eventAt, type: 'PURCHASE_OBLIGATION', payableDeltaCents: calculated.totalCents, advanceDeltaCents: 0, referenceType: 'Purchase', referenceId: result._id, createdBy: actor.id }], { session });
      if (input.cashPaidCents > 0) await SupplierLedgerEntry.create([{ supplierId: input.supplierId, eventAt: input.eventAt, type: 'PAYMENT', payableDeltaCents: -input.cashPaidCents, advanceDeltaCents: 0, referenceType: 'Purchase', referenceId: result._id, createdBy: actor.id }], { session });
      for (const allocation of input.advanceApplications) {
        const updated = await SupplierAdvance.findOneAndUpdate({ _id: allocation.advanceId, supplierId: input.supplierId, $expr: { $gte: [{ $subtract: ['$issuedCents', { $add: ['$allocatedCents', '$repaidCents'] }] }, allocation.amountCents] } }, { $inc: { allocatedCents: allocation.amountCents } }, { returnDocument: 'after', session });
        if (!updated) throw new AppError(409, 'ADVANCE_UNAVAILABLE', 'Advance has insufficient available balance');
        await AdvanceAllocation.create([{ advanceId: allocation.advanceId, purchaseId: result._id, amountCents: allocation.amountCents, allocatedBy: actor.id }], { session });
        await SupplierLedgerEntry.create([{ supplierId: input.supplierId, eventAt: input.eventAt, type: 'ADVANCE_ALLOCATED', payableDeltaCents: -allocation.amountCents, advanceDeltaCents: -allocation.amountCents, referenceType: 'Purchase', referenceId: result._id, createdBy: actor.id }], { session });
      }
      await AuditLog.create([{ actorId: actor.id, action: 'PURCHASE_CREATED', entityType: 'Purchase', entityId: result._id, reason: input.notes ?? 'Latex purchase', after: { billNumber: result.billNumber, locationId: input.locationId, sequence, supplierId: input.supplierId, litresMilli: calculated.litresMilli, kgMilli: calculated.kgMilli, totalCents: calculated.totalCents, cashPaidCents: input.cashPaidCents, advanceAppliedCents, outstandingCents } }], { session });
    });
    if (!result) throw new AppError(500, 'TRANSACTION_ABORTED', 'Purchase transaction did not complete');
    return result;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const duplicate = await Purchase.findOne({ idempotencyKey: input.idempotencyKey });
      if (duplicate) return duplicate;
    }
    throw error;
  } finally { await session.endSession(); }
}
