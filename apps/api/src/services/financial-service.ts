import mongoose, { type ClientSession } from 'mongoose';
import { AppError, type AuthUser } from '../http.js';
import {
  AdvanceAllocation, AdvanceRepayment, AuditLog, BuyerLedgerEntry, CashBankAccount, CashBankTransaction, CashierShift,
  CompanyInvoice, CompanySettlement, Counter, DispatchBatch, Purchase, Supplier, SupplierAdvance, SupplierLedgerEntry, SupplierPayment,
} from '../models.js';

type PaymentMethod = 'CASH' | 'BANK';

async function nextCounter(key: string, session: ClientSession): Promise<number> {
  const counter = await Counter.findOneAndUpdate({ key }, { $inc: { value: 1 } }, { upsert: true, returnDocument: 'after', session });
  if (!counter) throw new AppError(500, 'COUNTER_ERROR', `Could not allocate ${key} sequence`);
  return counter.value as number;
}

async function requireAccount(accountId: string, method: PaymentMethod, session: ClientSession) {
  const account = await CashBankAccount.findOne({ _id: accountId, active: true }).session(session);
  if (!account) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Active cash/bank account not found');
  if (account.type !== method) throw new AppError(422, 'ACCOUNT_METHOD_MISMATCH', `A ${method} transaction requires a ${method} account`);
  return account;
}

async function requireShift(method: PaymentMethod, accountId: string, actor: AuthUser, session: ClientSession) {
  if (method === 'BANK') return null;
  const shift = await CashierShift.findOne({ cashierId: actor.id, accountId, status: 'OPEN' }).session(session);
  if (!shift) throw new AppError(409, 'SHIFT_REQUIRED', 'Open a cashier shift for this cash account first');
  return shift;
}

async function createCashMovement(args: {
  idempotencyKey: string; accountId: unknown; shiftId?: unknown; eventAt: Date; type: string; signedAmountCents: number;
  referenceType: string; referenceId: unknown; description?: string | undefined; actorId: string; session: ClientSession;
}) {
  const docs = await CashBankTransaction.create([{
    idempotencyKey: args.idempotencyKey, accountId: args.accountId, shiftId: args.shiftId, eventAt: args.eventAt, type: args.type,
    signedAmountCents: args.signedAmountCents, referenceType: args.referenceType, referenceId: args.referenceId,
    description: args.description, createdBy: args.actorId,
  }], { session: args.session });
  return docs[0];
}

export async function createCashBankAccount(input: { idempotencyKey: string; code: string; name: string; type: PaymentMethod; openingBalanceCents: number }, actor: AuthUser) {
  const existing = await CashBankAccount.findOne({ idempotencyKey: input.idempotencyKey });
  if (existing) return existing;
  const session = await mongoose.startSession();
  try {
    let account: any;
    await session.withTransaction(async () => {
      [account] = await CashBankAccount.create([{ ...input, createdBy: actor.id }], { session });
      if (input.openingBalanceCents !== 0) await createCashMovement({ idempotencyKey: `account-opening:${account._id}`, accountId: account._id, eventAt: new Date(), type: 'OPENING_ADJUSTMENT', signedAmountCents: input.openingBalanceCents, referenceType: 'CashBankAccount', referenceId: account._id, description: 'Audited opening balance', actorId: actor.id, session });
      await AuditLog.create([{ actorId: actor.id, action: 'CASH_BANK_ACCOUNT_CREATED', entityType: 'CashBankAccount', entityId: account._id, reason: 'Account initialization', after: input }], { session });
    });
    return account;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const duplicate = await CashBankAccount.findOne({ idempotencyKey: input.idempotencyKey });
      if (duplicate) return duplicate;
    }
    throw error;
  } finally { await session.endSession(); }
}

export async function listCashBankAccountsWithBalances() {
  return CashBankAccount.aggregate([
    { $lookup: { from: 'cashbanktransactions', localField: '_id', foreignField: 'accountId', as: 'transactions' } },
    { $set: { balanceCents: { $sum: '$transactions.signedAmountCents' } } },
    { $unset: 'transactions' },
    { $sort: { type: 1, code: 1 } },
  ]);
}

export async function openCashierShift(input: { idempotencyKey: string; accountId: string; locationId: string; openedAt: Date; openingFloatCents: number; openingNotes?: string | undefined }, actor: AuthUser) {
  const existing = await CashierShift.findOne({ idempotencyKey: input.idempotencyKey });
  if (existing) return existing;
  const session = await mongoose.startSession();
  try {
    let shift: any;
    await session.withTransaction(async () => {
      const account = await CashBankAccount.findOne({ _id: input.accountId, type: 'CASH', active: true }).session(session);
      if (!account) throw new AppError(404, 'CASH_ACCOUNT_NOT_FOUND', 'Active cash account not found');
      if (await CashierShift.exists({ cashierId: actor.id, status: 'OPEN' }).session(session)) throw new AppError(409, 'SHIFT_ALREADY_OPEN', 'This cashier already has an open shift');
      const sequence = await nextCounter('cashier-shift', session);
      [shift] = await CashierShift.create([{ shiftNumber: `SHF-${String(sequence).padStart(6, '0')}`, ...input, cashierId: actor.id, openedBy: actor.id }], { session });
      await AuditLog.create([{ actorId: actor.id, action: 'CASHIER_SHIFT_OPENED', entityType: 'CashierShift', entityId: shift._id, reason: input.openingNotes ?? 'Shift opening', after: { shiftNumber: shift.shiftNumber, accountId: input.accountId, openingFloatCents: input.openingFloatCents } }], { session });
    });
    return shift;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const duplicate = await CashierShift.findOne({ idempotencyKey: input.idempotencyKey });
      if (duplicate) return duplicate;
    }
    throw error;
  } finally { await session.endSession(); }
}

export async function closeCashierShift(shiftId: string, input: { idempotencyKey: string; countedCashCents: number; closedAt: Date; closingNotes?: string | undefined }, actor: AuthUser) {
  const duplicate = await CashierShift.findOne({ closeIdempotencyKey: input.idempotencyKey });
  if (duplicate) return duplicate;
  const session = await mongoose.startSession();
  try {
    let closed: any;
    await session.withTransaction(async () => {
      const shift = await CashierShift.findOne({ _id: shiftId, status: 'OPEN' }).session(session);
      if (!shift) throw new AppError(404, 'OPEN_SHIFT_NOT_FOUND', 'Open cashier shift not found');
      if (String(shift.cashierId) !== actor.id && !['ADMIN', 'MANAGER', 'ACCOUNTANT'].includes(actor.role)) throw new AppError(403, 'FORBIDDEN', 'Only the cashier or an authorized supervisor may close this shift');
      const [movement] = await CashBankTransaction.aggregate([
        { $match: { shiftId: shift._id } }, { $group: { _id: null, cents: { $sum: '$signedAmountCents' } } },
      ]).session(session);
      const expectedCashCents = shift.openingFloatCents + (movement?.cents ?? 0);
      const varianceCents = input.countedCashCents - expectedCashCents;
      if (varianceCents !== 0 && !['ADMIN', 'MANAGER', 'ACCOUNTANT'].includes(actor.role)) throw new AppError(403, 'VARIANCE_APPROVAL_REQUIRED', 'A manager or accountant must close a shift with a cash variance');
      const { idempotencyKey, ...closing } = input;
      closed = await CashierShift.findOneAndUpdate({ _id: shiftId, status: 'OPEN' }, { $set: { status: 'CLOSED', ...closing, closeIdempotencyKey: idempotencyKey, expectedCashCents, varianceCents, closedBy: actor.id } }, { returnDocument: 'after', session });
      if (!closed) throw new AppError(409, 'SHIFT_CLOSE_CONFLICT', 'Shift was already closed');
      if (varianceCents !== 0) await createCashMovement({ idempotencyKey: `shift-variance:${shift._id}`, accountId: shift.accountId, shiftId: shift._id, eventAt: input.closedAt, type: 'SHIFT_VARIANCE', signedAmountCents: varianceCents, referenceType: 'CashierShift', referenceId: shift._id, description: input.closingNotes ?? 'Cashier variance', actorId: actor.id, session });
      await AuditLog.create([{ actorId: actor.id, action: 'CASHIER_SHIFT_CLOSED', entityType: 'CashierShift', entityId: shift._id, reason: input.closingNotes ?? 'Shift closing', before: { status: 'OPEN' }, after: { status: 'CLOSED', expectedCashCents, countedCashCents: input.countedCashCents, varianceCents } }], { session });
    });
    return closed;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const repeated = await CashierShift.findOne({ closeIdempotencyKey: input.idempotencyKey });
      if (repeated) return repeated;
    }
    throw error;
  } finally { await session.endSession(); }
}

export async function postSupplierPayment(input: { idempotencyKey: string; supplierId: string; amountCents: number; paymentMethod: PaymentMethod; accountId: string; eventAt: Date; referenceNumber?: string | undefined; description?: string | undefined; approvedBy: string; allocations: { purchaseId: string; amountCents: number }[] }, actor: AuthUser) {
  const existing = await SupplierPayment.findOne({ idempotencyKey: input.idempotencyKey });
  if (existing) return existing;
  const allocated = input.allocations.reduce((sum, item) => sum + item.amountCents, 0);
  if (allocated !== input.amountCents || input.allocations.length === 0) throw new AppError(422, 'ALLOCATION_MISMATCH', 'Payment allocations must exactly equal the payment amount');
  const session = await mongoose.startSession();
  try {
    let payment: any;
    await session.withTransaction(async () => {
      if (!await Supplier.exists({ _id: input.supplierId, active: true }).session(session)) throw new AppError(404, 'SUPPLIER_NOT_FOUND', 'Active supplier not found');
      await requireAccount(input.accountId, input.paymentMethod, session);
      const shift = await requireShift(input.paymentMethod, input.accountId, actor, session);
      for (const allocation of input.allocations) {
        const purchase = await Purchase.findOneAndUpdate(
          { _id: allocation.purchaseId, supplierId: input.supplierId, reversedAt: { $exists: false }, outstandingCents: { $gte: allocation.amountCents } },
          [{ $set: { outstandingCents: { $subtract: ['$outstandingCents', allocation.amountCents] } } }, { $set: { paymentStatus: { $cond: [{ $eq: ['$outstandingCents', 0] }, 'PAID', 'PARTIALLY_PAID'] } } }],
          { returnDocument: 'after', session, updatePipeline: true },
        );
        if (!purchase) throw new AppError(409, 'PURCHASE_ALLOCATION_CONFLICT', 'A purchase is missing or has insufficient outstanding balance');
      }
      const sequence = await nextCounter('supplier-payment', session);
      [payment] = await SupplierPayment.create([{ paymentNumber: `SPY-${String(sequence).padStart(6, '0')}`, ...input, shiftId: shift?._id, createdBy: actor.id }], { session });
      await SupplierLedgerEntry.create([{ supplierId: input.supplierId, eventAt: input.eventAt, type: 'PAYMENT', payableDeltaCents: -input.amountCents, advanceDeltaCents: 0, referenceType: 'SupplierPayment', referenceId: payment._id, description: input.description, createdBy: actor.id }], { session });
      await createCashMovement({ idempotencyKey: `${input.idempotencyKey}:cash`, accountId: input.accountId, shiftId: shift?._id, eventAt: input.eventAt, type: 'SUPPLIER_PAYMENT', signedAmountCents: -input.amountCents, referenceType: 'SupplierPayment', referenceId: payment._id, description: input.description, actorId: actor.id, session });
      await AuditLog.create([{ actorId: actor.id, action: 'SUPPLIER_PAYMENT_POSTED', entityType: 'SupplierPayment', entityId: payment._id, reason: input.description ?? 'Supplier payment', after: { paymentNumber: payment.paymentNumber, supplierId: input.supplierId, amountCents: input.amountCents, allocations: input.allocations } }], { session });
    });
    return payment;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const duplicate = await SupplierPayment.findOne({ idempotencyKey: input.idempotencyKey });
      if (duplicate) return duplicate;
    }
    throw error;
  } finally { await session.endSession(); }
}

export async function reverseSupplierPayment(paymentId: string, input: { idempotencyKey: string; reason: string; eventAt: Date }, actor: AuthUser) {
  const duplicate = await SupplierPayment.findOne({ reversalIdempotencyKey: input.idempotencyKey });
  if (duplicate) return duplicate;
  const session = await mongoose.startSession();
  try {
    let reversed: any;
    await session.withTransaction(async () => {
      const payment = await SupplierPayment.findOne({ _id: paymentId, status: 'POSTED' }).session(session);
      if (!payment) throw new AppError(404, 'POSTED_PAYMENT_NOT_FOUND', 'Posted supplier payment not found');
      const reversalShift = await requireShift(payment.paymentMethod, String(payment.accountId), actor, session);
      for (const allocation of payment.allocations) {
        const purchase = await Purchase.findOneAndUpdate(
          { _id: allocation.purchaseId, supplierId: payment.supplierId, reversedAt: { $exists: false }, $expr: { $lte: [{ $add: ['$outstandingCents', allocation.amountCents] }, '$totalCents'] } },
          [{ $set: { outstandingCents: { $add: ['$outstandingCents', allocation.amountCents] } } }, { $set: { paymentStatus: { $cond: [{ $eq: ['$outstandingCents', '$totalCents'] }, 'UNPAID', 'PARTIALLY_PAID'] } } }],
          { returnDocument: 'after', session, updatePipeline: true },
        );
        if (!purchase) throw new AppError(409, 'PAYMENT_REVERSAL_CONFLICT', 'Purchase balance no longer permits this reversal');
      }
      reversed = await SupplierPayment.findOneAndUpdate({ _id: paymentId, status: 'POSTED' }, { $set: { status: 'REVERSED', reversedAt: input.eventAt, reversedBy: actor.id, reversalReason: input.reason, reversalIdempotencyKey: input.idempotencyKey } }, { returnDocument: 'after', session });
      if (!reversed) throw new AppError(409, 'PAYMENT_REVERSAL_CONFLICT', 'Payment was already reversed');
      await SupplierLedgerEntry.create([{ supplierId: payment.supplierId, eventAt: input.eventAt, type: 'PAYMENT_REVERSAL', payableDeltaCents: payment.amountCents, advanceDeltaCents: 0, referenceType: 'SupplierPayment', referenceId: payment._id, description: input.reason, createdBy: actor.id }], { session });
      await createCashMovement({ idempotencyKey: `${input.idempotencyKey}:cash`, accountId: payment.accountId, shiftId: reversalShift?._id, eventAt: input.eventAt, type: 'REVERSAL', signedAmountCents: payment.amountCents, referenceType: 'SupplierPayment', referenceId: payment._id, description: input.reason, actorId: actor.id, session });
      await AuditLog.create([{ actorId: actor.id, action: 'SUPPLIER_PAYMENT_REVERSED', entityType: 'SupplierPayment', entityId: payment._id, reason: input.reason, before: { status: 'POSTED' }, after: { status: 'REVERSED' } }], { session });
    });
    return reversed;
  } finally { await session.endSession(); }
}

export async function issueSupplierAdvance(input: { idempotencyKey: string; supplierId: string; issuedCents: number; issuedAt: Date; paymentMethod: PaymentMethod; accountId: string; referenceNumber?: string | undefined; description?: string | undefined; approvedBy: string; }, actor: AuthUser) {
  const existing = await SupplierAdvance.findOne({ idempotencyKey: input.idempotencyKey });
  if (existing) return existing;
  const session = await mongoose.startSession();
  try {
    let advance: any;
    await session.withTransaction(async () => {
      if (!await Supplier.exists({ _id: input.supplierId, active: true }).session(session)) throw new AppError(404, 'SUPPLIER_NOT_FOUND', 'Active supplier not found');
      await requireAccount(input.accountId, input.paymentMethod, session);
      const shift = await requireShift(input.paymentMethod, input.accountId, actor, session);
      [advance] = await SupplierAdvance.create([{ ...input, issuedBy: actor.id }], { session });
      await SupplierLedgerEntry.create([{ supplierId: input.supplierId, eventAt: input.issuedAt, type: 'ADVANCE_ISSUED', payableDeltaCents: 0, advanceDeltaCents: input.issuedCents, referenceType: 'SupplierAdvance', referenceId: advance._id, description: input.description, createdBy: actor.id }], { session });
      await createCashMovement({ idempotencyKey: `${input.idempotencyKey}:cash`, accountId: input.accountId, shiftId: shift?._id, eventAt: input.issuedAt, type: 'ADVANCE_ISSUE', signedAmountCents: -input.issuedCents, referenceType: 'SupplierAdvance', referenceId: advance._id, description: input.description, actorId: actor.id, session });
      await AuditLog.create([{ actorId: actor.id, action: 'SUPPLIER_ADVANCE_ISSUED', entityType: 'SupplierAdvance', entityId: advance._id, reason: input.description ?? 'Supplier advance', after: { supplierId: input.supplierId, issuedCents: input.issuedCents, paymentMethod: input.paymentMethod } }], { session });
    });
    return advance;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const duplicate = await SupplierAdvance.findOne({ idempotencyKey: input.idempotencyKey });
      if (duplicate) return duplicate;
    }
    throw error;
  } finally { await session.endSession(); }
}

export async function recordAdvanceRepayment(input: { idempotencyKey: string; advanceId: string; amountCents: number; accountId: string; paymentMethod: PaymentMethod; eventAt: Date; referenceNumber?: string | undefined; description?: string | undefined }, actor: AuthUser) {
  const existing = await AdvanceRepayment.findOne({ idempotencyKey: input.idempotencyKey });
  if (existing) return existing;
  const session = await mongoose.startSession();
  try {
    let repayment: any;
    await session.withTransaction(async () => {
      await requireAccount(input.accountId, input.paymentMethod, session);
      const shift = await requireShift(input.paymentMethod, input.accountId, actor, session);
      const advance = await SupplierAdvance.findOneAndUpdate({ _id: input.advanceId, status: { $ne: 'REVERSED' }, $expr: { $gte: [{ $subtract: ['$issuedCents', { $add: ['$allocatedCents', '$repaidCents'] }] }, input.amountCents] } }, { $inc: { repaidCents: input.amountCents } }, { returnDocument: 'after', session });
      if (!advance) throw new AppError(409, 'ADVANCE_REPAYMENT_CONFLICT', 'Advance has insufficient recoverable balance');
      const sequence = await nextCounter('advance-repayment', session);
      [repayment] = await AdvanceRepayment.create([{ repaymentNumber: `ARP-${String(sequence).padStart(6, '0')}`, ...input, supplierId: advance.supplierId, shiftId: shift?._id, receivedBy: actor.id }], { session });
      await SupplierLedgerEntry.create([{ supplierId: advance.supplierId, eventAt: input.eventAt, type: 'ADVANCE_REPAID', payableDeltaCents: 0, advanceDeltaCents: -input.amountCents, referenceType: 'AdvanceRepayment', referenceId: repayment._id, description: input.description, createdBy: actor.id }], { session });
      await createCashMovement({ idempotencyKey: `${input.idempotencyKey}:cash`, accountId: input.accountId, shiftId: shift?._id, eventAt: input.eventAt, type: 'ADVANCE_REPAYMENT', signedAmountCents: input.amountCents, referenceType: 'AdvanceRepayment', referenceId: repayment._id, description: input.description, actorId: actor.id, session });
      await AuditLog.create([{ actorId: actor.id, action: 'SUPPLIER_ADVANCE_REPAID', entityType: 'AdvanceRepayment', entityId: repayment._id, reason: input.description ?? 'Supplier advance repayment', after: { advanceId: input.advanceId, amountCents: input.amountCents, paymentMethod: input.paymentMethod } }], { session });
    });
    return repayment;
  } finally { await session.endSession(); }
}

export async function reverseAdvanceRepayment(repaymentId: string, input: { idempotencyKey: string; reason: string; eventAt: Date }, actor: AuthUser) {
  const duplicate = await AdvanceRepayment.findOne({ reversalIdempotencyKey: input.idempotencyKey });
  if (duplicate) return duplicate;
  const session = await mongoose.startSession();
  try {
    let reversed: any;
    await session.withTransaction(async () => {
      const repayment = await AdvanceRepayment.findOne({ _id: repaymentId, status: 'POSTED' }).session(session);
      if (!repayment) throw new AppError(404, 'POSTED_REPAYMENT_NOT_FOUND', 'Posted advance repayment not found');
      const reversalShift = await requireShift(repayment.paymentMethod, String(repayment.accountId), actor, session);
      const advance = await SupplierAdvance.findOneAndUpdate({ _id: repayment.advanceId, status: { $ne: 'REVERSED' }, repaidCents: { $gte: repayment.amountCents } }, { $inc: { repaidCents: -repayment.amountCents } }, { returnDocument: 'after', session });
      if (!advance) throw new AppError(409, 'REPAYMENT_REVERSAL_CONFLICT', 'Advance balance no longer permits this reversal');
      reversed = await AdvanceRepayment.findOneAndUpdate({ _id: repaymentId, status: 'POSTED' }, { $set: { status: 'REVERSED', reversedAt: input.eventAt, reversedBy: actor.id, reversalReason: input.reason, reversalIdempotencyKey: input.idempotencyKey } }, { returnDocument: 'after', session });
      if (!reversed) throw new AppError(409, 'REPAYMENT_REVERSAL_CONFLICT', 'Repayment was already reversed');
      await SupplierLedgerEntry.create([{ supplierId: repayment.supplierId, eventAt: input.eventAt, type: 'ADVANCE_REPAYMENT_REVERSAL', payableDeltaCents: 0, advanceDeltaCents: repayment.amountCents, referenceType: 'AdvanceRepayment', referenceId: repayment._id, description: input.reason, createdBy: actor.id }], { session });
      await createCashMovement({ idempotencyKey: `${input.idempotencyKey}:cash`, accountId: repayment.accountId, shiftId: reversalShift?._id, eventAt: input.eventAt, type: 'REVERSAL', signedAmountCents: -repayment.amountCents, referenceType: 'AdvanceRepayment', referenceId: repayment._id, description: input.reason, actorId: actor.id, session });
      await AuditLog.create([{ actorId: actor.id, action: 'SUPPLIER_ADVANCE_REPAYMENT_REVERSED', entityType: 'AdvanceRepayment', entityId: repayment._id, reason: input.reason, before: { status: 'POSTED' }, after: { status: 'REVERSED' } }], { session });
    });
    return reversed;
  } finally { await session.endSession(); }
}

export async function reverseSupplierAdvance(advanceId: string, input: { idempotencyKey: string; reason: string; eventAt: Date }, actor: AuthUser) {
  const duplicate = await SupplierAdvance.findOne({ reversalIdempotencyKey: input.idempotencyKey });
  if (duplicate) return duplicate;
  const session = await mongoose.startSession();
  try {
    let reversed: any;
    await session.withTransaction(async () => {
      const advance = await SupplierAdvance.findOne({ _id: advanceId, status: 'ACTIVE' }).session(session);
      if (!advance) throw new AppError(404, 'ACTIVE_ADVANCE_NOT_FOUND', 'Active supplier advance not found');
      if (advance.allocatedCents !== 0 || advance.repaidCents !== 0) throw new AppError(409, 'ADVANCE_REVERSAL_CONFLICT', 'Reverse allocations or repayments before reversing this advance');
      const reversalShift = await requireShift(advance.paymentMethod, String(advance.accountId), actor, session);
      reversed = await SupplierAdvance.findOneAndUpdate(
        { _id: advanceId, status: 'ACTIVE', allocatedCents: 0, repaidCents: 0 },
        { $set: { status: 'REVERSED', reversedAt: input.eventAt, reversedBy: actor.id, reversalReason: input.reason, reversalIdempotencyKey: input.idempotencyKey } },
        { returnDocument: 'after', session },
      );
      if (!reversed) throw new AppError(409, 'ADVANCE_REVERSAL_CONFLICT', 'Advance changed before the reversal completed');
      await SupplierLedgerEntry.create([{ supplierId: advance.supplierId, eventAt: input.eventAt, type: 'ADVANCE_ISSUE_REVERSAL', payableDeltaCents: 0, advanceDeltaCents: -advance.issuedCents, referenceType: 'SupplierAdvance', referenceId: advance._id, description: input.reason, createdBy: actor.id }], { session });
      await createCashMovement({ idempotencyKey: `${input.idempotencyKey}:cash`, accountId: advance.accountId, shiftId: reversalShift?._id, eventAt: input.eventAt, type: 'REVERSAL', signedAmountCents: advance.issuedCents, referenceType: 'SupplierAdvance', referenceId: advance._id, description: input.reason, actorId: actor.id, session });
      await AuditLog.create([{ actorId: actor.id, action: 'SUPPLIER_ADVANCE_REVERSED', entityType: 'SupplierAdvance', entityId: advance._id, reason: input.reason, before: { status: 'ACTIVE' }, after: { status: 'REVERSED' } }], { session });
    });
    return reversed;
  } finally { await session.endSession(); }
}

export async function reverseAdvanceAllocation(allocationId: string, input: { idempotencyKey: string; reason: string; eventAt: Date }, actor: AuthUser) {
  const duplicate = await AdvanceAllocation.findOne({ reversalIdempotencyKey: input.idempotencyKey });
  if (duplicate) return duplicate;
  const session = await mongoose.startSession();
  try {
    let reversed: any;
    await session.withTransaction(async () => {
      const allocation = await AdvanceAllocation.findOne({ _id: allocationId, reversedAt: { $exists: false } }).session(session);
      if (!allocation) throw new AppError(404, 'ACTIVE_ALLOCATION_NOT_FOUND', 'Active advance allocation not found');
      const purchase = await Purchase.findOneAndUpdate({ _id: allocation.purchaseId, reversedAt: { $exists: false }, $expr: { $lte: [{ $add: ['$outstandingCents', allocation.amountCents] }, '$totalCents'] } }, [{ $set: { outstandingCents: { $add: ['$outstandingCents', allocation.amountCents] }, advanceAppliedCents: { $subtract: ['$advanceAppliedCents', allocation.amountCents] } } }, { $set: { paymentStatus: { $cond: [{ $eq: ['$outstandingCents', '$totalCents'] }, 'UNPAID', 'PARTIALLY_PAID'] } } }], { returnDocument: 'after', session, updatePipeline: true });
      if (!purchase) throw new AppError(409, 'ALLOCATION_REVERSAL_CONFLICT', 'Purchase balance no longer permits allocation reversal');
      const advance = await SupplierAdvance.findOneAndUpdate({ _id: allocation.advanceId, allocatedCents: { $gte: allocation.amountCents }, status: { $ne: 'REVERSED' } }, { $inc: { allocatedCents: -allocation.amountCents } }, { returnDocument: 'after', session });
      if (!advance) throw new AppError(409, 'ALLOCATION_REVERSAL_CONFLICT', 'Advance balance no longer permits allocation reversal');
      reversed = await AdvanceAllocation.findOneAndUpdate({ _id: allocationId, reversedAt: { $exists: false } }, { $set: { reversedAt: input.eventAt, reversedBy: actor.id, reversalReason: input.reason, reversalIdempotencyKey: input.idempotencyKey } }, { returnDocument: 'after', session });
      if (!reversed) throw new AppError(409, 'ALLOCATION_REVERSAL_CONFLICT', 'Allocation was already reversed');
      await SupplierLedgerEntry.create([{ supplierId: advance.supplierId, eventAt: input.eventAt, type: 'ADVANCE_ALLOCATION_REVERSAL', payableDeltaCents: allocation.amountCents, advanceDeltaCents: allocation.amountCents, referenceType: 'AdvanceAllocation', referenceId: allocation._id, description: input.reason, createdBy: actor.id }], { session });
      await AuditLog.create([{ actorId: actor.id, action: 'ADVANCE_ALLOCATION_REVERSED', entityType: 'AdvanceAllocation', entityId: allocation._id, reason: input.reason, before: { reversedAt: null }, after: { reversedAt: input.eventAt } }], { session });
    });
    return reversed;
  } finally { await session.endSession(); }
}

export async function createCompanyInvoice(input: { idempotencyKey: string; dispatchId: string; issuedAt: Date; notes?: string | undefined }, actor: AuthUser) {
  const existing = await CompanyInvoice.findOne({ $or: [{ idempotencyKey: input.idempotencyKey }, { dispatchId: input.dispatchId }] });
  if (existing) return existing;
  const session = await mongoose.startSession();
  try {
    let invoice: any;
    await session.withTransaction(async () => {
      const dispatch = await DispatchBatch.findOne({ _id: input.dispatchId, status: { $in: ['CONFIRMED', 'FINALIZED'] }, revenueCents: { $gte: 0 }, acceptedKgMilli: { $gte: 0 }, sellingRateCentsPerKg: { $gte: 0 } }).session(session);
      if (!dispatch) throw new AppError(409, 'DISPATCH_NOT_INVOICEABLE', 'Dispatch requires confirmed company quantity and rate');
      const sequence = await nextCounter('company-invoice', session);
      [invoice] = await CompanyInvoice.create([{ invoiceNumber: `INV-${String(sequence).padStart(6, '0')}`, ...input, buyerId: dispatch.buyerId, totalCents: dispatch.revenueCents, outstandingCents: dispatch.revenueCents, status: dispatch.revenueCents === 0 ? 'PAID' : 'UNPAID', createdBy: actor.id }], { session });
      if (dispatch.status === 'CONFIRMED') await DispatchBatch.updateOne({ _id: dispatch._id, status: 'CONFIRMED' }, { $set: { status: 'FINALIZED' } }, { session });
      await BuyerLedgerEntry.create([{ buyerId: dispatch.buyerId, eventAt: input.issuedAt, type: 'SALE_RECEIVABLE', receivableDeltaCents: dispatch.revenueCents, referenceType: 'CompanyInvoice', referenceId: invoice._id, description: input.notes, createdBy: actor.id }], { session });
      await AuditLog.create([{ actorId: actor.id, action: 'COMPANY_INVOICE_CREATED', entityType: 'CompanyInvoice', entityId: invoice._id, reason: input.notes ?? 'Dispatch sale invoiced', after: { dispatchId: input.dispatchId, invoiceNumber: invoice.invoiceNumber, totalCents: invoice.totalCents } }], { session });
    });
    return invoice;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const duplicate = await CompanyInvoice.findOne({ $or: [{ idempotencyKey: input.idempotencyKey }, { dispatchId: input.dispatchId }] });
      if (duplicate) return duplicate;
    }
    throw error;
  } finally { await session.endSession(); }
}

export async function postCompanySettlement(input: { idempotencyKey: string; invoiceId: string; amountCents: number; accountId: string; paymentMethod: PaymentMethod; eventAt: Date; referenceNumber?: string | undefined; description?: string | undefined }, actor: AuthUser) {
  const existing = await CompanySettlement.findOne({ idempotencyKey: input.idempotencyKey });
  if (existing) return existing;
  const session = await mongoose.startSession();
  try {
    let settlement: any;
    await session.withTransaction(async () => {
      await requireAccount(input.accountId, input.paymentMethod, session);
      const shift = await requireShift(input.paymentMethod, input.accountId, actor, session);
      const invoice = await CompanyInvoice.findOneAndUpdate({ _id: input.invoiceId, outstandingCents: { $gte: input.amountCents } }, [{ $set: { outstandingCents: { $subtract: ['$outstandingCents', input.amountCents] } } }, { $set: { status: { $cond: [{ $eq: ['$outstandingCents', 0] }, 'PAID', 'PARTIALLY_PAID'] } } }], { returnDocument: 'after', session, updatePipeline: true });
      if (!invoice) throw new AppError(409, 'INVOICE_SETTLEMENT_CONFLICT', 'Invoice has insufficient outstanding receivable');
      const sequence = await nextCounter('company-receipt', session);
      [settlement] = await CompanySettlement.create([{ receiptNumber: `CRV-${String(sequence).padStart(6, '0')}`, ...input, buyerId: invoice.buyerId, shiftId: shift?._id, receivedBy: actor.id }], { session });
      await BuyerLedgerEntry.create([{ buyerId: invoice.buyerId, eventAt: input.eventAt, type: 'PAYMENT_RECEIVED', receivableDeltaCents: -input.amountCents, referenceType: 'CompanySettlement', referenceId: settlement._id, description: input.description, createdBy: actor.id }], { session });
      await createCashMovement({ idempotencyKey: `${input.idempotencyKey}:cash`, accountId: input.accountId, shiftId: shift?._id, eventAt: input.eventAt, type: 'COMPANY_RECEIPT', signedAmountCents: input.amountCents, referenceType: 'CompanySettlement', referenceId: settlement._id, description: input.description, actorId: actor.id, session });
      await AuditLog.create([{ actorId: actor.id, action: 'COMPANY_SETTLEMENT_POSTED', entityType: 'CompanySettlement', entityId: settlement._id, reason: input.description ?? 'Company receipt', after: { invoiceId: input.invoiceId, amountCents: input.amountCents } }], { session });
    });
    return settlement;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const duplicate = await CompanySettlement.findOne({ idempotencyKey: input.idempotencyKey });
      if (duplicate) return duplicate;
    }
    throw error;
  } finally { await session.endSession(); }
}

export async function reverseCompanySettlement(settlementId: string, input: { idempotencyKey: string; reason: string; eventAt: Date }, actor: AuthUser) {
  const duplicate = await CompanySettlement.findOne({ reversalIdempotencyKey: input.idempotencyKey });
  if (duplicate) return duplicate;
  const session = await mongoose.startSession();
  try {
    let reversed: any;
    await session.withTransaction(async () => {
      const settlement = await CompanySettlement.findOne({ _id: settlementId, status: 'POSTED' }).session(session);
      if (!settlement) throw new AppError(404, 'POSTED_SETTLEMENT_NOT_FOUND', 'Posted company settlement not found');
      const reversalShift = await requireShift(settlement.paymentMethod, String(settlement.accountId), actor, session);
      const invoice = await CompanyInvoice.findOneAndUpdate({ _id: settlement.invoiceId, $expr: { $lte: [{ $add: ['$outstandingCents', settlement.amountCents] }, '$totalCents'] } }, [{ $set: { outstandingCents: { $add: ['$outstandingCents', settlement.amountCents] } } }, { $set: { status: { $cond: [{ $eq: ['$outstandingCents', '$totalCents'] }, 'UNPAID', 'PARTIALLY_PAID'] } } }], { returnDocument: 'after', session, updatePipeline: true });
      if (!invoice) throw new AppError(409, 'SETTLEMENT_REVERSAL_CONFLICT', 'Invoice balance no longer permits this reversal');
      reversed = await CompanySettlement.findOneAndUpdate({ _id: settlementId, status: 'POSTED' }, { $set: { status: 'REVERSED', reversedAt: input.eventAt, reversedBy: actor.id, reversalReason: input.reason, reversalIdempotencyKey: input.idempotencyKey } }, { returnDocument: 'after', session });
      if (!reversed) throw new AppError(409, 'SETTLEMENT_REVERSAL_CONFLICT', 'Settlement was already reversed');
      await BuyerLedgerEntry.create([{ buyerId: settlement.buyerId, eventAt: input.eventAt, type: 'PAYMENT_REVERSAL', receivableDeltaCents: settlement.amountCents, referenceType: 'CompanySettlement', referenceId: settlement._id, description: input.reason, createdBy: actor.id }], { session });
      await createCashMovement({ idempotencyKey: `${input.idempotencyKey}:cash`, accountId: settlement.accountId, shiftId: reversalShift?._id, eventAt: input.eventAt, type: 'REVERSAL', signedAmountCents: -settlement.amountCents, referenceType: 'CompanySettlement', referenceId: settlement._id, description: input.reason, actorId: actor.id, session });
      await AuditLog.create([{ actorId: actor.id, action: 'COMPANY_SETTLEMENT_REVERSED', entityType: 'CompanySettlement', entityId: settlement._id, reason: input.reason, before: { status: 'POSTED' }, after: { status: 'REVERSED' } }], { session });
    });
    return reversed;
  } finally { await session.endSession(); }
}
