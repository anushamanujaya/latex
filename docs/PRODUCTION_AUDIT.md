# Production readiness audit

Audit date: 2026-11-02. Scope: the complete repository, including workspace/package configuration, API, UI, domain arithmetic, local MongoDB replica set, tests, and deployment documentation.

## Resolved deployment blockers

- Express now has a default export at `apps/api/src/app.ts`, the location supported by Vercel's Express integration. The local listener remains isolated in `server.ts`.
- Mongoose connections are reused across warm invocations. Pool size, idle lifetime, and server-selection timeout are bounded and environment-driven.
- Production configuration fails closed unless it receives an Atlas SRV URI, HTTPS frontend origins, secure cookies, and a non-development JWT secret.
- CORS uses an exact comma-separated allowlist in `WEB_ORIGIN`. Production state-changing requests additionally require a trusted `Origin` header.
- Cross-project cookies have configurable `SameSite` behavior and always require `Secure` in production.
- Vite uses `VITE_API_URL`; production builds fail if it is missing. GET requests no longer trigger unnecessary JSON preflights.
- The web application has the official Vercel SPA rewrite and immutable caching only for fingerprinted assets.
- Demo passwords were removed from the UI, documentation, and source-controlled seed. The development seed now requires `DEV_SEED_PASSWORD` and still refuses production databases.
- A one-time, fail-closed administrator command creates the first user only when the database contains zero users.
- Purchase creation and dispatch confirmation now write audit records inside their MongoDB transactions.
- HTTP logs redact authorization, cookie, and `Set-Cookie` values before they reach platform logs.
- The repository pins Node 24.x so a platform runtime change cannot silently move the financial application to another major version.

## Critical production blockers still open

The application must **not** be handed to a real financial customer yet.

1. Controlled purchase/payment reversal and replacement workflows are absent. Confirmed financial records cannot yet be corrected safely through the UI/API.
2. Supplier payments after initial purchase, advance issuance, and all cash/bank postings are not consistently covered by idempotency keys and multi-document transactions. The current advance endpoint can leave a ledger mismatch if its second write fails.
3. Company settlements, buyer receivables, cashier shifts, expenses, cash reconciliation, inventory adjustments, and several models named in the original architecture are not implemented.
4. Dispatch reconciliation/finalization, weighbridge adjustments, returns, and explicit backdated-purchase reconciliation are incomplete.
5. Many navigation entries are deliberate placeholders. Report exports, statements, PDF/Excel output, and most analytics are not working modules. The dashboard collection chart still uses static illustrative trend data.
6. The full 24-case financial/integration/E2E acceptance matrix has not been implemented. No real replica-set transaction rollback or concurrent dispatch test has run in this environment.
7. `nicEncrypted` is only a field name; encryption and key management are not implemented. Do not store NIC values until field-level encryption or application encryption is completed.
8. JWT sessions have no server-side revocation, password-change invalidation, MFA, or forced first-login password change. These are recommended before customer handover.
9. Express rate limiting is per warm function instance and is not a global abuse-control system. Configure Vercel Firewall/rate rules or a shared rate-limit store.
10. Mongoose model exports currently use broad `Model<any>` typing. Runtime schema validation exists, but model-level compile-time safety should be strengthened before the domain expands.

## Operational risks requiring owner decisions

- Decide whether production and staging use sibling custom domains. `SameSite=lax` is suitable for `app.example.lk` and `api.example.lk`; unrelated domains require `SameSite=none`, secure cookies, the strict origin allowlist, and careful browser testing.
- Confirm tax/accounting rules, user approval limits, collection locations, receipt wording, retention periods, and personal-data access policy.
- Choose an Atlas/Vercel networking plan. Static egress/private connectivity is preferred; an unrestricted Atlas IP entry materially increases reliance on database credentials.
- Choose recovery-point and recovery-time objectives and an Atlas tier/backup policy that satisfies them.

## Deployment gate

Staging deployment is appropriate for engineering verification with synthetic data. Production customer data and financial operation remain blocked until all critical items above have owners, tests, and acceptance evidence.

## Verification evidence from this audit

- TypeScript checks: API, web, and shared domain passed.
- Production builds: API and Vite web passed with an explicit staging `VITE_API_URL`.
- Exact Vercel root-directory commands: both `npm run vercel-build` scripts passed when invoked from their application directories.
- Automated tests: 12 passed (7 financial/domain, 4 API/security, 1 frontend formatting).
- Production configuration guard: unsafe localhost/insecure defaults were rejected; a valid-shaped Atlas/HTTPS configuration was accepted.
- Dependency audit: `npm audit --omit=dev` reported zero vulnerabilities at audit time.
- Local replica-set smoke test: readiness and authentication passed. The canonical 10 L / reading 150 / LKR 820 purchase persisted as 4.000 KG and LKR 3,280.00. An identical idempotency retry returned the same purchase.
- Dispatch smoke test: two equal-timestamp purchases were ordered by sequence and assigned through an inclusive sequence-2 boundary. Idempotent confirmation returned the same dispatch, overlapping preview was rejected, cashier dispatch access returned 403, and pending inventory became zero.
- Local smoke records were retained in the dedicated `latex_dev` volume; no cleanup or destructive database operation was performed.

Not executed: a real Vercel preview deployment, Atlas connection, custom-domain/cookie browser test, UI browser automation (the in-app browser was unavailable), true parallel dispatch race test, and forced multi-document rollback test. These remain required deployment gates.
