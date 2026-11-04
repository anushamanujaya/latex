# Production readiness audit

> **Final closure update (2026-11-04): real-customer production NOT ACCEPTED.** The isolated browser suite now has **20/20 independent scenarios passed**, and the Phase A **6/6**, Phase B **25/25**, repository **16/16**, TypeScript, and production build checks passed again. This supersedes the older 12-flow count below. The eight new flows include advance-funded purchase, safe company receipt reversal, direct-expense/profit-adjustment reversals, cashier closeout, stale approval, a blocked cross-supplier cash correction, and mobile receipt reprint. No physical printer or real staging environment was tested; finance-owned cross-ledger rules remain unresolved. See [final release report](FINAL_RELEASE_REPORT.md).

> **Prior 12-flow snapshot (2026-11-04; superseded above):** Maker/checker approval covers eight financial reversal kinds plus correction, reconciliation, profit adjustment, refund, and overdraft changes. An approved same-supplier/same-account cash-paid replacement posts only its cash difference; an approved dispatched cost/quantity delta preserves posted settlement and boundary. New corrections reject conflicting idempotency-key reuse. Local Phase A **6/6**, Phase B **25/25**, repository **16/16**, TypeScript, production build, and browser **12/12** passed on isolated synthetic data at that point. The original 20-item table was checkpoints. The software receipt PDF is 80 mm wide with a legible self-hosted Sinhala font. Physical printer, actual Atlas/Vercel staging, wider cross-ledger accounting policy, browser variants, and later-phase security/reporting remain open. See the [final release report](FINAL_RELEASE_REPORT.md). All older dated findings below are historical snapshots, not current feature inventory.

> Historical Phase B snapshot (2026-11-03): retained below for traceability. Its test counts and blocker list have been superseded by the 2026-11-04 acceptance report linked above.

> Phase B update (2026-11-03): dispatch drafts/locking, weighbridge reconciliation, expense/transfer posting, and controlled purchase correction have been implemented since this audit. The numbered findings below are the original 2026-11-02 snapshot and are not a current feature inventory. See [Phase B status](PHASE_B_DISPATCH_RECONCILIATION.md) for implementation, verification limits, and remaining deployment blockers. Production readiness remains **not established**.

Audit date: 2026-11-02. Scope: the complete repository, including workspace/package configuration, API, UI, domain arithmetic, local MongoDB replica set, tests, and deployment documentation.

## Current Phase B re-audit (2026-11-03)

The original Phase B findings 1-4 below are now **partly resolved**: controlled purchase correction/replacement, weighbridge reconciliation, batch profit, expense posting/payment/reversal, internal transfers, and invoice debit/credit histories are implemented. Expense, correction, and reconciliation operator screens are functional. The original numbered findings remain below as historical context, not a claim that those functions are absent today. See [Phase B implementation and acceptance status](PHASE_B_DISPATCH_RECONCILIATION.md).

Local replica-set evidence: 6/6 Phase A regression tests and 19/19 Phase B transaction/integration tests passed on 2026-11-03 in isolated databases. The Phase B suite includes a service-layer purchase-to-settlement profit path, a competing-transfer race, credits below receipts with partial/final refunds, and an approved bounded bank overdraft. Production build passed. Route splitting reduced the initial web JavaScript chunk from 761.36 kB to 310.62 kB; dashboard code loads as a separate 366.00 kB chunk. Synthetic test data was retained; no database was reset. See [final acceptance report](PHASE_B_ACCEPTANCE_REPORT.md) for the current test matrix and limitations.

**Still blocking financial customer deployment:** the complete UI/browser and receipt-print acceptance matrix; corrections that change already-settled cash or dispatched supplier/settlement details; two-person approval outside the new refund and overdraft paths; UI for refund/approval operations; and decisions on tax, backdating, weighbridge evidence, and invoiced-batch cost changes. Cheque lifecycle, formal chart of accounts, returns/inventory adjustments, reports/exports, security hardening, and production environment smoke tests also remain. Phase B is not accepted, and the application is not production-ready.

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
- Phase A now has transactional, idempotent supplier payment allocation and compensating reversal records. Reversals restore purchase liabilities without changing the original purchase cost.
- Supplier advances now post to a cash/bank account and supplier ledger; purchase recovery, direct repayment, repayment reversal, allocation reversal, and unused-advance reversal preserve their original records.
- Cash/bank accounts use signed immutable movements. Cash operations require an open cashier shift, and closing stores expected cash, counted cash, variance, and supervisor-controlled variance posting.
- Company invoices create buyer receivables from finalized dispatch revenue. Partial receipts and receipt reversals update the receivable and cash/bank ledgers atomically.
- Functional Phase A screens replace the placeholders for payments, advances, cash/bank reconciliation, and company sales.

## Critical production blockers still open

The application must **not** be handed to a real financial customer yet.

1. Controlled purchase reversal and replacement remains absent. Supplier-payment corrections are implemented, but an erroneous original purchase still cannot be corrected safely through the UI/API.
2. Expense posting, cash/bank transfers, cheque lifecycle, and a formal chart of accounts are not implemented. The Phase A ledger currently covers purchases, supplier payments, advances, company receipts, opening balances, reversals, and cashier variance.
3. Inventory adjustments and several models named in the original architecture are not implemented. Company invoicing currently depends on dispatch values captured at confirmation; the full weighbridge reconciliation workflow is Phase B.
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
- Baseline automated tests: 12 passed (7 financial/domain, 4 API/security, 1 frontend formatting). The opt-in Phase A replica-set suite adds 6 passing transactional scenarios.
- Phase A replica-set acceptance: supplier payment/idempotent retry/reversal, advance repayment, allocation reversal, advance reversal, repayment reversal, company invoice/partial receipt/receipt reversal, and exact shift reconciliation passed against `latex_phase_a_test`. Synthetic test records were retained.
- Phase A type checks passed for domain, API, and web. The production web build passed at 736.92 kB (218.11 kB gzip) and still triggers the large initial-chunk warning assigned to Phase D.
- Production configuration guard: unsafe localhost/insecure defaults were rejected; a valid-shaped Atlas/HTTPS configuration was accepted.
- Dependency audit: `npm audit --omit=dev` reported zero vulnerabilities at audit time.
- Local replica-set smoke test: readiness and authentication passed. The canonical 10 L / reading 150 / LKR 820 purchase persisted as 4.000 KG and LKR 3,280.00. An identical idempotency retry returned the same purchase.
- Dispatch smoke test: two equal-timestamp purchases were ordered by sequence and assigned through an inclusive sequence-2 boundary. Idempotent confirmation returned the same dispatch, overlapping preview was rejected, cashier dispatch access returned 403, and pending inventory became zero.
- Local smoke records were retained in the dedicated `latex_dev` volume; no cleanup or destructive database operation was performed.

Not executed: a real Vercel preview deployment, Atlas connection, custom-domain/cookie browser test, UI browser automation (the in-app browser was unavailable), true parallel dispatch race test, and forced multi-document rollback test. These remain required deployment gates.
