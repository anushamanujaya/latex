import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';

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
});
