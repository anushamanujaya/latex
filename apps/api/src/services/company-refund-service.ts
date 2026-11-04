import mongoose from 'mongoose';
import { AppError, type AuthUser } from '../http.js';
import { AuditLog, BuyerLedgerEntry, CashBankAccount, CashierShift, CompanyInvoice, CompanyRefund, Counter } from '../models.js';
import { consumeApproval } from './approval-service.js';
import { postCashBankMovement } from './cash-bank-policy.js';

export type RefundInput={idempotencyKey:string;invoiceId:string;amountCents:number;accountId:string;paymentMethod:'CASH'|'BANK';eventAt:Date;reason:string;approvalId:string};
export function refundApprovalPayload(input:Omit<RefundInput,'idempotencyKey'|'approvalId'>):Record<string,unknown>{
  return {invoiceId:input.invoiceId,amountCents:input.amountCents,accountId:input.accountId,paymentMethod:input.paymentMethod,eventAt:input.eventAt.toISOString(),reason:input.reason};
}

export async function postCompanyRefund(input:RefundInput,actor:AuthUser){
  if(!Number.isSafeInteger(input.amountCents)||input.amountCents<=0)throw new AppError(422,'INVALID_REFUND_AMOUNT','Refund must be a positive safe integer amount');
  const existing=await CompanyRefund.findOne({idempotencyKey:input.idempotencyKey});
  if(existing){if(String(existing.invoiceId)!==input.invoiceId||existing.amountCents!==input.amountCents||String(existing.accountId)!==input.accountId||existing.paymentMethod!==input.paymentMethod||existing.reason!==input.reason||new Date(existing.eventAt).getTime()!==input.eventAt.getTime())throw new AppError(409,'IDEMPOTENCY_KEY_CONFLICT','Refund key belongs to different financial details');return existing;}
  const session=await mongoose.startSession();try{let refund:any;await session.withTransaction(async()=>{
    const account=await CashBankAccount.findOne({_id:input.accountId,active:true,type:input.paymentMethod}).session(session);
    if(!account)throw new AppError(404,'ACCOUNT_NOT_FOUND','Active matching refund account not found');
    const shift=input.paymentMethod==='CASH'?await CashierShift.findOne({cashierId:actor.id,accountId:input.accountId,status:'OPEN'}).session(session):null;
    if(input.paymentMethod==='CASH'&&!shift)throw new AppError(409,'SHIFT_REQUIRED','Open a cashier shift for the refund account');
    await consumeApproval({approvalId:input.approvalId,operation:'COMPANY_REFUND',targetId:input.invoiceId,payload:refundApprovalPayload(input)},actor,session);
    const invoice=await CompanyInvoice.findOneAndUpdate({_id:input.invoiceId,refundDueCents:{$gte:input.amountCents}},[{$set:{refundDueCents:{$subtract:['$refundDueCents',input.amountCents]}}},{$set:{status:{$cond:[{$gt:['$refundDueCents',0]},'REFUND_DUE','PAID']}}}],{returnDocument:'after',session,updatePipeline:true});
    if(!invoice)throw new AppError(409,'REFUND_EXCEEDS_CREDIT','Refund exceeds the approved company credit still due');
    const sequence=await Counter.findOneAndUpdate({key:'company-refund'},{$inc:{value:1}},{upsert:true,returnDocument:'after',session});
    if(!sequence)throw new AppError(500,'COUNTER_ERROR','Could not allocate refund number');
    [refund]=await CompanyRefund.create([{refundNumber:`RFD-${String(sequence.value).padStart(6,'0')}`,...input,buyerId:invoice.buyerId,shiftId:shift?._id,createdBy:actor.id}],{session});
    await postCashBankMovement({idempotencyKey:`${input.idempotencyKey}:cash`,accountId:account._id,shiftId:shift?._id,eventAt:input.eventAt,type:'COMPANY_REFUND',signedAmountCents:-input.amountCents,referenceType:'CompanyRefund',referenceId:refund._id,description:input.reason,actorId:actor.id},session);
    await BuyerLedgerEntry.create([{buyerId:invoice.buyerId,eventAt:input.eventAt,type:'REFUND',receivableDeltaCents:input.amountCents,referenceType:'CompanyRefund',referenceId:refund._id,description:input.reason,createdBy:actor.id}],{session});
    await AuditLog.create([{actorId:actor.id,action:'COMPANY_REFUND_POSTED',entityType:'CompanyRefund',entityId:refund._id,reason:input.reason,after:{invoiceId:input.invoiceId,amountCents:input.amountCents,accountId:input.accountId,approvalId:input.approvalId}}],{session});
  });return refund;}catch(error){if((error as {code?:number}).code===11000){const duplicate=await CompanyRefund.findOne({idempotencyKey:input.idempotencyKey});if(duplicate){if(String(duplicate.invoiceId)!==input.invoiceId||duplicate.amountCents!==input.amountCents||String(duplicate.accountId)!==input.accountId||duplicate.paymentMethod!==input.paymentMethod||duplicate.reason!==input.reason||new Date(duplicate.eventAt).getTime()!==input.eventAt.getTime())throw new AppError(409,'IDEMPOTENCY_KEY_CONFLICT','Refund key belongs to different financial details');return duplicate;}}throw error;}finally{await session.endSession();}
}
