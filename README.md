# Araliya Latex Collection Suite

A transaction-safe MERN foundation for Sri Lankan latex purchasing, supplier credit, pending inventory, exact sequence-boundary bowser dispatches, and batch profit. The UI defaults to `en-LK`, LKR, and `Asia/Colombo`; database timestamps are UTC.

## What is implemented

- Secure cookie login and backend roles (admin, manager, cashier, accountant, auditor)
- Supplier register and derived supplier statement foundation
- Versioned density-factor table and effective purchase-rate history
- Precise scaled-integer litre/KG/factor arithmetic and integer-cent money
- Idempotent transactional purchase creation with immutable rate/factor snapshots
- Paid, unpaid, partial, and explicit advance allocation ledger postings
- Live pending-inventory aggregates
- Inclusive permanent-sequence dispatch preview and atomic confirmation
- Snapshot batch profit domain calculation
- Responsive dashboard, POS, history, supplier, rates, dispatch, and 80 mm receipt screens
- Domain and HTTP foundation tests

See [architecture and phased status](docs/ARCHITECTURE.md), [production audit](docs/PRODUCTION_AUDIT.md), and [deployment guide](docs/DEPLOYMENT.md). Phase 7 report/export breadth and the complete Phase 8 production hardening matrix remain clearly pending; placeholder navigation does not claim those workflows are finished.

## Local development

Requirements: Node.js 24+, Docker, and npm 11+.

1. Copy `apps/api/.env.example` to `apps/api/.env` and `apps/web/.env.example` to `apps/web/.env`.
2. Start the transactional MongoDB replica set: `docker compose up -d`.
3. Install packages: `npm install`.
4. Set a unique `DEV_SEED_PASSWORD`, then seed only the dedicated development database: `npm run seed`.
5. Start both applications: `npm run dev`.
6. Open `http://localhost:5173` and sign in with the local account created by the seed and your chosen `DEV_SEED_PASSWORD`.

Verification: `npm run typecheck`, `npm test`, and `npm run build`.

## Deployment

Deploy `apps/api` and `apps/web` independently. Use MongoDB Atlas (or a replica set) because critical writes require multi-document transactions. Build with `npm ci && npm run build`; start the API with `npm run start -w @latex/api`, and serve `apps/web/dist` through a TLS-enabled static host.

Set a strong 32+ character `JWT_SECRET`, exact HTTPS `WEB_ORIGIN`, `COOKIE_SECURE=true`, and an Atlas URI through the platform secret manager. Do not run `seed` against production; it refuses URIs without `dev` and refuses `NODE_ENV=production`. Create the first administrator with the fail-closed `npm run admin:create -w @latex/api` command described in the deployment guide.

For Atlas, allow only deployment egress addresses, enforce database authentication/TLS, enable point-in-time backups, alerts, and separate least-privilege development/production users. Test restore into an isolated database quarterly, validate counts/totals, and document recovery time. Application startup never drops or rewrites data.

Production monitoring should collect structured API logs, request latency/error rate, transaction aborts, database connection saturation, authentication throttles, and scheduled backup results. A smoke test should check `/health`, login, supplier lookup, active density/rate, a reversible test purchase in a non-production tenant, inventory, and dispatch preview.

## API conventions

REST endpoints are under `/api/v1`. Errors use `{ "error": { "code", "message", "details?" } }`. Critical creates require a UUID idempotency key. Pagination is server-side. Purchase and dispatch totals are always computed by the API.

Key endpoints: `/auth/*`, `/suppliers`, `/suppliers/:id/statement`, `/config/density`, `/rates`, `/purchases`, `/advances`, `/inventory`, `/dispatches/preview`, `/dispatches/confirm`, `/buyers`, and `/dashboard`.

## Financial representation

- LKR values: integer cents (`328000` = LKR 3,280.00)
- litres and KG: integer thousandths (`4000` = 4.000 KG)
- conversion factors: integer thousandths (`400` = 0.400)
- rounding: half-up at the configured stored precision

An advance allocation reduces both the supplier payable and advance asset by the allocated amount. It does not alter `Purchase.totalCents`, so procurement cost and batch profit remain correct.
