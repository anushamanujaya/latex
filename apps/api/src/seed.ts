import argon2 from 'argon2';
import { DEFAULT_DENSITY_FACTORS } from '@latex/domain';
import { connectDatabase, disconnectDatabase } from './db.js';
import { BuyerCompany, DensityFactorVersion, PurchaseRate, Supplier, User } from './models.js';
import { config } from './config.js';

if (config.NODE_ENV === 'production' || !config.MONGODB_URI.includes('dev')) throw new Error('Seed is restricted to a database URI containing "dev"');
const demoPassword = process.env.DEV_SEED_PASSWORD;
if (!demoPassword || demoPassword.length < 12) throw new Error('Set DEV_SEED_PASSWORD to a unique password of at least 12 characters before running the development seed');
await connectDatabase();
const passwordHash = await argon2.hash(demoPassword);
const admin = await User.findOneAndUpdate({ email: 'admin@latex.local' }, { $setOnInsert: { name: 'Nimal Perera', email: 'admin@latex.local', passwordHash, role: 'ADMIN', active: true } }, { upsert: true, returnDocument: 'after' });
await User.findOneAndUpdate({ email: 'cashier@latex.local' }, { $setOnInsert: { name: 'Kaushalya Silva', email: 'cashier@latex.local', passwordHash, role: 'CASHIER', active: true } }, { upsert: true });
for (const supplier of [
  { code: 'SUP-001', name: 'Sunil Jayasinghe', mobile: '0771234567', village: 'Agalawatta' },
  { code: 'SUP-002', name: 'Tharindu Kumara', mobile: '0712345678', village: 'Matugama' },
  { code: 'SUP-003', name: 'Kusum Liyanage', mobile: '0763456789', village: 'Baduraliya' },
]) await Supplier.updateOne({ code: supplier.code }, { $setOnInsert: supplier }, { upsert: true });
if (!await DensityFactorVersion.exists({})) await DensityFactorVersion.create({ version: 1, effectiveFrom: new Date('2020-01-01T00:00:00+05:30'), entries: Object.entries(DEFAULT_DENSITY_FACTORS).map(([reading, factorMilli]) => ({ reading: Number(reading), factorMilli })), createdBy: admin._id, reason: 'Initial business-supplied conversion table' });
if (!await PurchaseRate.exists({})) await PurchaseRate.create({ effectiveFrom: new Date('2026-10-20T00:00:00+05:30'), rateCentsPerKg: 82_000, createdBy: admin._id, reason: 'Demo purchase rate' });
await BuyerCompany.updateOne({ name: 'Ceylon Rubber Processors PLC' }, { $setOnInsert: { name: 'Ceylon Rubber Processors PLC', contact: '0112345678', settlementTerms: '14 days' } }, { upsert: true });
console.log('Development seed complete. Password was read from DEV_SEED_PASSWORD and was not printed.');
await disconnectDatabase();
