import mongoose from 'mongoose';
import { assertContiguousDispatchBoundary, calculateDispatchProfit } from '@latex/domain';
import { AppError, type AuthUser } from '../http.js';
import { AuditLog, Counter, DispatchBatch, Purchase } from '../models.js';

export async function previewDispatch(locationId: string, lastSequence: number) {
  const previous = await DispatchBatch.findOne({ locationId, status: { $in: ['CONFIRMED', 'FINALIZED'] } }).sort({ lastSequence: -1 }).lean();
  const firstSequence = (previous?.lastSequence ?? 0) + 1;
  if (lastSequence < firstSequence) throw new AppError(422, 'INVALID_BOUNDARY', 'Boundary must follow the last confirmed dispatch');
  const purchases = await Purchase.find({ locationId, sequence: { $gte: firstSequence, $lte: lastSequence }, dispatchStatus: 'PENDING', reversedAt: { $exists: false } }).sort({ sequence: 1 }).populate('supplierId', 'code name').lean();
  const expectedCount = lastSequence - firstSequence + 1;
  if (purchases.length !== expectedCount) throw new AppError(409, 'BOUNDARY_GAP', 'Boundary contains a missing, reversed, or already assigned purchase');
  try { assertContiguousDispatchBoundary(purchases.map((purchase) => purchase.sequence), firstSequence - 1, lastSequence); }
  catch { throw new AppError(409, 'BOUNDARY_GAP', 'Boundary contains non-contiguous purchase sequences'); }
  return {
    firstSequence, lastSequence, purchases,
    totals: purchases.reduce((a, p) => ({ litresMilli: a.litresMilli + p.litresMilli, kgMilli: a.kgMilli + p.kgMilli, purchaseCostCents: a.purchaseCostCents + p.totalCents }), { litresMilli: 0, kgMilli: 0, purchaseCostCents: 0 }),
  };
}

export async function confirmDispatch(input: { idempotencyKey: string; locationId: string; lastSequence: number; buyerId: string; vehicleNumber: string; dispatchedAt: Date; acceptedKgMilli?: number | undefined; sellingRateCentsPerKg?: number | undefined; directExpenseCents: number }, actor: AuthUser) {
  const existing = await DispatchBatch.findOne({ idempotencyKey: input.idempotencyKey });
  if (existing) return existing;
  const session = await mongoose.startSession();
  try {
    let output: InstanceType<typeof DispatchBatch> | undefined;
    await session.withTransaction(async () => {
      const preview = await previewDispatch(input.locationId, input.lastSequence);
      const dispatchSeq = (await Counter.findOneAndUpdate({ key: 'dispatch' }, { $inc: { value: 1 } }, { upsert: true, returnDocument: 'after', session }))?.value;
      if (!dispatchSeq) throw new AppError(500, 'COUNTER_ERROR', 'Could not allocate dispatch number');
      const profit = input.acceptedKgMilli !== undefined && input.sellingRateCentsPerKg !== undefined
        ? calculateDispatchProfit({ purchaseCostCents: preview.totals.purchaseCostCents, acceptedKgMilli: input.acceptedKgMilli, sellingRateCentsPerKg: input.sellingRateCentsPerKg, expenseCents: input.directExpenseCents }) : {};
      const created = await DispatchBatch.create([{ dispatchNumber: `DSP-${String(dispatchSeq).padStart(5, '0')}`, idempotencyKey: input.idempotencyKey, locationId: input.locationId, status: 'CONFIRMED', buyerId: input.buyerId, vehicleNumber: input.vehicleNumber, firstSequence: preview.firstSequence, lastSequence: preview.lastSequence, purchaseCount: preview.purchases.length, totalLitresMilli: preview.totals.litresMilli, acquiredKgMilli: preview.totals.kgMilli, purchaseCostCents: preview.totals.purchaseCostCents, acceptedKgMilli: input.acceptedKgMilli, sellingRateCentsPerKg: input.sellingRateCentsPerKg, directExpenseCents: input.directExpenseCents, ...profit, dispatchedAt: input.dispatchedAt, confirmedBy: actor.id, confirmedAt: new Date() }], { session });
      output = created[0];
      if (!output) throw new AppError(500, 'DISPATCH_CREATE_FAILED', 'Dispatch was not created');
      const claimed = await Purchase.updateMany({ _id: { $in: preview.purchases.map((p) => p._id) }, dispatchStatus: 'PENDING' }, { $set: { dispatchStatus: 'ASSIGNED', dispatchId: output._id } }, { session });
      if (claimed.modifiedCount !== preview.purchases.length) throw new AppError(409, 'DISPATCH_CONFLICT', 'Another operator changed this boundary; preview again');
      await AuditLog.create([{ actorId: actor.id, action: 'DISPATCH_CONFIRMED', entityType: 'DispatchBatch', entityId: output._id, reason: 'Exact purchase boundary confirmed', after: { dispatchNumber: output.dispatchNumber, locationId: input.locationId, firstSequence: preview.firstSequence, lastSequence: preview.lastSequence, purchaseCount: preview.purchases.length, purchaseCostCents: preview.totals.purchaseCostCents } }], { session });
    });
    if (!output) throw new AppError(500, 'TRANSACTION_ABORTED', 'Dispatch confirmation did not complete');
    return output;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const duplicate = await DispatchBatch.findOne({ idempotencyKey: input.idempotencyKey });
      if (duplicate) return duplicate;
    }
    throw error;
  } finally { await session.endSession(); }
}
