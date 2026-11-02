import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { ZodError } from 'zod';
import { config } from './config.js';

export interface AuthUser { id: string; role: 'ADMIN' | 'MANAGER' | 'CASHIER' | 'ACCOUNTANT' | 'AUDITOR'; name: string }

declare global { namespace Express { interface Request { user?: AuthUser } } }

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export function auth(req: Request, _res: Response, next: NextFunction): void {
  try {
    const token = req.cookies?.access_token as string | undefined;
    if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in required');
    req.user = jwt.verify(token, config.JWT_SECRET) as AuthUser;
    next();
  } catch { next(new AppError(401, 'UNAUTHENTICATED', 'Session is invalid or expired')); }
}

export function allow(...roles: AuthUser['role'][]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) return next(new AppError(403, 'FORBIDDEN', 'Insufficient permission'));
    next();
  };
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof ZodError) { res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: error.issues } }); return; }
  if (error instanceof AppError) { res.status(error.status).json({ error: { code: error.code, message: error.message } }); return; }
  const mongo = error as { code?: number; keyPattern?: object };
  if (mongo.code === 11000) { res.status(409).json({ error: { code: 'DUPLICATE', message: 'A record with this unique value already exists' } }); return; }
  console.error(error);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } });
}
