import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';

// This helper is deliberately pinned to the separately launched loopback test server.
const port = 27018;
const bootstrapPassword = process.env.PHASE_B_BOOTSTRAP_PASSWORD;
const runnerPassword = process.env.PHASE_B_RUNNER_PASSWORD;
const databases = [process.env.PHASE_B_TEST_DB_A, process.env.PHASE_B_TEST_DB_B, process.env.PHASE_B_TEST_DB_E2E];
if (!bootstrapPassword || bootstrapPassword.length < 24 || !runnerPassword || runnerPassword.length < 24) throw new Error('Strong in-memory test credentials are required');
if (!/^latex_phase_a_verify_[a-z0-9]+$/.test(databases[0] ?? '') || !/^latex_phase_b_verify_[a-z0-9]+$/.test(databases[1] ?? '') || !/^latex_dev_phase_b_e2e_[a-z0-9]+$/.test(databases[2] ?? '')) throw new Error('Refusing non-isolated test database names');

const uri = `mongodb://127.0.0.1:${port}/?directConnection=true&serverSelectionTimeoutMS=5000`;
const bootstrap = new MongoClient(uri);
await bootstrap.connect();
try {
  const admin = bootstrap.db('admin');
  await admin.command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: `localhost:${port}` }] } });
  let primary = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    const hello = await admin.command({ hello: 1 });
    if (hello.isWritablePrimary) { primary = true; break; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!primary) throw new Error('Isolated replica set did not elect a primary');
  await admin.command({ createUser: 'phase_b_bootstrap', pwd: bootstrapPassword, roles: [{ role: 'userAdminAnyDatabase', db: 'admin' }] });
} finally { await bootstrap.close(); }

const administrator = new MongoClient(uri, { auth: { username: 'phase_b_bootstrap', password: bootstrapPassword }, authSource: 'admin' });
await administrator.connect();
try {
  await administrator.db('admin').command({ createUser: 'phase_b_runner', pwd: runnerPassword, roles: databases.flatMap(db => [{ role: 'readWrite', db }, { role: 'dbAdmin', db }]) });
} finally { await administrator.close(); }

const runner = new MongoClient(uri, { auth: { username: 'phase_b_runner', password: runnerPassword }, authSource: 'admin' });
await runner.connect();
try {
  const db = runner.db(databases[1]);
  const committedId = randomUUID();
  const committed = runner.startSession();
  try { await committed.withTransaction(async () => { await db.collection('transaction_smoke').insertOne({ _id: committedId, state: 'committed' }, { session: committed }); }); }
  finally { await committed.endSession(); }
  if (!await db.collection('transaction_smoke').findOne({ _id: committedId })) throw new Error('Transaction commit was not visible');

  const rolledBackId = randomUUID();
  const rolledBack = runner.startSession();
  try {
    await rolledBack.withTransaction(async () => {
      await db.collection('transaction_smoke').insertOne({ _id: rolledBackId, state: 'must-rollback' }, { session: rolledBack });
      throw new Error('INTENTIONAL_TRANSACTION_ABORT');
    });
  } catch (error) { if (error.message !== 'INTENTIONAL_TRANSACTION_ABORT') throw error; }
  finally { await rolledBack.endSession(); }
  if (await db.collection('transaction_smoke').findOne({ _id: rolledBackId })) throw new Error('Transaction rollback failed');
  console.log(`Isolated authenticated rs0 ready on loopback port ${port}; commit and rollback verified; databases: ${databases.join(', ')}`);
} finally { await runner.close(); }
