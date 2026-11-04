import type { ClientSession } from 'mongoose';
import { AppError } from '../http.js';
import { CashBankAccount, CashBankTransaction } from '../models.js';

export type CashMovementInput = {
  idempotencyKey: string;
  accountId: unknown;
  shiftId?: unknown;
  eventAt: Date;
  type: string;
  signedAmountCents: number;
  referenceType: string;
  referenceId: unknown;
  description?: string | undefined;
  actorId: string;
};

/** Every ordinary cash/bank posting must use this inside its enclosing MongoDB transaction. */
export async function postCashBankMovement(input: CashMovementInput, session: ClientSession) {
  if (!Number.isSafeInteger(input.signedAmountCents)) throw new AppError(422, 'INVALID_CASH_MOVEMENT', 'Cash movement must be a safe integer amount');
  // This write serializes competing postings to the same account before the ledger sum is read.
  const account = await CashBankAccount.findOneAndUpdate(
    { _id: input.accountId }, { $inc: { ledgerVersion: 1 } }, { returnDocument: 'after', session },
  );
  if (!account) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Cash/bank account not found');
  const [balance] = await CashBankTransaction.aggregate([
    { $match: { accountId: account._id } },
    { $group: { _id: null, cents: { $sum: '$signedAmountCents' } } },
  ]).session(session);
  const currentCents = balance?.cents ?? 0;
  const nextCents = currentCents + input.signedAmountCents;
  const limitCents = account.type === 'BANK' ? (account.overdraftLimitCents ?? 0) : 0;
  if (!Number.isSafeInteger(nextCents) || nextCents < -limitCents) throw new AppError(409, 'INSUFFICIENT_ACCOUNT_BALANCE', `Posting would exceed the ${account.type.toLowerCase()} account's available balance`);
  const [movement] = await CashBankTransaction.create([{ ...input, accountId: account._id, createdBy: input.actorId }], { session });
  return movement;
}
