import { Router } from 'express';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from './config.js';
import { allow, AppError, auth } from './http.js';
import {
  AdvanceAllocation, AdvanceRepayment, AuditLog, BuyerCompany, BuyerLedgerEntry, CashBankTransaction, CashierShift,
  CompanyInvoice, CompanySettlement, DensityFactorVersion, DispatchBatch, Purchase, PurchaseRate, Supplier,
  SupplierAdvance, SupplierLedgerEntry, SupplierPayment, User,
} from './models.js';
import { createPurchase } from './services/purchase-service.js';
import { confirmDispatch, previewDispatch } from './services/dispatch-service.js';
import {
  closeCashierShift, createCashBankAccount, createCompanyInvoice, issueSupplierAdvance, listCashBankAccountsWithBalances,
  openCashierShift, postCompanySettlement, postSupplierPayment, recordAdvanceRepayment, reverseAdvanceAllocation,
  reverseAdvanceRepayment, reverseCompanySettlement, reverseSupplierAdvance, reverseSupplierPayment,
} from './services/financial-service.js';
import { connectDatabase } from './db.js';

const asyncRoute = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res)).catch(next);
const router = Router();

router.post('/auth/login', asyncRoute(async (req, res) => {
  await connectDatabase();
  const input = z.object({ email: z.string().email(), password: z.string().min(8) }).parse(req.body);
  const user = await User.findOne({ email: input.email.toLowerCase(), active: true }).select('+passwordHash');
  if (!user || !await argon2.verify(user.passwordHash, input.password)) throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  const payload = { id: String(user._id), role: user.role, name: user.name };
  const token = jwt.sign(payload, config.JWT_SECRET, { expiresIn: '8h' });
  res.cookie('access_token', token, { httpOnly: true, sameSite: config.COOKIE_SAME_SITE, secure: config.COOKIE_SECURE, maxAge: 8 * 60 * 60 * 1000, path: '/' });
  res.json({ user: payload });
}));
router.post('/auth/logout', (_req, res) => { res.clearCookie('access_token', { httpOnly: true, sameSite: config.COOKIE_SAME_SITE, secure: config.COOKIE_SECURE, path: '/' }); res.status(204).end(); });
router.get('/auth/me', auth, (req, res) => res.json({ user: req.user }));

router.use(auth);
router.use(async (_req, _res, next) => {
  try { await connectDatabase(); next(); } catch { next(new AppError(503, 'DATABASE_UNAVAILABLE', 'Database is unavailable')); }
});

router.get('/suppliers', asyncRoute(async (req, res) => {
  const query = String(req.query.q ?? '').trim();
  const filter = query ? { $or: [{ name: { $regex: query, $options: 'i' } }, { code: { $regex: query, $options: 'i' } }, { mobile: { $regex: query, $options: 'i' } }] } : {};
  res.json({ data: await Supplier.find(filter).sort({ name: 1 }).limit(50).lean() });
}));
router.post('/suppliers', allow('ADMIN', 'MANAGER', 'CASHIER'), asyncRoute(async (req, res) => {
  const input = z.object({ code: z.string().min(2).max(30), name: z.string().min(2).max(120), mobile: z.string().max(30).optional(), address: z.string().max(300).optional(), village: z.string().max(100).optional(), notes: z.string().max(500).optional() }).parse(req.body);
  const supplier = await Supplier.create(input);
  await AuditLog.create({ actorId: req.user.id, action: 'SUPPLIER_CREATED', entityType: 'Supplier', entityId: supplier._id, after: input, ip: req.ip });
  res.status(201).json({ data: supplier });
}));
router.get('/suppliers/:id/statement', asyncRoute(async (req, res) => {
  const entries = await SupplierLedgerEntry.find({ supplierId: req.params.id }).sort({ eventAt: 1, _id: 1 }).lean();
  let payableCents = 0, advanceCents = 0;
  const data = entries.map((entry) => ({ ...entry, payableBalanceCents: payableCents += entry.payableDeltaCents, advanceBalanceCents: advanceCents += entry.advanceDeltaCents }));
  res.json({ data, summary: { payableCents, advanceCents, netPositionCents: payableCents - advanceCents } });
}));

router.get('/config/density/active', asyncRoute(async (req, res) => {
  const at = req.query.at ? new Date(String(req.query.at)) : new Date();
  res.json({ data: await DensityFactorVersion.findOne({ effectiveFrom: { $lte: at } }).sort({ effectiveFrom: -1 }).lean() });
}));
router.post('/config/density', allow('ADMIN'), asyncRoute(async (req, res) => {
  const input = z.object({ effectiveFrom: z.coerce.date(), reason: z.string().min(3), entries: z.array(z.object({ reading: z.number().int().positive(), factorMilli: z.number().int().positive() })).min(1) }).parse(req.body);
  const last = await DensityFactorVersion.findOne().sort({ version: -1 });
  const data = await DensityFactorVersion.create({ ...input, version: (last?.version ?? 0) + 1, createdBy: req.user.id });
  res.status(201).json({ data });
}));
router.get('/rates/active', asyncRoute(async (req, res) => {
  const at = req.query.at ? new Date(String(req.query.at)) : new Date();
  res.json({ data: await PurchaseRate.findOne({ effectiveFrom: { $lte: at } }).sort({ effectiveFrom: -1 }).lean() });
}));
router.get('/rates', asyncRoute(async (_req, res) => res.json({ data: await PurchaseRate.find().sort({ effectiveFrom: -1 }).lean() })));
router.post('/rates', allow('ADMIN', 'MANAGER'), asyncRoute(async (req, res) => {
  const input = z.object({ effectiveFrom: z.coerce.date(), rateCentsPerKg: z.number().int().nonnegative(), reason: z.string().min(3) }).parse(req.body);
  res.status(201).json({ data: await PurchaseRate.create({ ...input, createdBy: req.user.id }) });
}));

router.post('/purchases', allow('ADMIN', 'MANAGER', 'CASHIER'), asyncRoute(async (req, res) => {
  const input = z.object({ idempotencyKey: z.string().uuid(), locationId: z.string().min(1).default('MAIN'), supplierId: z.string().min(1), eventAt: z.coerce.date(), litresMilli: z.number().int().positive(), densityReading: z.number().int(), cashPaidCents: z.number().int().nonnegative().default(0), advanceApplications: z.array(z.object({ advanceId: z.string(), amountCents: z.number().int().positive() })).default([]), adjustmentCents: z.number().int().nonnegative().default(0), notes: z.string().max(500).optional() }).parse(req.body);
  res.status(201).json({ data: await createPurchase(input, req.user) });
}));
router.get('/purchases', asyncRoute(async (req, res) => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 25)));
  const filter: Record<string, unknown> = { reversedAt: { $exists: false } };
  if (req.query.supplierId) filter.supplierId = String(req.query.supplierId);
  if (req.query.outstanding === 'true') filter.outstandingCents = { $gt: 0 };
  const [data, total] = await Promise.all([Purchase.find(filter).sort({ eventAt: -1, sequence: -1 }).skip((page - 1) * limit).limit(limit).populate('supplierId', 'code name').lean(), Purchase.countDocuments(filter)]);
  res.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));
router.get('/purchases/:id', asyncRoute(async (req, res) => {
  const data = await Purchase.findById(req.params.id).populate('supplierId', 'code name mobile address village').lean();
  if (!data) throw new AppError(404, 'PURCHASE_NOT_FOUND', 'Purchase not found');
  res.json({ data });
}));

router.get('/advances/available/:supplierId', asyncRoute(async (req, res) => {
  const data = await SupplierAdvance.find({ supplierId: req.params.supplierId, status: { $ne: 'REVERSED' } }).lean();
  res.json({ data: data.map((a) => ({ ...a, availableCents: a.issuedCents - a.allocatedCents - a.repaidCents })).filter((a) => a.availableCents > 0) });
}));
router.post('/advances', allow('ADMIN', 'MANAGER', 'ACCOUNTANT'), asyncRoute(async (req, res) => {
  const input = z.object({ idempotencyKey: z.string().uuid(), supplierId: z.string().min(1), issuedCents: z.number().int().positive(), issuedAt: z.coerce.date(), paymentMethod: z.enum(['CASH', 'BANK']), accountId: z.string().min(1), referenceNumber: z.string().max(100).optional(), description: z.string().max(500).optional() }).parse(req.body);
  res.status(201).json({ data: await issueSupplierAdvance({ ...input, approvedBy: req.user!.id }, req.user!) });
}));
router.get('/advances', allow('ADMIN', 'MANAGER', 'ACCOUNTANT', 'AUDITOR'), asyncRoute(async (req, res) => {
  const filter = req.query.supplierId ? { supplierId: String(req.query.supplierId) } : {};
  res.json({ data: await SupplierAdvance.find(filter).sort({ issuedAt: -1 }).populate('supplierId', 'code name').populate('accountId', 'code name type').lean() });
}));
router.get('/advances/:id/history', allow('ADMIN', 'MANAGER', 'ACCOUNTANT', 'AUDITOR'), asyncRoute(async (req, res) => {
  const [advance, allocations, repayments] = await Promise.all([
    SupplierAdvance.findById(req.params.id).populate('supplierId', 'code name').lean(),
    AdvanceAllocation.find({ advanceId: req.params.id }).sort({ createdAt: 1 }).lean(),
    AdvanceRepayment.find({ advanceId: req.params.id }).sort({ eventAt: 1 }).lean(),
  ]);
  if (!advance) throw new AppError(404, 'ADVANCE_NOT_FOUND', 'Supplier advance not found');
  res.json({ data: { advance, allocations, repayments } });
}));
router.post('/advances/:id/repayments', allow('ADMIN', 'MANAGER', 'ACCOUNTANT'), asyncRoute(async (req, res) => {
  const input = z.object({ idempotencyKey: z.string().uuid(), amountCents: z.number().int().positive(), accountId: z.string().min(1), paymentMethod: z.enum(['CASH', 'BANK']), eventAt: z.coerce.date(), referenceNumber: z.string().max(100).optional(), description: z.string().max(500).optional() }).parse(req.body);
  res.status(201).json({ data: await recordAdvanceRepayment({ ...input, advanceId: req.params.id }, req.user!) });
}));
router.get('/advance-repayments', allow('ADMIN', 'MANAGER', 'ACCOUNTANT', 'AUDITOR'), asyncRoute(async (_req, res) => {
  res.json({ data: await AdvanceRepayment.find().sort({ eventAt: -1 }).limit(200).populate('supplierId', 'code name').populate('accountId', 'code name type').lean() });
}));
router.post('/advance-repayments/:id/reverse', allow('ADMIN', 'MANAGER', 'ACCOUNTANT'), asyncRoute(async (req, res) => {
  const input = z.object({ idempotencyKey: z.string().uuid(), reason: z.string().min(3).max(500), eventAt: z.coerce.date() }).parse(req.body);
  res.json({ data: await reverseAdvanceRepayment(req.params.id, input, req.user!) });
}));
router.post('/advances/:id/reverse', allow('ADMIN', 'MANAGER', 'ACCOUNTANT'), asyncRoute(async (req, res) => {
  const input = z.object({ idempotencyKey: z.string().uuid(), reason: z.string().min(3).max(500), eventAt: z.coerce.date() }).parse(req.body);
  res.json({ data: await reverseSupplierAdvance(req.params.id, input, req.user!) });
}));
router.post('/advance-allocations/:id/reverse', allow('ADMIN', 'MANAGER', 'ACCOUNTANT'), asyncRoute(async (req, res) => {
  const input = z.object({ idempotencyKey: z.string().uuid(), reason: z.string().min(3).max(500), eventAt: z.coerce.date() }).parse(req.body);
  res.json({ data: await reverseAdvanceAllocation(req.params.id, input, req.user!) });
}));

router.post('/supplier-payments', allow('ADMIN', 'MANAGER', 'ACCOUNTANT'), asyncRoute(async (req, res) => {
  const input = z.object({
    idempotencyKey: z.string().uuid(), supplierId: z.string().min(1), amountCents: z.number().int().positive(), paymentMethod: z.enum(['CASH', 'BANK']), accountId: z.string().min(1), eventAt: z.coerce.date(),
    referenceNumber: z.string().max(100).optional(), description: z.string().max(500).optional(), allocations: z.array(z.object({ purchaseId: z.string().min(1), amountCents: z.number().int().positive() })).min(1),
  }).parse(req.body);
  res.status(201).json({ data: await postSupplierPayment({ ...input, approvedBy: req.user!.id }, req.user!) });
}));
router.get('/supplier-payments', allow('ADMIN', 'MANAGER', 'ACCOUNTANT', 'AUDITOR'), asyncRoute(async (req, res) => {
  const filter = req.query.supplierId ? { supplierId: String(req.query.supplierId) } : {};
  res.json({ data: await SupplierPayment.find(filter).sort({ eventAt: -1 }).populate('supplierId', 'code name').populate('accountId', 'code name type').lean() });
}));
router.post('/supplier-payments/:id/reverse', allow('ADMIN', 'MANAGER', 'ACCOUNTANT'), asyncRoute(async (req, res) => {
  const input = z.object({ idempotencyKey: z.string().uuid(), reason: z.string().min(3).max(500), eventAt: z.coerce.date() }).parse(req.body);
  res.json({ data: await reverseSupplierPayment(req.params.id, input, req.user!) });
}));

router.post('/cash-accounts', allow('ADMIN', 'ACCOUNTANT'), asyncRoute(async (req, res) => {
  const input = z.object({ idempotencyKey: z.string().uuid(), code: z.string().min(2).max(30), name: z.string().min(2).max(120), type: z.enum(['CASH', 'BANK']), openingBalanceCents: z.number().int() }).parse(req.body);
  res.status(201).json({ data: await createCashBankAccount(input, req.user!) });
}));
router.get('/cash-accounts', allow('ADMIN', 'MANAGER', 'CASHIER', 'ACCOUNTANT', 'AUDITOR'), asyncRoute(async (_req, res) => res.json({ data: await listCashBankAccountsWithBalances() })));
router.get('/cash-transactions', allow('ADMIN', 'MANAGER', 'ACCOUNTANT', 'AUDITOR'), asyncRoute(async (req, res) => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
  const filter: Record<string, unknown> = {};
  if (req.query.accountId) filter.accountId = String(req.query.accountId);
  if (req.query.from || req.query.to) filter.eventAt = { ...(req.query.from ? { $gte: new Date(String(req.query.from)) } : {}), ...(req.query.to ? { $lte: new Date(String(req.query.to)) } : {}) };
  const [data, total] = await Promise.all([CashBankTransaction.find(filter).sort({ eventAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).populate('accountId', 'code name type').populate('shiftId', 'shiftNumber').lean(), CashBankTransaction.countDocuments(filter)]);
  res.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

router.post('/cashier-shifts/open', allow('ADMIN', 'MANAGER', 'CASHIER', 'ACCOUNTANT'), asyncRoute(async (req, res) => {
  const input = z.object({ idempotencyKey: z.string().uuid(), accountId: z.string().min(1), locationId: z.string().min(1).default('MAIN'), openedAt: z.coerce.date(), openingFloatCents: z.number().int().nonnegative(), openingNotes: z.string().max(500).optional() }).parse(req.body);
  res.status(201).json({ data: await openCashierShift(input, req.user!) });
}));
router.get('/cashier-shifts/current', allow('ADMIN', 'MANAGER', 'CASHIER', 'ACCOUNTANT'), asyncRoute(async (req, res) => res.json({ data: await CashierShift.findOne({ cashierId: req.user!.id, status: 'OPEN' }).populate('accountId', 'code name type').lean() })));
router.post('/cashier-shifts/:id/close', allow('ADMIN', 'MANAGER', 'CASHIER', 'ACCOUNTANT'), asyncRoute(async (req, res) => {
  const input = z.object({ idempotencyKey: z.string().uuid(), countedCashCents: z.number().int().nonnegative(), closedAt: z.coerce.date(), closingNotes: z.string().max(500).optional() }).parse(req.body);
  res.json({ data: await closeCashierShift(req.params.id, input, req.user!) });
}));
router.get('/cashier-shifts', allow('ADMIN', 'MANAGER', 'ACCOUNTANT', 'AUDITOR'), asyncRoute(async (req, res) => {
  const filter = req.query.status ? { status: z.enum(['OPEN', 'CLOSED']).parse(req.query.status) } : {};
  res.json({ data: await CashierShift.find(filter).sort({ openedAt: -1 }).limit(200).populate('cashierId', 'name role').populate('accountId', 'code name').lean() });
}));

router.get('/inventory', asyncRoute(async (_req, res) => {
  const [pending] = await Purchase.aggregate([{ $match: { dispatchStatus: 'PENDING', reversedAt: { $exists: false } } }, { $group: { _id: null, litresMilli: { $sum: '$litresMilli' }, kgMilli: { $sum: '$kgMilli' }, purchaseCostCents: { $sum: '$totalCents' }, purchaseCount: { $sum: 1 } } }]);
  res.json({ data: pending ?? { litresMilli: 0, kgMilli: 0, purchaseCostCents: 0, purchaseCount: 0 } });
}));
router.get('/dispatches/preview', allow('ADMIN', 'MANAGER'), asyncRoute(async (req, res) => res.json({ data: await previewDispatch(String(req.query.locationId ?? 'MAIN'), Number(req.query.lastSequence)) })));
router.post('/dispatches/confirm', allow('ADMIN', 'MANAGER'), asyncRoute(async (req, res) => {
  const input = z.object({ idempotencyKey: z.string().uuid(), locationId: z.string().default('MAIN'), lastSequence: z.number().int().positive(), buyerId: z.string(), vehicleNumber: z.string().min(2), dispatchedAt: z.coerce.date(), acceptedKgMilli: z.number().int().nonnegative().optional(), sellingRateCentsPerKg: z.number().int().nonnegative().optional(), directExpenseCents: z.number().int().nonnegative().default(0) }).parse(req.body);
  res.status(201).json({ data: await confirmDispatch(input, req.user) });
}));
router.get('/dispatches', asyncRoute(async (_req, res) => res.json({ data: await DispatchBatch.find().sort({ dispatchedAt: -1 }).populate('buyerId', 'name').lean() })));
router.get('/buyers', asyncRoute(async (_req, res) => res.json({ data: await BuyerCompany.find({ active: true }).sort({ name: 1 }).lean() })));
router.get('/buyers/:id/statement', allow('ADMIN', 'MANAGER', 'ACCOUNTANT', 'AUDITOR'), asyncRoute(async (req, res) => {
  const entries = await BuyerLedgerEntry.find({ buyerId: req.params.id }).sort({ eventAt: 1, _id: 1 }).lean();
  let receivableCents = 0;
  res.json({ data: entries.map((entry) => ({ ...entry, receivableBalanceCents: receivableCents += entry.receivableDeltaCents })), summary: { receivableCents } });
}));
router.post('/company-invoices', allow('ADMIN', 'MANAGER', 'ACCOUNTANT'), asyncRoute(async (req, res) => {
  const input = z.object({ idempotencyKey: z.string().uuid(), dispatchId: z.string().min(1), issuedAt: z.coerce.date(), notes: z.string().max(500).optional() }).parse(req.body);
  res.status(201).json({ data: await createCompanyInvoice(input, req.user!) });
}));
router.get('/company-invoices', allow('ADMIN', 'MANAGER', 'ACCOUNTANT', 'AUDITOR'), asyncRoute(async (req, res) => {
  const filter: Record<string, unknown> = {};
  if (req.query.buyerId) filter.buyerId = String(req.query.buyerId);
  if (req.query.status) filter.status = z.enum(['UNPAID', 'PARTIALLY_PAID', 'PAID']).parse(req.query.status);
  res.json({ data: await CompanyInvoice.find(filter).sort({ issuedAt: -1 }).populate('buyerId', 'name').populate('dispatchId', 'dispatchNumber vehicleNumber acceptedKgMilli').lean() });
}));
router.post('/company-settlements', allow('ADMIN', 'MANAGER', 'ACCOUNTANT'), asyncRoute(async (req, res) => {
  const input = z.object({ idempotencyKey: z.string().uuid(), invoiceId: z.string().min(1), amountCents: z.number().int().positive(), accountId: z.string().min(1), paymentMethod: z.enum(['CASH', 'BANK']), eventAt: z.coerce.date(), referenceNumber: z.string().max(100).optional(), description: z.string().max(500).optional() }).parse(req.body);
  res.status(201).json({ data: await postCompanySettlement(input, req.user!) });
}));
router.get('/company-settlements', allow('ADMIN', 'MANAGER', 'ACCOUNTANT', 'AUDITOR'), asyncRoute(async (req, res) => {
  const filter = req.query.buyerId ? { buyerId: String(req.query.buyerId) } : {};
  res.json({ data: await CompanySettlement.find(filter).sort({ eventAt: -1 }).populate('buyerId', 'name').populate('invoiceId', 'invoiceNumber').populate('accountId', 'code name type').lean() });
}));
router.post('/company-settlements/:id/reverse', allow('ADMIN', 'MANAGER', 'ACCOUNTANT'), asyncRoute(async (req, res) => {
  const input = z.object({ idempotencyKey: z.string().uuid(), reason: z.string().min(3).max(500), eventAt: z.coerce.date() }).parse(req.body);
  res.json({ data: await reverseCompanySettlement(req.params.id, input, req.user!) });
}));

router.get('/dashboard', asyncRoute(async (_req, res) => {
  const now = new Date();
  const dateParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => dateParts.find((item) => item.type === type)?.value;
  const start = new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00+05:30`);
  const [today] = await Purchase.aggregate([{ $match: { eventAt: { $gte: start }, reversedAt: { $exists: false } } }, { $group: { _id: null, litresMilli: { $sum: '$litresMilli' }, kgMilli: { $sum: '$kgMilli' }, procurementCents: { $sum: '$totalCents' }, cashPaidCents: { $sum: '$cashPaidCents' } } }]);
  const [inventory] = await Purchase.aggregate([{ $match: { dispatchStatus: 'PENDING', reversedAt: { $exists: false } } }, { $group: { _id: null, kgMilli: { $sum: '$kgMilli' }, costCents: { $sum: '$totalCents' } } }]);
  const [liability] = await Purchase.aggregate([{ $match: { reversedAt: { $exists: false } } }, { $group: { _id: null, cents: { $sum: '$outstandingCents' } } }]);
  const lastDispatch = await DispatchBatch.findOne({ status: { $in: ['CONFIRMED', 'FINALIZED'] } }).sort({ dispatchedAt: -1 }).lean();
  res.json({ data: { today: today ?? { litresMilli: 0, kgMilli: 0, procurementCents: 0, cashPaidCents: 0 }, inventory: inventory ?? { kgMilli: 0, costCents: 0 }, supplierLiabilityCents: liability?.cents ?? 0, lastDispatch } });
}));

export default router;
