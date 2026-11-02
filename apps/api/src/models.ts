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
}, timestamps);
purchaseSchema.index({ locationId: 1, sequence: 1 }, { unique: true });

const ledgerSchema = new Schema({
  supplierId: { type: objectId, ref: 'Supplier', required: true, index: true },
  eventAt: { type: Date, required: true, index: true },
  type: { type: String, enum: ['PURCHASE_OBLIGATION', 'PAYMENT', 'ADVANCE_ISSUED', 'ADVANCE_ALLOCATED', 'REVERSAL', 'OPENING'], required: true },
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
  referenceNumber: String,
  description: String,
  issuedAt: { type: Date, required: true },
  issuedBy: { type: objectId, ref: 'User', required: true },
  approvedBy: { type: objectId, ref: 'User', required: true },
}, timestamps);

const allocationSchema = new Schema({
  advanceId: { type: objectId, ref: 'SupplierAdvance', required: true, index: true },
  purchaseId: { type: objectId, ref: 'Purchase', required: true, index: true },
  amountCents: { type: Number, required: true },
  allocatedBy: { type: objectId, ref: 'User', required: true },
  reversedAt: Date,
}, timestamps);

const counterSchema = new Schema({
  key: { type: String, required: true, unique: true },
  value: { type: Number, required: true, default: 0 },
});

const buyerSchema = new Schema({
  name: { type: String, required: true, unique: true }, contact: String, address: String, settlementTerms: String, active: { type: Boolean, default: true },
}, timestamps);

const dispatchSchema = new Schema({
  dispatchNumber: { type: String, required: true, unique: true },
  idempotencyKey: { type: String, required: true, unique: true },
  locationId: { type: String, required: true, index: true },
  status: { type: String, enum: ['DRAFT', 'CONFIRMED', 'FINALIZED'], default: 'DRAFT' },
  buyerId: { type: objectId, ref: 'BuyerCompany', required: true },
  vehicleNumber: { type: String, required: true },
  firstSequence: { type: Number, required: true },
  lastSequence: { type: Number, required: true },
  purchaseCount: { type: Number, required: true },
  totalLitresMilli: { type: Number, required: true },
  acquiredKgMilli: { type: Number, required: true },
  purchaseCostCents: { type: Number, required: true },
  acceptedKgMilli: Number,
  sellingRateCentsPerKg: Number,
  revenueCents: Number,
  directExpenseCents: { type: Number, default: 0 },
  adjustmentCents: { type: Number, default: 0 },
  grossProfitCents: Number,
  netProfitCents: Number,
  dispatchedAt: Date,
  confirmedBy: { type: objectId, ref: 'User' },
  confirmedAt: Date,
  notes: String,
}, timestamps);
dispatchSchema.index({ locationId: 1, firstSequence: 1, lastSequence: 1 });

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
export const Counter: Model<any> = models.Counter ?? model('Counter', counterSchema);
export const BuyerCompany: Model<any> = models.BuyerCompany ?? model('BuyerCompany', buyerSchema);
export const DispatchBatch: Model<any> = models.DispatchBatch ?? model('DispatchBatch', dispatchSchema);
export const AuditLog: Model<any> = models.AuditLog ?? model('AuditLog', auditSchema);

export type UserDocument = InferSchemaType<typeof userSchema>;
