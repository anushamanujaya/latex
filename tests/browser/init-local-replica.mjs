import { MongoClient } from 'mongodb';

const uri = 'mongodb://127.0.0.1:27018/?directConnection=true&retryWrites=false';
const client = new MongoClient(uri);
await client.connect();
try {
  const admin = client.db('admin');
  try {
    const status = await admin.command({ replSetGetStatus: 1 });
    if (status.set !== 'rs0') throw new Error('Unexpected replica set on test port');
    console.log('Existing isolated rs0 replica set found on port 27018.');
  } catch (error) {
    if (error.codeName !== 'NotYetInitialized') throw error;
    await admin.command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: '127.0.0.1:27018' }] } });
    console.log('Initialized isolated rs0 replica set on port 27018.');
  }
} finally { await client.close(); }
