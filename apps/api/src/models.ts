import mongoose, { type InferSchemaType, type Model } from 'mongoose';

const { Schema, models } = mongoose;
const model = mongoose.model.bind(mongoose) as typeof mongoose.model;
const objectId = Schema.Types.ObjectId;
const timestamps = { timestamps: true } as const;

const userSchema = new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, index: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['ADMIN', 'MANAGER', 'CASHIER', 'ACCOUNTANT', 'AUDITOR'], required: true },
  active: { type: Boolean, default: true },
}, timestamps);

const supplierSchema = new Schema({
  code: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true, index: true },
  mobile: { type: String, trim: true, index: true },
  address: String,
  village: { type: String, index: true },
  nicEncrypted: { type: String, select: false },
  notes: String,
  active: { type: Boolean, default: true, index: true },
  registeredAt: { type: Date, default: Date.now },
}, timestamps);

const densityVersionSchema = new Schema({
  version: { type: Number, required: true, unique: true },
  effectiveFrom: { type: Date, required: true, index: true },
  entries: [{ _id: false, reading: { type: Number, required: true }, factorMilli: { type: Number, required: true } }],
  createdBy: { type: objectId, ref: 'User', required: true },
  reason: { type: String, required: true },
}, timestamps);

const rateSchema = new Schema({
  effectiveFrom: { type: Date, required: true, unique: true, index: true },
  rateCentsPerKg: { type: Number, required: true, min: 0 },
  createdBy: { type: objectId, ref: 'User', required: true },
  reason: { type: String, required: true },
}, timestamps);

const purchaseSchema = new Schema({
  billNumber: { type: String, required: true, unique: true, index: true },
  idempotencyKey: { type: String, required: true, unique: true },
  locationId: { type: String, required: true, index: true },
  sequence: { type: Number, required: true },
  supplierId: { type: objectId, ref: 'Supplier', required: true, index: true },
  eventAt: { type: Date, required: true, index: true },
  densityReading: { type: Number, required: true },
  densityVersion: { type: Number, required: true },
  factorMilli: { type: Number, required: true },
  litresMilli: { type: Number, required: true },
  kgMilli: { type: Number, required: true },
  rateCentsPerKg: { type: Number, required: true },
  rateSourceId: { type: objectId, ref: 'PurchaseRate', required: true },
  subtotalCents: { type: Number, required: true },
  adjustmentCents: { type: Number, required: true, default: 0 },
  totalCents: { type: Number, required: true },
  cashPaidCents: { type: Number, required: true, default: 0 },
  advanceAppliedCents: { type: Number, required: true, default: 0 },
  outstandingCents: { type: Number, required: true },
  paymentStatus: { type: String, enum: ['PAID', 'UNPAID', 'PARTIALLY_PAID'], required: true },
  dispatchStatus: { type: String, enum: ['PENDING', 'ASSIGNED'], default: 'PENDING', index: true },
  dispatchId: { type: objectId, ref: 'DispatchBatch', default: null },
  notes: String,
  operatorId: { type: objectId, ref: 'User', required: true },
  reversedAt: Date,
  reversedBy: { type: objectId, ref: 'User' },
  reversalReason: String,
  replacementPurchaseId: { type: objectId, ref: 'Purchase' },
  replacesPurchaseId: { type: objectId, ref: 'Purchase' },
}, timestamps);
purchaseSchema.index({ locationId: 1, sequence: 1 }, { unique: true });

const ledgerSchema = new Schema({
  supplierId: { type: objectId, ref: 'Supplier', required: true, index: true },
  eventAt: { type: Date, required: true, index: true },
  type: { type: String, enum: ['PURCHASE_OBLIGATION', 'PAYMENT', 'PAYMENT_REVERSAL', 'ADVANCE_ISSUED', 'ADVANCE_ISSUE_REVERSAL', 'ADVANCE_ALLOCATED', 'ADVANCE_ALLOCATION_REVERSAL', 'ADVANCE_REPAID', 'ADVANCE_REPAYMENT_REVERSAL', 'REVERSAL', 'OPENING'], required: true },
  payableDeltaCents: { type: Number, required: true, default: 0 },
  advanceDeltaCents: { type: Number, required: true, default: 0 },
  referenceType: { type: String, required: true },
  referenceId: { type: objectId, required: true },
  description: String,
  createdBy: { type: objectId, ref: 'User', required: true },
}, timestamps);

const advanceSchema = new Schema({
  idempotencyKey: { type: String, required: true, unique: true },
  supplierId: { type: objectId, ref: 'Supplier', required: true, index: true },
  issuedCents: { type: Number, required: true },
  allocatedCents: { type: Number, required: true, default: 0 },
  repaidCents: { type: Number, required: true, default: 0 },
  paymentMethod: { type: String, enum: ['CASH', 'BANK'], required: true },
  accountId: { type: objectId, ref: 'CashBankAccount', required: true },
  referenceNumber: String,
  description: String,
  issuedAt: { type: Date, required: true },
  issuedBy: { type: objectId, ref: 'User', required: true },
  approvedBy: { type: objectId, ref: 'User', required: true },
  status: { type: String, enum: ['ACTIVE', 'REVERSED'], default: 'ACTIVE', index: true },
  reversedAt: Date,
  reversedBy: { type: objectId, ref: 'User' },
  reversalReason: String,
  reversalIdempotencyKey: { type: String, unique: true, sparse: true },
}, timestamps);

const allocationSchema = new Schema({
  advanceId: { type: objectId, ref: 'SupplierAdvance', required: true, index: true },
  purchaseId: { type: objectId, ref: 'Purchase', required: true, index: true },
  amountCents: { type: Number, required: true },
  allocatedBy: { type: objectId, ref: 'User', required: true },
  reversedAt: Date,
  reversedBy: { type: objectId, ref: 'User' },
  reversalReason: String,
  reversalIdempotencyKey: { type: String, unique: true, sparse: true },
}, timestamps);

const supplierPaymentSchema = new Schema({
  paymentNumber: { type: String, required: true, unique: true },
  idempotencyKey: { type: String, required: true, unique: true },
  supplierId: { type: objectId, ref: 'Supplier', required: true, index: true },
  amountCents: { type: Number, required: true, min: 1 },
  paymentMethod: { type: String, enum: ['CASH', 'BANK'], required: true },
  accountId: { type: objectId, ref: 'CashBankAccount', required: true },
  shiftId: { type: objectId, ref: 'CashierShift' },
  eventAt: { type: Date, required: true, index: true },
  referenceNumber: String,
  description: String,
  allocations: [{ _id: false, purchaseId: { type: objectId, ref: 'Purchase', required: true }, amountCents: { type: Number, required: true, min: 1 } }],
  status: { type: String, enum: ['POSTED', 'REVERSED'], default: 'POSTED', index: true },
  createdBy: { type: objectId, ref: 'User', required: true },
  approvedBy: { type: objectId, ref: 'User', required: true },
  reversedAt: Date,
  reversedBy: { type: objectId, ref: 'User' },
  reversalReason: String,
  reversalIdempotencyKey: { type: String, unique: true, sparse: true },
}, timestamps);
supplierPaymentSchema.index({ supplierId: 1, eventAt: -1 });

const cashBankAccountSchema = new Schema({
  idempotencyKey: { type: String, unique: true, sparse: true },
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: ['CASH', 'BANK'], required: true, index: true },
  openingBalanceCents: { type: Number, required: true, default: 0 },
  active: { type: Boolean, default: true, index: true },
  createdBy: { type: objectId, ref: 'User', required: true },
}, timestamps);

const cashBankTransactionSchema = new Schema({
  idempotencyKey: { type: String, required: true, unique: true },
  accountId: { type: objectId, ref: 'CashBankAccount', required: true, index: true },
  shiftId: { type: objectId, ref: 'CashierShift', index: true },
  eventAt: { type: Date, required: true, index: true },
  type: { type: String, enum: ['SUPPLIER_PAYMENT', 'PURCHASE_CASH_PAYMENT', 'ADVANCE_ISSUE', 'ADVANCE_REPAYMENT', 'COMPANY_RECEIPT', 'EXPENSE', 'OPENING_ADJUSTMENT', 'REVERSAL', 'TRANSFER_IN', 'TRANSFER_OUT', 'SHIFT_VARIANCE'], required: true, index: true },
  signedAmountCents: { type: Number, required: true },
  referenceType: { type: String, required: true },
  referenceId: { type: objectId, required: true },
  description: String,
  createdBy: { type: objectId, ref: 'User', required: true },
}, timestamps);
cashBankTransactionSchema.index({ accountId: 1, eventAt: 1, _id: 1 });

const cashierShiftSchema = new Schema({
  shiftNumber: { type: String, required: true, unique: true },
  idempotencyKey: { type: String, required: true, unique: true },
  cashierId: { type: objectId, ref: 'User', required: true, index: true },
  accountId: { type: objectId, ref: 'CashBankAccount', required: true, index: true },
  locationId: { type: String, required: true, default: 'MAIN' },
  openedAt: { type: Date, required: true, index: true },
  openingFloatCents: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ['OPEN', 'CLOSED'], default: 'OPEN', index: true },
  closedAt: Date,
  expectedCashCents: Number,
  countedCashCents: Number,
  varianceCents: Number,
  openingNotes: String,
  closingNotes: String,
  openedBy: { type: objectId, ref: 'User', required: true },
  closedBy: { type: objectId, ref: 'User' },
  closeIdempotencyKey: { type: String, unique: true, sparse: true },
}, timestamps);
cashierShiftSchema.index({ cashierId: 1, status: 1 }, { unique: true, partialFilterExpression: { status: 'OPEN' } });

const advanceRepaymentSchema = new Schema({
  repaymentNumber: { type: String, required: true, unique: true },
  idempotencyKey: { type: String, required: true, unique: true },
  advanceId: { type: objectId, ref: 'SupplierAdvance', required: true, index: true },
  supplierId: { type: objectId, ref: 'Supplier', required: true, index: true },
  amountCents: { type: Number, required: true, min: 1 },
  accountId: { type: objectId, ref: 'CashBankAccount', required: true },
  shiftId: { type: objectId, ref: 'CashierShift' },
  paymentMethod: { type: String, enum: ['CASH', 'BANK'], required: true },
  eventAt: { type: Date, required: true },
  referenceNumber: String,
  description: String,
  status: { type: String, enum: ['POSTED', 'REVERSED'], default: 'POSTED', index: true },
  receivedBy: { type: objectId, ref: 'User', required: true },
  reversedAt: Date,
  reversedBy: { type: objectId, ref: 'User' },
  reversalReason: String,
  reversalIdempotencyKey: { type: String, unique: true, sparse: true },
}, timestamps);

const counterSchema = new Schema({
  key: { type: String, required: true, unique: true },
  value: { type: Number, required: true, default: 0 },
});

const buyerSchema = new Schema({
  name: { type: String, required: true, unique: true }, contact: String, address: String, settlementTerms: String, active: { type: Boolean, default: true },
}, timestamps);

const companyInvoiceSchema = new Schema({
  invoiceNumber: { type: String, required: true, unique: true },
  idempotencyKey: { type: String, required: true, unique: true },
  dispatchId: { type: objectId, ref: 'DispatchBatch', required: true, unique: true },
  buyerId: { type: objectId, ref: 'BuyerCompany', required: true, index: true },
  issuedAt: { type: Date, required: true, index: true },
  totalCents: { type: Number, required: true, min: 0 },
  outstandingCents: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ['UNPAID', 'PARTIALLY_PAID', 'PAID'], required: true, index: true },
  createdBy: { type: objectId, ref: 'User', required: true },
  notes: String,
}, timestamps);

const companyInvoiceAdjustmentSchema = new Schema({
  adjustmentNumber: { type: String, required: true, unique: true },
  idempotencyKey: { type: String, required: true, unique: true },
  invoiceId: { type: objectId, ref: 'CompanyInvoice', required: true, index: true },
  dispatchId: { type: objectId, ref: 'DispatchBatch', required: true, index: true },
  buyerId: { type: objectId, ref: 'BuyerCompany', required: true, index: true },
  amountCents: { type: Number, required: true },
  type: { type: String, enum: ['DEBIT', 'CREDIT'], required: true },
  eventAt: { type: Date, required: true, index: true },
  reason: { type: String, required: true },
  createdBy: { type: objectId, ref: 'User', required: true },
}, timestamps);

const companySettlementSchema = new Schema({
  receiptNumber: { type: String, required: true, unique: true },
  idempotencyKey: { type: String, required: true, unique: true },
  invoiceId: { type: objectId, ref: 'CompanyInvoice', required: true, index: true },
  buyerId: { type: objectId, ref: 'BuyerCompany', required: true, index: true },
  amountCents: { type: Number, required: true, min: 1 },
  accountId: { type: objectId, ref: 'CashBankAccount', required: true },
  shiftId: { type: objectId, ref: 'CashierShift' },
  paymentMethod: { type: String, enum: ['CASH', 'BANK'], required: true },
  eventAt: { type: Date, required: true, index: true },
  referenceNumber: String,
  description: String,
  status: { type: String, enum: ['POSTED', 'REVERSED'], default: 'POSTED' },
  receivedBy: { type: objectId, ref: 'User', required: true },
  reversedAt: Date,
  reversedBy: { type: objectId, ref: 'User' },
  reversalReason: String,
  reversalIdempotencyKey: { type: String, unique: true, sparse: true },
}, timestamps);

const buyerLedgerSchema = new Schema({
  buyerId: { type: objectId, ref: 'BuyerCompany', required: true, index: true },
  eventAt: { type: Date, required: true, index: true },
  type: { type: String, enum: ['SALE_RECEIVABLE', 'PAYMENT_RECEIVED', 'PAYMENT_REVERSAL', 'ADJUSTMENT'], required: true },
  receivableDeltaCents: { type: Number, required: true },
  referenceType: { type: String, required: true },
  referenceId: { type: objectId, required: true },
  description: String,
  createdBy: { type: objectId, ref: 'User', required: true },
}, timestamps);
buyerLedgerSchema.index({ buyerId: 1, eventAt: 1, _id: 1 });

const dispatchSchema = new Schema({
  dispatchNumber: { type: String, required: true, unique: true },
  idempotencyKey: { type: String, required: true, unique: true },
  locationId: { type: String, required: true, index: true },
  status: { type: String, enum: ['DRAFT', 'CONFIRMED', 'RECONCILED', 'FINALIZED'], default: 'DRAFT', index: true },
  confirmationIdempotencyKey: { type: String, unique: true, sparse: true },
  buyerId: { type: objectId, ref: 'BuyerCompany', required: true },
  vehicleNumber: { type: String, required: true },
  firstSequence: { type: Number, required: true },
  lastSequence: { type: Number, required: true },
  purchaseCount: { type: Number, required: true },
  totalLitresMilli: { type: Number, required: true },
  acquiredKgMilli: { type: Number, required: true },
  purchaseCostCents: { type: Number, required: true },
  acceptedKgMilli: Number,
  quantityVarianceMilli: Number,
  quantityVarianceBasisPoints: Number,
  weighbridgeReference: String,
  weighbridgeDocumentName: String,
  weighbridgeDocumentUrl: String,
  reconciledAt: Date,
  reconciledBy: { type: objectId, ref: 'User' },
  reconciliationApprovedBy: { type: objectId, ref: 'User' },
  sellingRateCentsPerKg: Number,
  revenueCents: Number,
  directExpenseCents: { type: Number, default: 0 },
  adjustmentCents: { type: Number, default: 0 },
  grossProfitCents: Number,
  netProfitCents: Number,
  profitMarginBasisPoints: Number,
  costPerAcquiredKgCents: Number,
  dispatchedAt: Date,
  confirmedBy: { type: objectId, ref: 'User' },
  confirmedAt: Date,
  notes: String,
}, timestamps);
dispatchSchema.index({ locationId: 1, firstSequence: 1, lastSequence: 1 });

const dispatchReconciliationSchema = new Schema({
  idempotencyKey: { type: String, required: true, unique: true },
  dispatchId: { type: objectId, ref: 'DispatchBatch', required: true, index: true },
  version: { type: Number, required: true },
  eventAt: { type: Date, required: true, index: true },
  acceptedKgMilli: { type: Number, required: true, min: 0 },
  sellingRateCentsPerKg: { type: Number, required: true, min: 0 },
  quantityVarianceMilli: { type: Number, required: true },
  quantityVarianceBasisPoints: { type: Number, required: true },
  weighbridgeReference: { type: String, required: true },
  weighbridgeDocumentName: String,
  weighbridgeDocumentUrl: String,
  discrepancyReason: String,
  notes: String,
  previousSnapshot: Schema.Types.Mixed,
  resultingSnapshot: Schema.Types.Mixed,
  operatorId: { type: objectId, ref: 'User', required: true },
  approvedBy: { type: objectId, ref: 'User', required: true },
}, timestamps);
dispatchReconciliationSchema.index({ dispatchId: 1, version: 1 }, { unique: true });

const expenseSchema = new Schema({
  expenseNumber: { type: String, required: true, unique: true }, idempotencyKey: { type: String, required: true, unique: true },
  category: { type: String, required: true, index: true }, description: { type: String, required: true }, amountCents: { type: Number, required: true, min: 1 },
  allocationType: { type: String, enum: ['DIRECT_DISPATCH', 'GENERAL'], required: true, index: true }, dispatchId: { type: objectId, ref: 'DispatchBatch', index: true },
  expenseAt: { type: Date, required: true, index: true }, paymentStatus: { type: String, enum: ['UNPAID', 'PAID'], required: true },
  paymentMethod: { type: String, enum: ['CASH', 'BANK'] }, accountId: { type: objectId, ref: 'CashBankAccount' }, shiftId: { type: objectId, ref: 'CashierShift' },
  paymentIdempotencyKey: { type: String, unique: true, sparse: true }, paidAt: Date,
  referenceNumber: String, status: { type: String, enum: ['POSTED', 'REVERSED'], default: 'POSTED', index: true }, authorizedBy: { type: objectId, ref: 'User', required: true }, createdBy: { type: objectId, ref: 'User', required: true },
  reversedAt: Date, reversedBy: { type: objectId, ref: 'User' }, reversalReason: String, reversalIdempotencyKey: { type: String, unique: true, sparse: true },
}, timestamps);

const dispatchFinancialAdjustmentSchema = new Schema({
  idempotencyKey: { type: String, required: true, unique: true }, dispatchId: { type: objectId, ref: 'DispatchBatch', required: true, index: true },
  amountCents: { type: Number, required: true }, eventAt: { type: Date, required: true, index: true }, reason: { type: String, required: true },
  createdBy: { type: objectId, ref: 'User', required: true }, approvedBy: { type: objectId, ref: 'User', required: true },
  status: { type: String, enum: ['POSTED', 'REVERSED'], default: 'POSTED' }, reversedAt: Date, reversedBy: { type: objectId, ref: 'User' }, reversalReason: String,
  reversalIdempotencyKey: { type: String, unique: true, sparse: true },
}, timestamps);

const cashBankTransferSchema = new Schema({
  transferNumber: { type: String, required: true, unique: true }, idempotencyKey: { type: String, required: true, unique: true },
  sourceAccountId: { type: objectId, ref: 'CashBankAccount', required: true, index: true }, destinationAccountId: { type: objectId, ref: 'CashBankAccount', required: true, index: true },
  sourceShiftId: { type: objectId, ref: 'CashierShift' }, destinationShiftId: { type: objectId, ref: 'CashierShift' }, amountCents: { type: Number, required: true, min: 1 },
  eventAt: { type: Date, required: true, index: true }, referenceNumber: { type: String, required: true }, description: String,
  status: { type: String, enum: ['POSTED', 'REVERSED'], default: 'POSTED' }, createdBy: { type: objectId, ref: 'User', required: true }, approvedBy: { type: objectId, ref: 'User', required: true },
  reversedAt: Date, reversedBy: { type: objectId, ref: 'User' }, reversalReason: String, reversalIdempotencyKey: { type: String, unique: true, sparse: true },
}, timestamps);

const purchaseCorrectionSchema = new Schema({
  correctionNumber: { type: String, required: true, unique: true }, idempotencyKey: { type: String, required: true, unique: true }, originalPurchaseId: { type: objectId, ref: 'Purchase', required: true, index: true },
  replacementPurchaseId: { type: objectId, ref: 'Purchase' }, correctionType: { type: String, enum: ['VOID_REPLACE', 'DISPATCH_ADJUSTMENT'], required: true }, reason: { type: String, required: true },
  originalSnapshot: { type: Schema.Types.Mixed, required: true }, replacementSnapshot: Schema.Types.Mixed, inventoryKgDeltaMilli: { type: Number, default: 0 }, costDeltaCents: { type: Number, default: 0 },
  createdBy: { type: objectId, ref: 'User', required: true }, approvedBy: { type: objectId, ref: 'User', required: true },
}, timestamps);

const auditSchema = new Schema({
  actorId: { type: objectId, ref: 'User', required: true }, action: { type: String, required: true, index: true }, entityType: String, entityId: objectId,
  reason: String, before: Schema.Types.Mixed, after: Schema.Types.Mixed, ip: String, requestId: String,
}, timestamps);

// Explicit model annotations avoid Mongoose's cached-model union overload ambiguity.
export const User: Model<any> = models.User ?? model('User', userSchema);
export const Supplier: Model<any> = models.Supplier ?? model('Supplier', supplierSchema);
export const DensityFactorVersion: Model<any> = models.DensityFactorVersion ?? model('DensityFactorVersion', densityVersionSchema);
export const PurchaseRate: Model<any> = models.PurchaseRate ?? model('PurchaseRate', rateSchema);
export const Purchase: Model<any> = models.Purchase ?? model('Purchase', purchaseSchema);
export const SupplierLedgerEntry: Model<any> = models.SupplierLedgerEntry ?? model('SupplierLedgerEntry', ledgerSchema);
export const SupplierAdvance: Model<any> = models.SupplierAdvance ?? model('SupplierAdvance', advanceSchema);
export const AdvanceAllocation: Model<any> = models.AdvanceAllocation ?? model('AdvanceAllocation', allocationSchema);
export const SupplierPayment: Model<any> = models.SupplierPayment ?? model('SupplierPayment', supplierPaymentSchema);
export const CashBankAccount: Model<any> = models.CashBankAccount ?? model('CashBankAccount', cashBankAccountSchema);
export const CashBankTransaction: Model<any> = models.CashBankTransaction ?? model('CashBankTransaction', cashBankTransactionSchema);
export const CashierShift: Model<any> = models.CashierShift ?? model('CashierShift', cashierShiftSchema);
export const AdvanceRepayment: Model<any> = models.AdvanceRepayment ?? model('AdvanceRepayment', advanceRepaymentSchema);
export const Counter: Model<any> = models.Counter ?? model('Counter', counterSchema);
export const BuyerCompany: Model<any> = models.BuyerCompany ?? model('BuyerCompany', buyerSchema);
export const CompanyInvoice: Model<any> = models.CompanyInvoice ?? model('CompanyInvoice', companyInvoiceSchema);
export const CompanyInvoiceAdjustment: Model<any> = models.CompanyInvoiceAdjustment ?? model('CompanyInvoiceAdjustment', companyInvoiceAdjustmentSchema);
export const CompanySettlement: Model<any> = models.CompanySettlement ?? model('CompanySettlement', companySettlementSchema);
export const BuyerLedgerEntry: Model<any> = models.BuyerLedgerEntry ?? model('BuyerLedgerEntry', buyerLedgerSchema);
export const DispatchBatch: Model<any> = models.DispatchBatch ?? model('DispatchBatch', dispatchSchema);
export const DispatchReconciliation: Model<any> = models.DispatchReconciliation ?? model('DispatchReconciliation', dispatchReconciliationSchema);
export const Expense: Model<any> = models.Expense ?? model('Expense', expenseSchema);
export const DispatchFinancialAdjustment: Model<any> = models.DispatchFinancialAdjustment ?? model('DispatchFinancialAdjustment', dispatchFinancialAdjustmentSchema);
export const CashBankTransfer: Model<any> = models.CashBankTransfer ?? model('CashBankTransfer', cashBankTransferSchema);
export const PurchaseCorrection: Model<any> = models.PurchaseCorrection ?? model('PurchaseCorrection', purchaseCorrectionSchema);
export const AuditLog: Model<any> = models.AuditLog ?? model('AuditLog', auditSchema);

export type UserDocument = InferSchemaType<typeof userSchema>;
