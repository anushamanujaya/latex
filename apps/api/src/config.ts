import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1).default('mongodb://localhost:27017/latex_dev?replicaSet=rs0'),
  JWT_SECRET: z.string().min(32).default('development-only-secret-change-me-now'),
  WEB_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  COOKIE_SECURE: z.string().default('false').transform((v) => v === 'true'),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  MONGODB_MAX_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  MONGODB_SERVER_SELECTION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
}).superRefine((value, context) => {
  const origins = value.WEB_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean);
  for (const origin of origins) {
    try {
      const parsed = new URL(origin);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error();
    } catch { context.addIssue({ code: 'custom', path: ['WEB_ORIGIN'], message: `Invalid origin: ${origin}` }); }
  }
  if (origins.length === 0) context.addIssue({ code: 'custom', path: ['WEB_ORIGIN'], message: 'At least one frontend origin is required' });
  if (value.NODE_ENV === 'production') {
    if (!value.MONGODB_URI.startsWith('mongodb+srv://') || /localhost|127\.0\.0\.1|@mongo[:/]/i.test(value.MONGODB_URI)) context.addIssue({ code: 'custom', path: ['MONGODB_URI'], message: 'Production requires a MongoDB Atlas mongodb+srv URI' });
    if (value.JWT_SECRET === 'development-only-secret-change-me-now') context.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'Production JWT secret must not use the development default' });
    if (!value.COOKIE_SECURE) context.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'Production cookies must be secure' });
    if (origins.some((origin) => !origin.startsWith('https://'))) context.addIssue({ code: 'custom', path: ['WEB_ORIGIN'], message: 'Production frontend origins must use HTTPS' });
    if (value.COOKIE_SAME_SITE === 'none' && !value.COOKIE_SECURE) context.addIssue({ code: 'custom', path: ['COOKIE_SAME_SITE'], message: 'SameSite=None requires secure cookies' });
  }
});

export const config = schema.parse(process.env);
export const allowedWebOrigins = Object.freeze(config.WEB_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean));
