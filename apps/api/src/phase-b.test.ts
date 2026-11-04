import { randomUUID } from 'node:crypto';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { connectDatabase,disconnectDatabase } from './db.js';
import type { AuthUser } from './http.js';
import { BuyerCompany,BuyerLedgerEntry,CashBankAccount,CashBankTransaction,CashBankTransfer,CashierShift,CompanyInvoice,CompanyInvoiceAdjustment,CompanyRefund,DensityFactorVersion,DispatchBatch,DispatchFinancialAdjustment,Expense,Purchase,PurchaseCorrection,PurchaseRate,Supplier,SupplierLedgerEntry,SupplierPayment,User } from './models.js';
import { confirmDispatchDraft,createDispatchDraft,previewDispatch,reconcileDispatch as reconcileDispatchService,reconciliationApprovalPayload } from './services/dispatch-service.js';
import { dispatchAdjustmentApprovalPayload,payExpense,postDispatchAdjustment as postDispatchAdjustmentService,postExpense,postTransfer,reverseDispatchAdjustment,reverseExpense,reverseTransfer } from './services/phase-b-financial-service.js';
import { createCompanyInvoice,postCompanySettlement,postSupplierPayment } from './services/financial-service.js';
import { correctPurchase as correctPurchaseService,purchaseCorrectionApprovalPayload } from './services/purchase-correction-service.js';
import { createPurchase } from './services/purchase-service.js';
import { decideApproval,requestApproval,reversalApprovalPayload,type ReversalInput,type ReversalKind } from './services/approval-service.js';
import { postCompanyRefund,refundApprovalPayload } from './services/company-refund-service.js';
import { configureBankOverdraft,overdraftApprovalPayload } from './services/overdraft-service.js';

const enabled=process.env.RUN_PHASE_B_INTEGRATION==='true';
describe.runIf(enabled)('Phase B dispatch and correction transactions',()=>{
  const marker=randomUUID().slice(0,8);const location=`B-${marker}`;const densityVersion=Date.now()+Number.parseInt(marker.slice(0,4),16);let actor:AuthUser;let checker:AuthUser;let buyerId:string;let supplierId:string;let dispatchId:string;let rateSourceId:string;
  beforeAll(async()=>{await connectDatabase();const user=await User.create({name:`Phase B ${marker}`,email:`phase-b-${marker}@test.local`,passwordHash:'not-used',role:'ADMIN',active:true});actor={id:String(user._id),name:user.name,role:'ADMIN'};const checkerUser=await User.create({name:`Checker ${marker}`,email:`checker-${marker}@test.local`,passwordHash:'not-used',role:'ACCOUNTANT',active:true});checker={id:String(checkerUser._id),name:checkerUser.name,role:'ACCOUNTANT'};rateSourceId=actor.id;const supplier=await Supplier.create({code:`PB-${marker}`,name:`Phase B Supplier ${marker}`,active:true});supplierId=String(supplier._id);const buyer=await BuyerCompany.create({name:`Phase B Buyer ${marker}`,active:true});buyerId=String(buyer._id);await DensityFactorVersion.create({version:densityVersion,effectiveFrom:new Date('2020-01-01'),entries:[{reading:100,factorMilli:500}],createdBy:user._id,reason:'Phase B test'});const eventAt=new Date('2026-11-01T04:00:00Z');for(const sequence of [1,2]){const purchase=await Purchase.create({billNumber:`PB-${marker}-${sequence}`,idempotencyKey:randomUUID(),locationId:location,sequence,supplierId,eventAt,densityReading:100,densityVersion,factorMilli:500,litresMilli:1_000_000,kgMilli:500_000,rateCentsPerKg:82_000,rateSourceId:user._id,subtotalCents:41_000_000,adjustmentCents:0,totalCents:41_000_000,cashPaidCents:0,advanceAppliedCents:0,outstandingCents:41_000_000,paymentStatus:'UNPAID',dispatchStatus:'PENDING',operatorId:user._id});await SupplierLedgerEntry.create({supplierId,eventAt,type:'PURCHASE_OBLIGATION',payableDeltaCents:purchase.totalCents,advanceDeltaCents:0,referenceType:'Purchase',referenceId:purchase._id,createdBy:user._id});}});
  afterAll(async()=>{if(enabled)await disconnectDatabase();});

  async function reconcileDispatch(input:any,by:AuthUser){const {approvedBy:_,...details}=input;const current=await DispatchBatch.findById(details.dispatchId).lean();const approval=await requestApproval({idempotencyKey:randomUUID(),operation:'DISPATCH_RECONCILIATION',targetId:details.dispatchId,payload:reconciliationApprovalPayload(details,current!.updatedAt),requestReason:details.discrepancyReason??'Company weighbridge reconciliation'},by);await decideApproval(String(approval._id),{approve:true,reason:'Independent weighbridge approval'},checker);return reconcileDispatchService({...details,approvalId:String(approval._id)},by);}
  async function correctPurchase(purchaseId:string,input:any,by:AuthUser){const {approvedBy:_,...details}=input;const existing=await PurchaseCorrection.findOne({idempotencyKey:details.idempotencyKey});if(existing)return correctPurchaseService(purchaseId,{...details,approvalId:'retry'},by);const current=await Purchase.findById(purchaseId).lean();const approval=await requestApproval({idempotencyKey:randomUUID(),operation:'PURCHASE_CORRECTION',targetId:purchaseId,payload:purchaseCorrectionApprovalPayload(purchaseId,details,current!.updatedAt),requestReason:details.reason},by);await decideApproval(String(approval._id),{approve:true,reason:'Independent purchase correction approval'},checker);return correctPurchaseService(purchaseId,{...details,approvalId:String(approval._id)},by);}
  async function postDispatchAdjustment(input:any,by:AuthUser){const current=await DispatchBatch.findById(input.dispatchId).lean();const approval=await requestApproval({idempotencyKey:randomUUID(),operation:'DISPATCH_ADJUSTMENT',targetId:input.dispatchId,payload:dispatchAdjustmentApprovalPayload(input,current!.updatedAt),requestReason:input.reason},by);await decideApproval(String(approval._id),{approve:true,reason:'Independent batch profit review'},checker);return postDispatchAdjustmentService({...input,approvalId:String(approval._id)},by);}
  async function approvedReversal(kind:ReversalKind,targetId:string,input:Omit<ReversalInput,'approvalId'>,model:any):Promise<ReversalInput>{const source=await model.findById(targetId).lean();const approval=await requestApproval({idempotencyKey:randomUUID(),operation:'REVERSAL',targetId,payload:reversalApprovalPayload(kind,targetId,input,source.updatedAt),requestReason:input.reason},actor);await decideApproval(String(approval._id),{approve:true,reason:'Independent reversal check'},checker);return {...input,approvalId:String(approval._id)};}

  it('uses inclusive sequence ordering even when timestamps are identical',async()=>{const preview=await previewDispatch(location,2);expect(preview.purchases.map(p=>p.sequence)).toEqual([1,2]);expect(preview.totals).toEqual({litresMilli:2_000_000,kgMilli:1_000_000,purchaseCostCents:82_000_000});});
  it('rejects a stale draft when purchase quantity changes without changing its cost',async()=>{
    const draftLocation=`STALE-${marker}`;
    const purchase=await Purchase.create({billNumber:`STALE-${marker}`,idempotencyKey:randomUUID(),locationId:draftLocation,sequence:1,supplierId,eventAt:new Date(),densityReading:100,densityVersion,factorMilli:500,litresMilli:100_000,kgMilli:50_000,rateCentsPerKg:82_000,rateSourceId,subtotalCents:4_100_000,adjustmentCents:0,totalCents:4_100_000,cashPaidCents:0,advanceAppliedCents:0,outstandingCents:4_100_000,paymentStatus:'UNPAID',dispatchStatus:'PENDING',operatorId:actor.id});
    const draft=await createDispatchDraft({idempotencyKey:randomUUID(),locationId:draftLocation,lastSequence:1,buyerId,vehicleNumber:'STALE-BOWSER',dispatchedAt:new Date()},actor);
    await expect(createDispatchDraft({idempotencyKey:draft.idempotencyKey,locationId:draftLocation,lastSequence:1,buyerId,vehicleNumber:'DIFFERENT-BOWSER',dispatchedAt:new Date()},actor)).rejects.toMatchObject({code:'IDEMPOTENCY_KEY_CONFLICT'});
    await Purchase.updateOne({_id:purchase._id},{$set:{kgMilli:51_000}});
    await expect(confirmDispatchDraft(String(draft._id),randomUUID(),actor)).rejects.toMatchObject({code:'DRAFT_STALE'});
    expect((await Purchase.findById(purchase._id).lean())?.dispatchStatus).toBe('PENDING');
  });
  it('allows only one concurrent confirmation and keeps retry idempotent',async()=>{const [a,b]=await Promise.all([createDispatchDraft({idempotencyKey:randomUUID(),locationId:location,lastSequence:2,buyerId,vehicleNumber:'TEST-A',dispatchedAt:new Date()},actor),createDispatchDraft({idempotencyKey:randomUUID(),locationId:location,lastSequence:2,buyerId,vehicleNumber:'TEST-B',dispatchedAt:new Date()},actor)]);const keyA=randomUUID(),keyB=randomUUID();const results=await Promise.allSettled([confirmDispatchDraft(String(a._id),keyA,actor),confirmDispatchDraft(String(b._id),keyB,actor)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);const winner=results.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<any>;dispatchId=String(winner.value._id);const retry=await confirmDispatchDraft(dispatchId,winner.value.confirmationIdempotencyKey,actor);expect(String(retry._id)).toBe(dispatchId);expect(await Purchase.countDocuments({locationId:location,dispatchId})).toBe(2);expect(await DispatchBatch.countDocuments({locationId:location,status:'CONFIRMED'})).toBe(1);});
  it('reconciles accepted KG and computes exact auditable profit',async()=>{const dispatch=await reconcileDispatch({idempotencyKey:randomUUID(),dispatchId,eventAt:new Date(),acceptedKgMilli:980_000,sellingRateCentsPerKg:90_000,weighbridgeReference:`WB-${marker}`,discrepancyReason:'Company scale accepted lower weight',approvedBy:actor.id},actor);expect(dispatch).toMatchObject({quantityVarianceMilli:-20_000,quantityVarianceBasisPoints:-200,revenueCents:88_200_000,grossProfitCents:6_200_000,netProfitCents:6_200_000,costPerAcquiredKgCents:82_000});});
  it('deducts each direct expense once but keeps general expenses out of batch profit',async()=>{await postExpense({idempotencyKey:randomUUID(),category:'Transport',description:'Bowser transport',amountCents:500_000,allocationType:'DIRECT_DISPATCH',dispatchId,expenseAt:new Date(),paymentStatus:'UNPAID'},actor);await postExpense({idempotencyKey:randomUUID(),category:'Office',description:'General stationery',amountCents:100_000,allocationType:'GENERAL',expenseAt:new Date(),paymentStatus:'UNPAID'},actor);const dispatch=await DispatchBatch.findById(dispatchId).lean();expect(dispatch?.directExpenseCents).toBe(500_000);expect(dispatch?.netProfitCents).toBe(5_700_000);expect(await Expense.countDocuments({dispatchId,status:'POSTED'})).toBe(1);});
  it('keeps invoices tied to reconciled revenue and receipts out of revenue',async()=>{const invoice=await createCompanyInvoice({idempotencyKey:randomUUID(),dispatchId,issuedAt:new Date()},actor);const bank=await CashBankAccount.create({idempotencyKey:randomUUID(),code:`BANK-${marker}`,name:'Phase B Bank',type:'BANK',openingBalanceCents:0,active:true,createdBy:actor.id});await postCompanySettlement({idempotencyKey:randomUUID(),invoiceId:String(invoice._id),amountCents:10_000_000,accountId:String(bank._id),paymentMethod:'BANK',eventAt:new Date()},actor);await reconcileDispatch({idempotencyKey:randomUUID(),dispatchId,eventAt:new Date(),acceptedKgMilli:990_000,sellingRateCentsPerKg:90_000,weighbridgeReference:`WB-${marker}-2`,discrepancyReason:'Approved corrected weighbridge certificate',approvedBy:actor.id},actor);const amended=await CompanyInvoice.findById(invoice._id).lean();expect(amended?.totalCents).toBe(89_100_000);expect(amended?.outstandingCents).toBe(79_100_000);expect(await CompanyInvoiceAdjustment.countDocuments({invoiceId:invoice._id})).toBe(1);expect((await DispatchBatch.findById(dispatchId).lean())?.revenueCents).toBe(89_100_000);});
  it('rolls back an unexplained company quantity discrepancy',async()=>{const before=await DispatchBatch.findById(dispatchId).lean();const invoice=await CompanyInvoice.findOne({dispatchId}).lean();const adjustmentCount=await CompanyInvoiceAdjustment.countDocuments({dispatchId});await expect(reconcileDispatch({idempotencyKey:randomUUID(),dispatchId,eventAt:new Date(),acceptedKgMilli:1_000,sellingRateCentsPerKg:90_000,weighbridgeReference:`WB-${marker}-credit`,approvedBy:actor.id},actor)).rejects.toMatchObject({code:'DISCREPANCY_REASON_REQUIRED'});expect((await DispatchBatch.findById(dispatchId).lean())?.revenueCents).toBe(before?.revenueCents);expect((await CompanyInvoice.findOne({dispatchId}).lean())?.totalCents).toBe(invoice?.totalCents);expect(await CompanyInvoiceAdjustment.countDocuments({dispatchId})).toBe(adjustmentCount);});
  it('corrects a dispatched purchase through an audited delta while preserving its boundary and invoice',async()=>{
    const original=await Purchase.findOne({locationId:location,sequence:1});
    const before=await DispatchBatch.findById(dispatchId).lean();
    const invoice=await CompanyInvoice.findOne({dispatchId}).lean();
    const key=randomUUID();
    const correctionInput={idempotencyKey:key,supplierId,litresMilli:1_100_000,densityReading:100,rateCentsPerKg:82_000,cashPaidCents:0,advanceApplications:[],reason:'Approved pre-dispatch scale entry correction',approvedBy:actor.id,eventAt:new Date()};
    const correction=await correctPurchase(String(original!._id),correctionInput,actor);
    expect(correction.correctionType).toBe('DISPATCH_ADJUSTMENT');
    expect((await correctPurchase(String(original!._id),correctionInput,actor))._id.toString()).toBe(correction._id.toString());
    const preserved=await Purchase.findById(original!._id).lean();
    const adjusted=await DispatchBatch.findById(dispatchId).lean();
    expect(preserved).toMatchObject({totalCents:41_000_000,correctionDeltaCents:4_100_000,dispatchStatus:'ASSIGNED'});
    expect(adjusted).toMatchObject({firstSequence:before?.firstSequence,lastSequence:before?.lastSequence,acquiredKgMilli:1_050_000,purchaseCostCents:86_100_000,netProfitCents:2_500_000});
    expect((await CompanyInvoice.findOne({dispatchId}).lean())?.totalCents).toBe(invoice?.totalCents);
  });
  it('rejects a dispatched settlement change and rolls back all ledgers',async()=>{
    const original=await Purchase.findOne({locationId:location,sequence:2});
    const before=await DispatchBatch.findById(dispatchId).lean();
    const supplierEntries=await SupplierLedgerEntry.countDocuments({supplierId});
    const cashEntries=await CashBankTransaction.countDocuments();
    const details={idempotencyKey:randomUUID(),supplierId,litresMilli:1_000_000,densityReading:100,rateCentsPerKg:82_000,cashPaidCents:100_000,advanceApplications:[],reason:'Attempted change to settled dispatched cash',eventAt:new Date()};
    await expect(correctPurchase(String(original!._id),details,actor)).rejects.toMatchObject({code:'LOCKED_SETTLEMENT_CHANGE'});
    expect(await PurchaseCorrection.countDocuments({originalPurchaseId:original!._id})).toBe(0);
    expect((await Purchase.findById(original!._id).lean())?.cashPaidCents).toBe(0);
    expect((await DispatchBatch.findById(dispatchId).lean())?.purchaseCostCents).toBe(before?.purchaseCostCents);
    expect(await SupplierLedgerEntry.countDocuments({supplierId})).toBe(supplierEntries);
    expect(await CashBankTransaction.countDocuments()).toBe(cashEntries);
  });
  it('allows only one competing approved purchase correction to post',async()=>{
    const correctionLocation=`RACE-COR-${marker}`;
    const original=await Purchase.create({billNumber:`RACE-COR-${marker}`,idempotencyKey:randomUUID(),locationId:correctionLocation,sequence:1,supplierId,eventAt:new Date(),densityReading:100,densityVersion,factorMilli:500,litresMilli:100_000,kgMilli:50_000,rateCentsPerKg:82_000,rateSourceId,subtotalCents:4_100_000,adjustmentCents:0,totalCents:4_100_000,cashPaidCents:0,advanceAppliedCents:0,outstandingCents:4_100_000,paymentStatus:'UNPAID',dispatchStatus:'PENDING',operatorId:actor.id});
    await SupplierLedgerEntry.create({supplierId,eventAt:original.eventAt,type:'PURCHASE_OBLIGATION',payableDeltaCents:4_100_000,advanceDeltaCents:0,referenceType:'Purchase',referenceId:original._id,createdBy:actor.id});
    const base={supplierId,densityReading:100,rateCentsPerKg:82_000,cashPaidCents:0,advanceApplications:[],reason:'Independent competing quantity correction',eventAt:new Date()};
    const results=await Promise.allSettled([correctPurchase(String(original._id),{...base,idempotencyKey:randomUUID(),litresMilli:120_000},actor),correctPurchase(String(original._id),{...base,idempotencyKey:randomUUID(),litresMilli:130_000},actor)]);
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    const correction=await PurchaseCorrection.findOne({originalPurchaseId:original._id}).lean();
    expect(await PurchaseCorrection.countDocuments({originalPurchaseId:original._id})).toBe(1);
    const replacement=await Purchase.findById(correction?.replacementPurchaseId).lean();
    expect((await Purchase.findById(original._id).lean())?.reversedAt).toBeTruthy();
    const entries=await SupplierLedgerEntry.find({supplierId,referenceId:{$in:[original._id,replacement?._id]}}).lean();
    expect(entries.reduce((sum,item)=>sum+item.payableDeltaCents,0)).toBe(replacement?.outstandingCents);
    expect(await CashBankTransaction.countDocuments({referenceType:'PurchaseCorrection',referenceId:correction?._id})).toBe(0);
  });
  it('applies an invoice credit above collected receipts without changing cash or collected amount',async()=>{
    const before=await CompanyInvoice.findOne({dispatchId}).lean();
    const receiptCount=await CashBankTransaction.countDocuments({type:'COMPANY_RECEIPT'});
    await reconcileDispatch({idempotencyKey:randomUUID(),dispatchId,eventAt:new Date(),acceptedKgMilli:900_000,sellingRateCentsPerKg:90_000,weighbridgeReference:`WB-${marker}-credit-valid`,discrepancyReason:'Approved lower final accepted weight',approvedBy:actor.id},actor);
    const invoice=await CompanyInvoice.findOne({dispatchId}).lean();
    expect(invoice?.totalCents).toBe(81_000_000);
    expect(invoice?.outstandingCents).toBe(71_000_000);
    expect(before!.totalCents-before!.outstandingCents).toBe(invoice!.totalCents-invoice!.outstandingCents);
    expect(await CashBankTransaction.countDocuments({type:'COMPANY_RECEIPT'})).toBe(receiptCount);
  });
  it('tracks credits below receipts and posts independently approved partial and final refunds',async()=>{
    const invoiceBefore=await CompanyInvoice.findOne({dispatchId}).lean();const bank=await CashBankAccount.findOne({code:`BANK-${marker}`}).lean();
    await reconcileDispatch({idempotencyKey:randomUUID(),dispatchId,eventAt:new Date(),acceptedKgMilli:1_000,sellingRateCentsPerKg:90_000,weighbridgeReference:`WB-${marker}-refund`,discrepancyReason:'Approved final company scale certificate',approvedBy:checker.id},actor);
    const invoice=await CompanyInvoice.findById(invoiceBefore!._id).lean();expect(invoice).toMatchObject({totalCents:90_000,outstandingCents:0,refundDueCents:9_910_000,status:'REFUND_DUE'});
    const makeRefund=async(amountCents:number)=>{const base={invoiceId:String(invoice!._id),amountCents,accountId:String(bank!._id),paymentMethod:'BANK' as const,eventAt:new Date(),reason:'Company credit refund after scale correction'};const approval=await requestApproval({idempotencyKey:randomUUID(),operation:'COMPANY_REFUND',targetId:base.invoiceId,payload:refundApprovalPayload(base),requestReason:base.reason},actor);await expect(decideApproval(String(approval._id),{approve:true,reason:'Independent review of company credit'},actor)).rejects.toMatchObject({code:'SELF_APPROVAL_FORBIDDEN'});await decideApproval(String(approval._id),{approve:true,reason:'Independent review of company credit'},checker);const key=randomUUID();const refund=await postCompanyRefund({...base,idempotencyKey:key,approvalId:String(approval._id)},actor);expect(String((await postCompanyRefund({...base,idempotencyKey:key,approvalId:String(approval._id)},actor))._id)).toBe(String(refund._id));await expect(postCompanyRefund({...base,amountCents:amountCents+1,idempotencyKey:key,approvalId:String(approval._id)},actor)).rejects.toMatchObject({code:'IDEMPOTENCY_KEY_CONFLICT'});return refund;};
    await makeRefund(4_000_000);expect((await CompanyInvoice.findById(invoice!._id).lean())?.refundDueCents).toBe(5_910_000);
    await makeRefund(5_910_000);expect((await CompanyInvoice.findById(invoice!._id).lean())?.status).toBe('PAID');expect((await CompanyInvoice.findById(invoice!._id).lean())?.refundDueCents).toBe(0);
    expect(await CompanyRefund.countDocuments({invoiceId:invoice!._id})).toBe(2);
    const [balance]=await BuyerLedgerEntry.aggregate([{$match:{buyerId:invoice!.buyerId}},{$group:{_id:null,cents:{$sum:'$receivableDeltaCents'}}}]);expect(balance.cents).toBe(0);
  });
  it('posts and reverses balanced internal transfers without changing total assets',async()=>{const source=await CashBankAccount.create({idempotencyKey:randomUUID(),code:`SRC-${marker}`,name:'Source Bank',type:'BANK',openingBalanceCents:1_000_000,active:true,createdBy:actor.id});const destination=await CashBankAccount.create({idempotencyKey:randomUUID(),code:`DST-${marker}`,name:'Destination Bank',type:'BANK',openingBalanceCents:0,active:true,createdBy:actor.id});await CashBankTransaction.create({idempotencyKey:randomUUID(),accountId:source._id,eventAt:new Date(),type:'OPENING_ADJUSTMENT',signedAmountCents:1_000_000,referenceType:'CashBankAccount',referenceId:source._id,createdBy:actor.id});const transfer=await postTransfer({idempotencyKey:randomUUID(),sourceAccountId:String(source._id),destinationAccountId:String(destination._id),amountCents:250_000,eventAt:new Date(),referenceNumber:`TR-${marker}`},actor);let total=(await CashBankTransaction.aggregate([{$match:{referenceType:'CashBankTransfer',referenceId:transfer._id}},{$group:{_id:null,cents:{$sum:'$signedAmountCents'}}}]))[0].cents;expect(total).toBe(0);await reverseTransfer(String(transfer._id),await approvedReversal('CASH_TRANSFER',String(transfer._id),{idempotencyKey:randomUUID(),eventAt:new Date(),reason:'Integration reversal'},CashBankTransfer),actor);total=(await CashBankTransaction.aggregate([{$match:{referenceType:'CashBankTransfer',referenceId:transfer._id}},{$group:{_id:null,cents:{$sum:'$signedAmountCents'}}}]))[0].cents;expect(total).toBe(0);});
  it('blocks unapproved overdrafts and respects an independently approved bank limit',async()=>{
    const source=await CashBankAccount.create({idempotencyKey:randomUUID(),code:`OD-S-${marker}`,name:'Overdraft bank',type:'BANK',openingBalanceCents:0,active:true,createdBy:actor.id});
    const target=await CashBankAccount.create({idempotencyKey:randomUUID(),code:`OD-T-${marker}`,name:'Overdraft target',type:'BANK',openingBalanceCents:0,active:true,createdBy:actor.id});
    const transfer=(amountCents:number)=>postTransfer({idempotencyKey:randomUUID(),sourceAccountId:String(source._id),destinationAccountId:String(target._id),amountCents,eventAt:new Date(),referenceNumber:`OD-${marker}`},actor);
    await expect(transfer(100_000)).rejects.toMatchObject({code:'INSUFFICIENT_ACCOUNT_BALANCE'});
    const reason='Approved temporary bank overdraft facility';const payload=overdraftApprovalPayload(String(source._id),300_000,reason);
    const approval=await requestApproval({idempotencyKey:randomUUID(),operation:'BANK_OVERDRAFT',targetId:String(source._id),payload,requestReason:reason},actor);
    await decideApproval(String(approval._id),{approve:true,reason:'Verified bank authorization'},checker);
    await configureBankOverdraft({accountId:String(source._id),limitCents:300_000,reason,approvalId:String(approval._id)},actor);
    await transfer(200_000);await expect(transfer(150_000)).rejects.toMatchObject({code:'INSUFFICIENT_ACCOUNT_BALANCE'});
    const [balance]=await CashBankTransaction.aggregate([{$match:{accountId:source._id}},{$group:{_id:null,cents:{$sum:'$signedAmountCents'}}}]);expect(balance.cents).toBe(-200_000);
  });
  it('voids and replaces an undispatched purchase while reconciling supplier liability',async()=>{const original=await Purchase.create({billNumber:`COR-${marker}`,idempotencyKey:randomUUID(),locationId:location,sequence:3,supplierId,eventAt:new Date(),densityReading:100,densityVersion,factorMilli:500,litresMilli:100_000,kgMilli:50_000,rateCentsPerKg:82_000,rateSourceId,subtotalCents:4_100_000,adjustmentCents:0,totalCents:4_100_000,cashPaidCents:0,advanceAppliedCents:0,outstandingCents:4_100_000,paymentStatus:'UNPAID',dispatchStatus:'PENDING',operatorId:actor.id});await SupplierLedgerEntry.create({supplierId,eventAt:original.eventAt,type:'PURCHASE_OBLIGATION',payableDeltaCents:original.totalCents,advanceDeltaCents:0,referenceType:'Purchase',referenceId:original._id,createdBy:actor.id});const correction=await correctPurchase(String(original._id),{idempotencyKey:randomUUID(),supplierId,litresMilli:120_000,densityReading:100,rateCentsPerKg:82_000,cashPaidCents:0,advanceApplications:[],reason:'Approved volume entry correction',approvedBy:actor.id,eventAt:new Date()},actor);expect(correction.correctionType).toBe('VOID_REPLACE');expect((await Purchase.findById(original._id).lean())?.reversedAt).toBeTruthy();const replacement=await Purchase.findById(correction.replacementPurchaseId).lean();expect(replacement?.totalCents).toBe(4_920_000);expect(await PurchaseCorrection.countDocuments({originalPurchaseId:original._id})).toBe(1);});
  it('carries an already-paid cash purchase into its replacement without inventing cash movements',async()=>{const paidLocation=`PAID-${marker}`;const cash=await CashBankAccount.create({idempotencyKey:randomUUID(),code:`CASH-${marker}`,name:'Correction cash',type:'CASH',openingBalanceCents:0,active:true,createdBy:actor.id});const shift=await CashierShift.create({shiftNumber:`SHF-PB-${marker}`,idempotencyKey:randomUUID(),cashierId:actor.id,accountId:cash._id,locationId:paidLocation,openedAt:new Date(),openingFloatCents:10_000_000,status:'OPEN',openedBy:actor.id});const original=await Purchase.create({billNumber:`PAID-${marker}`,idempotencyKey:randomUUID(),locationId:paidLocation,sequence:1,supplierId,eventAt:new Date(),densityReading:100,densityVersion,factorMilli:500,litresMilli:100_000,kgMilli:50_000,rateCentsPerKg:82_000,rateSourceId,subtotalCents:4_100_000,adjustmentCents:0,totalCents:4_100_000,cashPaidCents:4_100_000,advanceAppliedCents:0,outstandingCents:0,paymentStatus:'PAID',dispatchStatus:'PENDING',operatorId:actor.id});await SupplierLedgerEntry.create([{supplierId,eventAt:original.eventAt,type:'PURCHASE_OBLIGATION',payableDeltaCents:4_100_000,advanceDeltaCents:0,referenceType:'Purchase',referenceId:original._id,createdBy:actor.id},{supplierId,eventAt:original.eventAt,type:'PAYMENT',payableDeltaCents:-4_100_000,advanceDeltaCents:0,referenceType:'Purchase',referenceId:original._id,createdBy:actor.id}]);await CashBankTransaction.create({idempotencyKey:randomUUID(),accountId:cash._id,shiftId:shift._id,eventAt:original.eventAt,type:'PURCHASE_CASH_PAYMENT',signedAmountCents:-4_100_000,referenceType:'Purchase',referenceId:original._id,createdBy:actor.id});const before=await CashBankTransaction.countDocuments({accountId:cash._id});const correction=await correctPurchase(String(original._id),{idempotencyKey:randomUUID(),supplierId,litresMilli:120_000,densityReading:100,rateCentsPerKg:82_000,cashPaidCents:4_100_000,advanceApplications:[],reason:'Correct paid volume',approvedBy:actor.id,eventAt:new Date()},actor);const replacement=await Purchase.findById(correction.replacementPurchaseId).lean();expect(replacement?.cashPaidCents).toBe(4_100_000);expect(replacement?.outstandingCents).toBe(820_000);expect(await CashBankTransaction.countDocuments({accountId:cash._id})).toBe(before);const [balance]=await SupplierLedgerEntry.aggregate([{$match:{referenceId:{$in:[original._id,replacement?._id]}}},{$group:{_id:null,cents:{$sum:'$payableDeltaCents'}}}]);expect(balance.cents).toBe(820_000);});
  it('posts only a reviewed cash refund delta when correcting an undispatched paid purchase',async()=>{
    const cashUser=await User.create({name:`Cash correction ${marker}`,email:`cash-correction-${marker}@test.local`,passwordHash:'not-used',role:'ADMIN',active:true});
    const cashActor:AuthUser={id:String(cashUser._id),name:cashUser.name,role:'ADMIN'};
    const cash=await CashBankAccount.create({idempotencyKey:randomUUID(),code:`REF-${marker}`,name:'Refund test cash',type:'CASH',openingBalanceCents:5_000_000,active:true,createdBy:actor.id});
    await CashBankTransaction.create({idempotencyKey:randomUUID(),accountId:cash._id,eventAt:new Date(),type:'OPENING_ADJUSTMENT',signedAmountCents:5_000_000,referenceType:'CashBankAccount',referenceId:cash._id,createdBy:actor.id});
    const shift=await CashierShift.create({shiftNumber:`SHF-REF-${marker}`,idempotencyKey:randomUUID(),cashierId:cashActor.id,accountId:cash._id,locationId:`REF-${marker}`,openedAt:new Date(),openingFloatCents:5_000_000,status:'OPEN',openedBy:cashActor.id});
    const original=await Purchase.create({billNumber:`REF-${marker}`,idempotencyKey:randomUUID(),locationId:`REF-${marker}`,sequence:1,supplierId,eventAt:new Date(),densityReading:100,densityVersion,factorMilli:500,litresMilli:100_000,kgMilli:50_000,rateCentsPerKg:82_000,rateSourceId,subtotalCents:4_100_000,adjustmentCents:0,totalCents:4_100_000,cashPaidCents:4_100_000,advanceAppliedCents:0,outstandingCents:0,paymentStatus:'PAID',dispatchStatus:'PENDING',operatorId:actor.id});
    await SupplierLedgerEntry.create([{supplierId,eventAt:original.eventAt,type:'PURCHASE_OBLIGATION',payableDeltaCents:4_100_000,advanceDeltaCents:0,referenceType:'Purchase',referenceId:original._id,createdBy:actor.id},{supplierId,eventAt:original.eventAt,type:'PAYMENT',payableDeltaCents:-4_100_000,advanceDeltaCents:0,referenceType:'Purchase',referenceId:original._id,createdBy:actor.id}]);
    const originalCash=await CashBankTransaction.create({idempotencyKey:randomUUID(),accountId:cash._id,shiftId:shift._id,eventAt:original.eventAt,type:'PURCHASE_CASH_PAYMENT',signedAmountCents:-4_100_000,referenceType:'Purchase',referenceId:original._id,createdBy:actor.id});
    const input={idempotencyKey:randomUUID(),supplierId,litresMilli:100_000,densityReading:100,rateCentsPerKg:82_000,cashPaidCents:3_000_000,cashAccountId:String(cash._id),advanceApplications:[],reason:'Supplier returned excess cash after count correction',eventAt:new Date()};
    const correction=await correctPurchase(String(original._id),input,cashActor);
    const replacement=await Purchase.findById(correction.replacementPurchaseId).lean();
    expect(replacement).toMatchObject({cashPaidCents:3_000_000,outstandingCents:1_100_000});
    expect((await CashBankTransaction.findById(originalCash._id).lean())?.signedAmountCents).toBe(-4_100_000);
    const delta=await CashBankTransaction.findOne({referenceType:'PurchaseCorrection',referenceId:correction._id}).lean();
    expect(delta?.signedAmountCents).toBe(1_100_000);
    expect((await correctPurchase(String(original._id),input,cashActor))._id.toString()).toBe(correction._id.toString());
    await expect(correctPurchaseService(String(original._id),{...input,cashPaidCents:2_000_000,approvalId:'retry'},cashActor)).rejects.toMatchObject({code:'IDEMPOTENCY_KEY_CONFLICT'});
    expect(await CashBankTransaction.countDocuments({referenceType:'PurchaseCorrection',referenceId:correction._id})).toBe(1);
  });
  it('preserves a purchase adjustment when correcting quantity',async()=>{
    const correctedLocation=`ADJ-${marker}`;
    const original=await Purchase.create({billNumber:`ADJ-${marker}`,idempotencyKey:randomUUID(),locationId:correctedLocation,sequence:1,supplierId,eventAt:new Date(),densityReading:100,densityVersion,factorMilli:500,litresMilli:100_000,kgMilli:50_000,rateCentsPerKg:82_000,rateSourceId,subtotalCents:4_100_000,adjustmentCents:100_000,totalCents:4_200_000,cashPaidCents:0,advanceAppliedCents:0,outstandingCents:4_200_000,paymentStatus:'UNPAID',dispatchStatus:'PENDING',operatorId:actor.id});
    await SupplierLedgerEntry.create({supplierId,eventAt:original.eventAt,type:'PURCHASE_OBLIGATION',payableDeltaCents:4_200_000,advanceDeltaCents:0,referenceType:'Purchase',referenceId:original._id,createdBy:actor.id});
    const correction=await correctPurchase(String(original._id),{idempotencyKey:randomUUID(),supplierId,litresMilli:120_000,densityReading:100,rateCentsPerKg:82_000,cashPaidCents:0,advanceApplications:[],reason:'Correct adjusted purchase volume',approvedBy:actor.id,eventAt:new Date()},actor);
    expect(await Purchase.findById(correction.replacementPurchaseId).lean()).toMatchObject({subtotalCents:4_920_000,adjustmentCents:100_000,totalCents:5_020_000});
  });
  it('rejects an unapproved correction and a stale approved request without changing the purchase',async()=>{
    const original=await Purchase.create({billNumber:`STALE-COR-${marker}`,idempotencyKey:randomUUID(),locationId:`STALE-COR-${marker}`,sequence:1,supplierId,eventAt:new Date(),densityReading:100,densityVersion,factorMilli:500,litresMilli:100_000,kgMilli:50_000,rateCentsPerKg:82_000,rateSourceId,subtotalCents:4_100_000,adjustmentCents:0,totalCents:4_100_000,cashPaidCents:0,advanceAppliedCents:0,outstandingCents:4_100_000,paymentStatus:'UNPAID',dispatchStatus:'PENDING',operatorId:actor.id});
    const details={idempotencyKey:randomUUID(),supplierId,litresMilli:120_000,densityReading:100,rateCentsPerKg:82_000,cashPaidCents:0,advanceApplications:[],reason:'Independent stale correction test',eventAt:new Date()};
    await expect(correctPurchaseService(String(original._id),{...details,approvalId:String(original._id)},actor)).rejects.toMatchObject({code:'APPROVAL_REQUIRED'});
    const approval=await requestApproval({idempotencyKey:randomUUID(),operation:'PURCHASE_CORRECTION',targetId:String(original._id),payload:purchaseCorrectionApprovalPayload(String(original._id),details,original.updatedAt),requestReason:details.reason},actor);
    await decideApproval(String(approval._id),{approve:true,reason:'Checked original purchase details'},checker);
    await Purchase.updateOne({_id:original._id},{$set:{notes:'New information after approval'}});
    await expect(correctPurchaseService(String(original._id),{...details,approvalId:String(approval._id)},actor)).rejects.toMatchObject({code:'APPROVAL_REQUIRED'});
    expect(await PurchaseCorrection.countDocuments({originalPurchaseId:original._id})).toBe(0);
  });
  it('allows only one concurrent decision on the same request',async()=>{
    const account=await CashBankAccount.create({idempotencyKey:randomUUID(),code:`DECIDE-${marker}`,name:'Decision test bank',type:'BANK',openingBalanceCents:0,active:true,createdBy:actor.id});
    const approval=await requestApproval({idempotencyKey:randomUUID(),operation:'BANK_OVERDRAFT',targetId:String(account._id),payload:overdraftApprovalPayload(String(account._id),100_000,'Concurrent approval decision'),requestReason:'Concurrent approval decision'},actor);
    const outcomes=await Promise.allSettled([decideApproval(String(approval._id),{approve:true,reason:'Independent first decision'},checker),decideApproval(String(approval._id),{approve:false,reason:'Independent competing decision'},checker)]);
    expect(outcomes.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  });
  it('allows at most one competing transfer to spend the same source balance',async()=>{
    const source=await CashBankAccount.create({idempotencyKey:randomUUID(),code:`RACE-S-${marker}`,name:'Race source',type:'BANK',openingBalanceCents:0,active:true,createdBy:actor.id});
    const target=await CashBankAccount.create({idempotencyKey:randomUUID(),code:`RACE-T-${marker}`,name:'Race target',type:'BANK',openingBalanceCents:0,active:true,createdBy:actor.id});
    await CashBankTransaction.create({idempotencyKey:randomUUID(),accountId:source._id,eventAt:new Date(),type:'OPENING_ADJUSTMENT',signedAmountCents:1_000_000,referenceType:'CashBankAccount',referenceId:source._id,createdBy:actor.id});
    const makeTransfer=()=>postTransfer({idempotencyKey:randomUUID(),sourceAccountId:String(source._id),destinationAccountId:String(target._id),amountCents:750_000,eventAt:new Date(),referenceNumber:`RACE-${marker}`},actor);
    const outcomes=await Promise.allSettled([makeTransfer(),makeTransfer()]);
    expect(outcomes.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    const [sourceBalance]=await CashBankTransaction.aggregate([{$match:{accountId:source._id}},{$group:{_id:null,cents:{$sum:'$signedAmountCents'}}}]);
    expect(sourceBalance.cents).toBe(250_000);
  });
  it('pays and reverses a direct expense without double-counting profit, and reverses profit adjustments',async()=>{
    const bank=await CashBankAccount.create({idempotencyKey:randomUUID(),code:`EXP-${marker}`,name:'Expense test bank',type:'BANK',openingBalanceCents:0,active:true,createdBy:actor.id});
    await CashBankTransaction.create({idempotencyKey:randomUUID(),accountId:bank._id,eventAt:new Date(),type:'OPENING_ADJUSTMENT',signedAmountCents:100_000,referenceType:'CashBankAccount',referenceId:bank._id,createdBy:actor.id});
    const before=(await DispatchBatch.findById(dispatchId).lean())!.netProfitCents;
    const item=await postExpense({idempotencyKey:randomUUID(),category:'Handling',description:'Additional unloading',amountCents:20_000,allocationType:'DIRECT_DISPATCH',dispatchId,expenseAt:new Date(),paymentStatus:'UNPAID'},actor);
    expect((await DispatchBatch.findById(dispatchId).lean())?.netProfitCents).toBe(before-20_000);
    const paymentKey=randomUUID();
    await payExpense(String(item._id),{idempotencyKey:paymentKey,eventAt:new Date(),paymentMethod:'BANK',accountId:String(bank._id)},actor);
    expect((await payExpense(String(item._id),{idempotencyKey:paymentKey,eventAt:new Date(),paymentMethod:'BANK',accountId:String(bank._id)},actor))._id.toString()).toBe(item._id.toString());
    expect((await DispatchBatch.findById(dispatchId).lean())?.netProfitCents).toBe(before-20_000);
    await expect(reverseExpense(String(item._id),{idempotencyKey:randomUUID(),eventAt:new Date(),reason:'Unapproved reversal attempt',approvalId:'invalid'},actor)).rejects.toMatchObject({code:'APPROVAL_REQUIRED'});
    await expect(reverseExpense(String(item._id),{idempotencyKey:randomUUID(),eventAt:new Date(),reason:'Cashier reversal attempt',approvalId:'invalid'},{id:'cashier',name:'Cashier',role:'CASHIER'})).rejects.toMatchObject({code:'FORBIDDEN'});
    expect((await Expense.findById(item._id).lean())?.status).toBe('POSTED');
    await reverseExpense(String(item._id),await approvedReversal('EXPENSE',String(item._id),{idempotencyKey:randomUUID(),eventAt:new Date(),reason:'Approved expense reversal'},Expense),actor);
    expect((await DispatchBatch.findById(dispatchId).lean())?.netProfitCents).toBe(before);
    const [cash]=await CashBankTransaction.aggregate([{$match:{accountId:bank._id}},{$group:{_id:null,cents:{$sum:'$signedAmountCents'}}}]);
    expect(cash.cents).toBe(100_000);
    const adjustment=await postDispatchAdjustment({idempotencyKey:randomUUID(),dispatchId,amountCents:-30_000,eventAt:new Date(),reason:'Approved batch handling adjustment'},actor);
    expect((await DispatchBatch.findById(dispatchId).lean())?.netProfitCents).toBe(before-30_000);
    await reverseDispatchAdjustment(String(adjustment._id),await approvedReversal('DISPATCH_ADJUSTMENT',String(adjustment._id),{idempotencyKey:randomUUID(),eventAt:new Date(),reason:'Approved adjustment reversal'},DispatchFinancialAdjustment),actor);
    expect((await DispatchBatch.findById(dispatchId).lean())?.netProfitCents).toBe(before);
  });
  it('rejects reuse of an expense idempotency key for a different amount',async()=>{
    const key=randomUUID();const base={idempotencyKey:key,category:'Office',description:'Office expense',amountCents:10_000,allocationType:'GENERAL' as const,expenseAt:new Date(),paymentStatus:'UNPAID' as const};
    await postExpense(base,actor);
    await expect(postExpense({...base,amountCents:20_000},actor)).rejects.toMatchObject({code:'IDEMPOTENCY_KEY_CONFLICT'});
    expect(await Expense.countDocuments({idempotencyKey:key})).toBe(1);
  });
  it('runs purchase through payment, dispatch, expense, invoice, settlement and profit without double counting',async()=>{
    const flowLocation=`FLOW-${marker}`;
    const eventAt=new Date('2026-11-01T05:00:00Z');
    const flowBuyer=await BuyerCompany.create({name:`Flow Buyer ${marker}`,active:true});
    await PurchaseRate.create({effectiveFrom:new Date(Date.UTC(2020,0,1)+Number.parseInt(marker,16)),rateCentsPerKg:82_000,createdBy:actor.id,reason:'Phase B flow test'});
    const purchaseKey=randomUUID();
    const purchase=await createPurchase({idempotencyKey:purchaseKey,locationId:flowLocation,supplierId,eventAt,litresMilli:100_000,densityReading:100,cashPaidCents:0,advanceApplications:[],adjustmentCents:0},actor);
    expect((await createPurchase({idempotencyKey:purchaseKey,locationId:flowLocation,supplierId,eventAt,litresMilli:100_000,densityReading:100,cashPaidCents:0,advanceApplications:[],adjustmentCents:0},actor))._id.toString()).toBe(purchase._id.toString());
    const bank=await CashBankAccount.create({idempotencyKey:randomUUID(),code:`FLOW-${marker}`,name:'Flow bank',type:'BANK',openingBalanceCents:0,active:true,createdBy:actor.id});
    await CashBankTransaction.create({idempotencyKey:randomUUID(),accountId:bank._id,eventAt,type:'OPENING_ADJUSTMENT',signedAmountCents:5_000_000,referenceType:'CashBankAccount',referenceId:bank._id,createdBy:actor.id});
    const payment=await postSupplierPayment({idempotencyKey:randomUUID(),supplierId,amountCents:4_100_000,paymentMethod:'BANK',accountId:String(bank._id),eventAt,approvedBy:actor.id,allocations:[{purchaseId:String(purchase._id),amountCents:4_100_000}]},actor);
    expect(payment.amountCents).toBe(4_100_000);
    expect((await Purchase.findById(purchase._id).lean())?.outstandingCents).toBe(0);
    const draft=await createDispatchDraft({idempotencyKey:randomUUID(),locationId:flowLocation,lastSequence:purchase.sequence,buyerId:String(flowBuyer._id),vehicleNumber:'FLOW-BOWSER',dispatchedAt:eventAt},actor);
    const dispatch=await confirmDispatchDraft(String(draft._id),randomUUID(),actor);
    await postExpense({idempotencyKey:randomUUID(),category:'Transport',description:'Flow bowser hire',amountCents:50_000,allocationType:'DIRECT_DISPATCH',dispatchId:String(dispatch._id),expenseAt:eventAt,paymentStatus:'PAID',paymentMethod:'BANK',accountId:String(bank._id)},actor);
    await reconcileDispatch({idempotencyKey:randomUUID(),dispatchId:String(dispatch._id),eventAt,acceptedKgMilli:49_000,sellingRateCentsPerKg:90_000,weighbridgeReference:`FLOW-WB-${marker}`,discrepancyReason:'One KG scale difference',approvedBy:actor.id},actor);
    const invoice=await createCompanyInvoice({idempotencyKey:randomUUID(),dispatchId:String(dispatch._id),issuedAt:eventAt},actor);
    const receiptKey=randomUUID();
    const receipt=await postCompanySettlement({idempotencyKey:receiptKey,invoiceId:String(invoice._id),amountCents:4_410_000,accountId:String(bank._id),paymentMethod:'BANK',eventAt},actor);
    expect((await postCompanySettlement({idempotencyKey:receiptKey,invoiceId:String(invoice._id),amountCents:4_410_000,accountId:String(bank._id),paymentMethod:'BANK',eventAt},actor))._id.toString()).toBe(receipt._id.toString());
    const finalDispatch=await DispatchBatch.findById(dispatch._id).lean();
    expect(finalDispatch).toMatchObject({purchaseCostCents:4_100_000,revenueCents:4_410_000,grossProfitCents:310_000,directExpenseCents:50_000,netProfitCents:260_000,quantityVarianceMilli:-1_000});
    expect((await CompanyInvoice.findById(invoice._id).lean())?.outstandingCents).toBe(0);
    const [buyerBalance]=await BuyerLedgerEntry.aggregate([{$match:{buyerId:invoice.buyerId}},{$group:{_id:null,cents:{$sum:'$receivableDeltaCents'}}}]);
    expect(buyerBalance?.cents??0).toBe(0);
    const [cashFlow]=await CashBankTransaction.aggregate([{$match:{accountId:bank._id}},{$group:{_id:null,cents:{$sum:'$signedAmountCents'}}}]);
    expect(cashFlow.cents).toBe(5_260_000);
  });
  it('adjusts a paid and invoiced dispatch cost without moving its historical payment or invoice',async()=>{
    const original=await Purchase.findOne({locationId:`FLOW-${marker}`}).lean();
    const payment=await SupplierPayment.findOne({'allocations.purchaseId':original!._id}).lean();
    const dispatch=await DispatchBatch.findById(original!.dispatchId).lean();
    const invoice=await CompanyInvoice.findOne({dispatchId:dispatch!._id}).lean();
    const correction=await correctPurchase(String(original!._id),{idempotencyKey:randomUUID(),supplierId,litresMilli:120_000,densityReading:100,rateCentsPerKg:82_000,cashPaidCents:0,advanceApplications:[],reason:'Approved post-invoice weight correction',eventAt:new Date()},actor);
    expect(correction.correctionType).toBe('DISPATCH_ADJUSTMENT');
    expect((await SupplierPayment.findById(payment!._id).lean())?.allocations[0].purchaseId.toString()).toBe(String(original!._id));
    expect((await Purchase.findById(original!._id).lean())?.totalCents).toBe(4_100_000);
    expect((await Purchase.findById(original!._id).lean())?.outstandingCents).toBe(820_000);
    expect((await DispatchBatch.findById(dispatch!._id).lean())).toMatchObject({firstSequence:dispatch!.firstSequence,lastSequence:dispatch!.lastSequence,purchaseCostCents:4_920_000,netProfitCents:-560_000});
    expect((await CompanyInvoice.findById(invoice!._id).lean())).toMatchObject({totalCents:invoice!.totalCents,outstandingCents:0});
  });
});
