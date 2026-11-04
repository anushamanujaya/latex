import mongoose from 'mongoose';
import { AppError, type AuthUser } from '../http.js';
import { AuditLog, CashBankAccount } from '../models.js';
import { consumeApproval } from './approval-service.js';

export function overdraftApprovalPayload(accountId: string, limitCents: number, reason: string): Record<string, unknown> {
  return { accountId, limitCents, reason };
}

export async function configureBankOverdraft(input: { accountId: string; limitCents: number; reason: string; approvalId: string }, actor: AuthUser) {
  if (!Number.isSafeInteger(input.limitCents) || input.limitCents < 0) throw new AppError(422, 'INVALID_OVERDRAFT_LIMIT', 'Overdraft limit must be a nonnegative safe integer');
  const session = await mongoose.startSession();
  try {
    let account: any;
    await session.withTransaction(async () => {
      await consumeApproval({ approvalId: input.approvalId, operation: 'BANK_OVERDRAFT', targetId: input.accountId, payload: overdraftApprovalPayload(input.accountId, input.limitCents, input.reason) }, actor, session);
      const before = await CashBankAccount.findOne({ _id: input.accountId, type: 'BANK', active: true }).session(session);
      if (!before) throw new AppError(404, 'BANK_ACCOUNT_NOT_FOUND', 'Active bank account not found');
      account = await CashBankAccount.findOneAndUpdate({ _id: before._id }, { $set: { overdraftLimitCents: input.limitCents, overdraftApprovedBy: actor.id, overdraftApprovedAt: new Date(), overdraftReason: input.reason }, $inc: { ledgerVersion: 1 } }, { returnDocument: 'after', session });
      await AuditLog.create([{ actorId: actor.id, action: 'BANK_OVERDRAFT_CONFIGURED', entityType: 'CashBankAccount', entityId: account._id, reason: input.reason, before: { overdraftLimitCents: before.overdraftLimitCents ?? 0 }, after: { overdraftLimitCents: input.limitCents, approvalId: input.approvalId } }], { session });
    });
    return account;
  } finally { await session.endSession(); }
}
