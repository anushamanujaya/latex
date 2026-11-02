import crypto from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { allowedWebOrigins, config } from './config.js';
import { AppError, errorHandler } from './http.js';
import { connectDatabase } from './db.js';
import routes from './routes.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowedWebOrigins.includes(origin)) return callback(null, true);
      callback(new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed'));
    },
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(pinoHttp({
    genReqId: (req) => String(req.headers['x-request-id'] ?? crypto.randomUUID()),
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'],
      censor: '[Redacted]',
    },
  }));
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use((req, _res, next) => {
    if (config.NODE_ENV !== 'production' || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (!origin || !allowedWebOrigins.includes(origin)) return next(new AppError(403, 'ORIGIN_NOT_ALLOWED', 'A trusted request origin is required'));
    next();
  });
  app.use('/api/v1/auth/login', rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false }));
  app.get('/health/live', (_req, res) => res.json({ status: 'ok' }));
  app.get('/health/ready', async (_req, res, next) => {
    try { await connectDatabase(); res.json({ status: 'ready' }); } catch (error) { next(new AppError(503, 'DATABASE_UNAVAILABLE', 'Database is unavailable')); }
  });
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/v1', routes);
  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
  app.use(errorHandler);
  return app;
}

const app = createApp();
export default app;
