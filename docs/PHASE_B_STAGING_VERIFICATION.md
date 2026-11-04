# Production-shaped Phase B staging gate

**Status: PENDING.** No Atlas/Vercel staging URL, separate staging database credential, deployment, or staging test evidence was available in this work. The local synthetic replica-set and browser suites are not staging acceptance.

Local configuration-only smoke on 2026-11-04: an unsafe synthetic `NODE_ENV=production` configuration using localhost MongoDB, HTTP origin, and insecure cookie was rejected; a syntactically valid, entirely fake Atlas-SRV/HTTPS/secure-cookie shape was accepted without opening a database connection. This verifies the guard's shape checks only, **not** Atlas connectivity, staging authorization, Vercel behavior, or deployment.

## Required environment

- Separate Atlas staging project/cluster or database and a staging-only least-privilege `readWrite` user; no production credential, customer data, or shared backup target. Enable replica-set transactions, TLS, backup/PITR, and environment-specific monitoring.
- Separate backend/frontend preview deployments and HTTPS domains (prefer sibling `staging-app` and `staging-api` subdomains). Set staging-only `MONGODB_URI`, random `JWT_SECRET`, exact HTTPS `WEB_ORIGIN`, `COOKIE_SECURE=true`, compatible `COOKIE_SAME_SITE`, and public `VITE_API_URL`. Keep secrets only in the deployment secret store. Follow [deployment configuration](DEPLOYMENT.md).
- Synthetic administrator, independent accountant/checker, cashier, supplier, buyer, rates, and opening balances. Record fixture identifiers and database name. Never run `seed-e2e.ts` against production: it explicitly accepts only local `latex_dev_phase_b_e2e_*` databases.
- Run migrations/index builds on an isolated staging copy after checking duplicates and explain plans. No automatic production index/data migration is authorized by this checklist.

## Evidence to collect before sign-off

1. Record deployment commit, build logs, region/runtime, deployment URLs, Atlas project/database identifier (not secrets), operator, and UTC timestamps. Verify `/health/live` and `/health/ready` separately.
2. Confirm HTTP-to-HTTPS, exact CORS allowlist, `HttpOnly; Secure; SameSite` cookies, rejected foreign origins, unauthorized `401`, cashier `403` on financial approval/reversal/audit endpoints, and independent maker/checker restrictions.
3. Execute Phase A and Phase B MongoDB suites against a disposable staging test database with distinct credentials; keep synthetic records for reconciliation. Exercise duplicate request keys, stale approval, rollback after a deliberate rejection, competing source-account spends, and transaction retry behavior.
4. Run each independent browser acceptance flow in the matrix using staging URLs and synthetic users. Confirm direct SPA routes, receipt reprint without reposting, print media/PDF, error messages, logout, and browser cookie behavior.
5. Reconcile supplier payable and advance balances, cash/bank signed movements, buyer receivables/refund due, purchase/dispatch cost, and batch gross/net profit against transaction histories. Export immutable audit evidence and inspect redacted request/error logs for denied, failed, and retried actions.
6. Inspect Atlas slow-query/index metrics, API p95 and cold starts, function timeout, connection pool, alerts, backup/restore evidence, and rollback plan. Run a non-production restore test before acceptance.

**Pass rule:** all checks must have actual artifacts and finance/security sign-off. Local build and test success does not mark staging passed. No production access, migration, push, or deployment is part of this work.
