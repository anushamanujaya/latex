import { describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from './app.js';
import { config } from './config.js';

describe('http foundation', () => {
  it('serves health without database access', async () => {
    const response = await request(createApp()).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
  it('protects financial APIs', async () => expect((await request(createApp()).get('/api/v1/purchases')).status).toBe(401));
  it('allows only configured browser origins', async () => {
    expect((await request(createApp()).get('/health').set('Origin', 'http://localhost:5173')).status).toBe(200);
    const denied = await request(createApp()).get('/health').set('Origin', 'https://attacker.example');
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
  });
  it('sets hardened response headers', async () => {
    const response = await request(createApp()).get('/health');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('rejects cashier access to Phase B corrections, reconciliation, expenses and transfers', async () => {
    const token = jwt.sign({ id: 'cashier-test', name: 'Cashier', role: 'CASHIER' }, config.JWT_SECRET);
    const cookie = `access_token=${token}`;
    for (const path of ['/api/v1/purchases/000000000000000000000001/corrections','/api/v1/purchases/000000000000000000000001/correction-requests','/api/v1/dispatches/000000000000000000000001/reconcile','/api/v1/dispatches/000000000000000000000001/reconciliation-requests','/api/v1/dispatches/000000000000000000000001/adjustment-requests','/api/v1/approvals','/api/v1/expenses','/api/v1/cash-transfers','/api/v1/company-refunds','/api/v1/reversal-requests','/api/v1/supplier-payments/000000000000000000000001/reverse','/api/v1/company-settlements/000000000000000000000001/reverse']) {
      const response = await request(createApp()).post(path).set('Cookie', cookie).send({});
      expect(response.status, path).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    }
  }, 15_000);
  it('isolates reversal execution from manager, auditor, and cashier roles', async () => {
    const path = '/api/v1/supplier-payments/000000000000000000000001/reverse';
    for (const role of ['MANAGER', 'AUDITOR', 'CASHIER'] as const) {
      const token = jwt.sign({ id: `role-${role}`, name: role, role }, config.JWT_SECRET);
      const response = await request(createApp()).post(path).set('Cookie', `access_token=${token}`).send({});
      expect(response.status, role).toBe(403);
      expect(response.body.error.code, role).toBe('FORBIDDEN');
    }
  }, 20_000);
});
