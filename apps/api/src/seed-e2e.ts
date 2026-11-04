import argon2 from 'argon2';
import { DEFAULT_DENSITY_FACTORS } from '@latex/domain';
import { config } from './config.js';
import { connectDatabase, disconnectDatabase } from './db.js';
import { BuyerCompany, DensityFactorVersion, PurchaseRate, Supplier, User } from './models.js';
import { createCashBankAccount } from './services/financial-service.js';

if (config.NODE_ENV === 'production' || !/\/latex_dev_phase_b_e2e_[a-zA-Z0-9_]+(?:\?|$)/.test(config.MONGODB_URI)) throw new Error('E2E fixture is restricted to a dedicated local latex_dev_phase_b_e2e_ database');
const password = process.env.E2E_PASSWORD;
if (!password || password.length < 12) throw new Error('Set a synthetic E2E_PASSWORD of at least 12 characters');
await connectDatabase();
try {
  const passwordHash = await argon2.hash(password);
  const admin = await User.findOneAndUpdate({ email: 'admin@e2e.test' }, { $setOnInsert: { name: 'E2E Admin', email: 'admin@e2e.test', passwordHash, role: 'ADMIN', active: true } }, { upsert: true, returnDocument: 'after' });
  await User.updateOne({ email: 'checker@e2e.test' }, { $setOnInsert: { name: 'E2E Checker', email: 'checker@e2e.test', passwordHash, role: 'ACCOUNTANT', active: true } }, { upsert: true });
  await User.updateOne({ email: 'cashier@e2e.test' }, { $setOnInsert: { name: 'E2E Cashier', email: 'cashier@e2e.test', passwordHash, role: 'CASHIER', active: true } }, { upsert: true });
  await Supplier.updateOne({ code: 'E2E-SUP-001' }, { $setOnInsert: { code: 'E2E-SUP-001', name: 'E2E Sinhala Supplier', village: 'කළුතර', active: true } }, { upsert: true });
  await BuyerCompany.updateOne({ name: 'E2E Rubber Company' }, { $setOnInsert: { name: 'E2E Rubber Company', active: true } }, { upsert: true });
  if (!await DensityFactorVersion.exists({})) await DensityFactorVersion.create({ version: 1, effectiveFrom: new Date('2020-01-01'), entries: Object.entries(DEFAULT_DENSITY_FACTORS).map(([reading, factorMilli]) => ({ reading: Number(reading), factorMilli })), createdBy: admin._id, reason: 'Isolated browser acceptance fixture' });
  if (!await PurchaseRate.exists({})) await PurchaseRate.create({ effectiveFrom: new Date('2020-01-01'), rateCentsPerKg: 82_000, createdBy: admin._id, reason: 'Isolated browser acceptance fixture' });
  await createCashBankAccount({ idempotencyKey: 'phase-b-e2e-bank-opening', code: 'E2E-BANK', name: 'E2E Test Bank', type: 'BANK', openingBalanceCents: 50_000_000 }, { id: String(admin._id), name: admin.name, role: 'ADMIN' });
  await createCashBankAccount({ idempotencyKey: 'phase-b-e2e-cash-opening', code: 'E2E-CASH', name: 'E2E Test Cash', type: 'CASH', openingBalanceCents: 10_000_000 }, { id: String(admin._id), name: admin.name, role: 'ADMIN' });
  console.log('Isolated E2E fixture ready; synthetic password not printed.');
} finally { await disconnectDatabase(); }
