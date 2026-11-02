import mongoose from 'mongoose';
import { config } from './config.js';

let connectionPromise: Promise<typeof mongoose> | null = null;

export async function connectDatabase(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;
  if (!connectionPromise) {
    connectionPromise = mongoose.connect(config.MONGODB_URI, {
      autoIndex: config.NODE_ENV !== 'production',
      maxPoolSize: config.MONGODB_MAX_POOL_SIZE,
      minPoolSize: 0,
      maxIdleTimeMS: 60_000,
      serverSelectionTimeoutMS: config.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
      heartbeatFrequencyMS: 10_000,
    }).catch((error: unknown) => {
      connectionPromise = null;
      throw error;
    });
  }
  return connectionPromise;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  connectionPromise = null;
}
