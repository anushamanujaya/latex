import { createHash } from 'node:crypto';
import mongoose, { type ClientSession } from 'mongoose';
import { AppError, type AuthUser } from '../http.js';
import { ApprovalRequest, AuditLog } from '../models.js';

export type ApprovalOperation = 'COMPANY_REFUND' | 'PURCHASE_CORRECTION' | 'DISPATCH_RECONCILIATION' | 'DISPATCH_ADJUSTMENT' | 'REVERSAL' | 'BANK_OVERDRAFT' | 'BACKDATED_FINANCIAL_CHANGE';
export type ReversalKind = 'SUPPLIER_PAYMENT' | 'ADVANCE_REPAYMENT' | 'SUPPLIER_ADVANCE' | 'ADVANCE_ALLOCATION' | 'COMPANY_SETTLEMENT' | 'EXPENSE' | 'CASH_TRANSFER' | 'DISPATCH_ADJUSTMENT';
export type ReversalInput = { idempotencyKey: string; reason: string; eventAt: Date; approvalId: string };

export function requireFinancialRole(actor: AuthUser, roles: AuthUser['role'][] = ['ADMIN', 'ACCOUNTANT']) {
  if (!roles.includes(actor.role)) throw new AppError(403, 'FORBIDDEN', 'Insufficient financial permission');
}

export function reversalApprovalPayload(kind: ReversalKind, targetId: string, input: Omit<ReversalInput, 'approvalId'>, sourceUpdatedAt: Date): Record<string, unknown> {
  return { kind, targetId, idempotencyKey: input.idempotencyKey, reason: input.reason, eventAt: input.eventAt.toISOString(), sourceUpdatedAt: sourceUpdatedAt.toISOString() };
}

export async function consumeReversalApproval(kind: ReversalKind, targetId: string, input: ReversalInput, sourceUpdatedAt: Date, actor: AuthUser, session: ClientSession) {
  requireFinancialRole(actor);
  return consumeApproval({ approvalId: input.approvalId, operation: 'REVERSAL', targetId, payload: reversalApprovalPayload(kind, targetId, input, sourceUpdatedAt) }, actor, session);
}

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([,part])=>part!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,part])=>[key,canonical(part)]));
  return value;
}
export function approvalPayloadHash(payload: Record<string, unknown>) {
  return createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
}

function matchingApprovalRequest(existing:any,input:{operation:ApprovalOperation;targetId:string;requestReason:string},payloadHash:string,actor:AuthUser){
  if(existing.operation!==input.operation||String(existing.targetId)!==input.targetId||existing.payloadHash!==payloadHash||existing.requestReason!==input.requestReason||String(existing.requestedBy)!==actor.id)throw new AppError(409,'IDEMPOTENCY_KEY_CONFLICT','Approval key was used for another request');
  return existing;
}

export async function requestApproval(input:{idempotencyKey:string;operation:ApprovalOperation;targetId:string;payload:Record<string,unknown>;requestReason:string},actor:AuthUser){
  requireFinancialRole(actor, ['ADMIN', 'MANAGER', 'ACCOUNTANT']);
  const existing=await ApprovalRequest.findOne({idempotencyKey:input.idempotencyKey});
  const payloadHash=approvalPayloadHash(input.payload);
  if(existing)return matchingApprovalRequest(existing,input,payloadHash,actor);
  const session=await mongoose.startSession();try{let request:any;await session.withTransaction(async()=>{
    [request]=await ApprovalRequest.create([{...input,payloadHash,requestedBy:actor.id}],{session});
    await AuditLog.create([{actorId:actor.id,action:'APPROVAL_REQUESTED',entityType:'ApprovalRequest',entityId:request._id,reason:input.requestReason,after:{operation:input.operation,targetId:input.targetId,payloadHash}}],{session});
  });return request;}catch(error){if((error as {code?:number}).code===11000){const duplicate=await ApprovalRequest.findOne({idempotencyKey:input.idempotencyKey});if(duplicate)return matchingApprovalRequest(duplicate,input,payloadHash,actor);}throw error;}finally{await session.endSession();}
}

export async function decideApproval(approvalId:string,input:{approve:boolean;reason:string},actor:AuthUser){
  requireFinancialRole(actor);
  const session=await mongoose.startSession();try{let decided:any;await session.withTransaction(async()=>{
    const request=await ApprovalRequest.findOne({_id:approvalId,status:'REQUESTED'}).session(session);
    if(!request)throw new AppError(404,'APPROVAL_REQUEST_NOT_PENDING','Pending approval request not found');
    if(String(request.requestedBy)===actor.id)throw new AppError(403,'SELF_APPROVAL_FORBIDDEN','The maker cannot approve or reject their own request');
    decided=await ApprovalRequest.findOneAndUpdate({_id:approvalId,status:'REQUESTED'},{$set:{status:input.approve?'APPROVED':'REJECTED',decidedBy:actor.id,decidedAt:new Date(),decisionReason:input.reason}},{returnDocument:'after',session});
    if(!decided)throw new AppError(409,'APPROVAL_DECISION_CONFLICT','Approval was already decided');
    await AuditLog.create([{actorId:actor.id,action:input.approve?'APPROVAL_APPROVED':'APPROVAL_REJECTED',entityType:'ApprovalRequest',entityId:request._id,reason:input.reason,before:{status:'REQUESTED'},after:{status:decided.status}}],{session});
  });return decided;}finally{await session.endSession();}
}

export async function cancelApproval(approvalId:string,reason:string,actor:AuthUser){
  requireFinancialRole(actor, ['ADMIN', 'MANAGER', 'ACCOUNTANT']);
  const session=await mongoose.startSession();try{let cancelled:any;await session.withTransaction(async()=>{
    const request=await ApprovalRequest.findOne({_id:approvalId,status:'REQUESTED',requestedBy:actor.id}).session(session);
    if(!request)throw new AppError(404,'CANCELLABLE_APPROVAL_NOT_FOUND','Only the maker can cancel a pending request');
    cancelled=await ApprovalRequest.findOneAndUpdate({_id:approvalId,status:'REQUESTED',requestedBy:actor.id},{$set:{status:'CANCELLED',decidedBy:actor.id,decidedAt:new Date(),decisionReason:reason}},{returnDocument:'after',session});
    if(!cancelled)throw new AppError(409,'APPROVAL_DECISION_CONFLICT','Approval was already decided');
    await AuditLog.create([{actorId:actor.id,action:'APPROVAL_CANCELLED',entityType:'ApprovalRequest',entityId:request._id,reason,before:{status:'REQUESTED'},after:{status:'CANCELLED'}}],{session});
  });return cancelled;}finally{await session.endSession();}
}

export async function consumeApproval(input:{approvalId:string;operation:ApprovalOperation;targetId:string;payload:Record<string,unknown>;executionReferenceId?:unknown},actor:AuthUser,session:ClientSession){
  requireFinancialRole(actor, ['PURCHASE_CORRECTION', 'DISPATCH_RECONCILIATION'].includes(input.operation) ? ['ADMIN', 'MANAGER', 'ACCOUNTANT'] : ['ADMIN', 'ACCOUNTANT']);
  if(!mongoose.isValidObjectId(input.approvalId))throw new AppError(409,'APPROVAL_REQUIRED','A valid independently approved request is required');
  const hash=approvalPayloadHash(input.payload);
  const request=await ApprovalRequest.findOneAndUpdate({_id:input.approvalId,operation:input.operation,targetId:input.targetId,payloadHash:hash,status:'APPROVED'},{$set:{status:'EXECUTED',executedBy:actor.id,executedAt:new Date(),executionReferenceId:input.executionReferenceId}},{returnDocument:'after',session});
  if(!request)throw new AppError(409,'APPROVAL_REQUIRED','An independently approved request for these exact financial details is required');
  if(String(request.requestedBy)===String(request.decidedBy))throw new AppError(409,'INVALID_APPROVAL','Maker and checker cannot be the same user');
  await AuditLog.create([{actorId:actor.id,action:'APPROVAL_EXECUTED',entityType:'ApprovalRequest',entityId:request._id,reason:`Executed ${input.operation}`,before:{status:'APPROVED'},after:{status:'EXECUTED',executionReferenceId:input.executionReferenceId}}],{session});
  return request;
}
