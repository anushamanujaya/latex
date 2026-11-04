# Phase B implementation and acceptance status (2026-11-04)

> **Final closure update:** 20/20 independent local browser flows passed on synthetic data, including direct-expense and profit-adjustment reversals. Phase B remains **NOT ACCEPTED** for real customers because physical printing, real staging, and finance-policy decisions are still open. See [final release report](FINAL_RELEASE_REPORT.md). Older counts below are historical.

> **Current continuation (2026-11-04): Phase B remains NOT ACCEPTED.** Dispatch reconciliation uses actual company-accepted KG; confirmed boundaries and original financial records are preserved. Maker/checker approval gates eight reversal kinds, and same-supplier/same-account cash correction posts only a signed delta. Local replica-set suites passed Phase B **25/25** and Phase A **6/6**; repository **16/16**, TypeScript, production build, and browser **12/12** passed. Twelve independent browser scenarios are not the full requested matrix. Software print PDF passed, but the physical printer and production-shaped staging were not tested. See the [current acceptance report](PHASE_B_ACCEPTANCE_REPORT.md), [browser matrix](PHASE_B_BROWSER_MATRIX.md), and [cross-ledger boundary](PHASE_B_CROSS_LEDGER_POLICY.md). Sections below this notice are earlier snapshots with stale counts/blockers.

> Historical 2026-11-03 continuation below is retained for traceability; its counts and blocker wording are superseded by the current report above.

## Final-acceptance continuation (2026-11-03)

This section supersedes older refund, overdraft, test-count, and bundle-size statements below. Phase B remains **not accepted**.

- An invoice credit larger than outstanding receivables now creates a separately tracked `refundDueCents` and `REFUND_DUE` status, while preserving the signed buyer ledger. Partial and final company refunds post an immutable refund record, buyer-ledger entry, and cash/bank outflow together in one MongoDB transaction. Exact-payload, single-use maker/checker approval is required. Reversal of a company receipt also accounts for a pending refund due.
- All ordinary debit postings now pass through an account-write-serialized ledger balance guard. Cash cannot go negative. Bank overdraft defaults to zero; a nonzero limit requires an independently approved, audited configuration. Transfer concurrency and overdraft enforcement were exercised on the local replica set.
- Approval request, decision, refund, and overdraft APIs are available. General approval infrastructure exists, but it is **not yet enforced** for purchase corrections, dispatch reconciliation amendments, or profit adjustments. The refund and overdraft approval flows are not yet represented by complete operator UI screens.
- React pages are lazy-loaded by route. The production initial JavaScript chunk fell from 761.36 kB to **310.62 kB** (98.68 kB gzip); dashboard chart dependencies form a separate 366.00 kB chunk.
- Replica-set Phase B service/integration suite: **19/19 passed** in an isolated synthetic test database. Phase A regression: **6/6 passed**. The full repository test/typecheck results and browser status are in `PHASE_B_ACCEPTANCE_REPORT.md`.

Remaining blockers include settlement-changing corrections for already dispatched purchases, safe changes to carried cash in paid corrections, independent approvals for every high-risk historical amendment, operator UI and Playwright/receipt-print coverage, and staging migration/performance review. No production data or database was reset.

Phase B is substantially implemented but **not production-accepted**. No production deployment, GitHub push, customer-data migration, or database reset was performed.

## Delivered behavior

- Dispatches have persisted drafts, exact purchase-ID and quantity snapshots, inclusive sequence boundaries, and transactional confirmation. Voided purchase sequences remain tombstones in the historical boundary. Changed drafts and overlapping confirmations are rejected.
- Reconciliation records company-accepted KG, rate, weighbridge reference and document metadata, discrepancy reason, approver, versioned snapshots, variance, revenue, cost per KG, gross profit, margin, and net profit. A changed invoiced revenue posts a linked debit or credit to the invoice and buyer ledger. Credits below already-collected receipts are blocked without clamping the outstanding balance.
- Direct expenses reduce only the assigned batch's net profit; general expenses do not. Expense creation, payment, reversal, and signed profit-only adjustments are transactional and audited. Cash/bank transfers post paired signed movements and reversals. Competing transfers against one source write-lock the account so only available funds are transferred.
- Undispatched purchase corrections append an audited void/replacement; dispatched corrections append an approved cost/quantity delta without changing the original cost snapshot or dispatch boundary. Supplier liability and batch profit are recalculated. Original historical density version and purchase adjustment are retained by default.
- Already-paid cash can be carried to a replacement without inventing a refund and second payment. Changing that cash amount, reducing a purchase below settled value, changing a dispatched supplier/settlement, or correcting a purchase with an allocated supplier payment is blocked until the relevant separate financial workflow occurs.
- React screens expose dispatch draft/confirmation/detail/reconciliation, direct/general expenses and later payment/reversal, cash/bank transfers, purchase correction, dispatch profit adjustments, and invoice amendment history. Read APIs expose correction context and financial histories.

## Financial invariants

`revenue = round-half-up(acceptedKgMilli * sellingRateCentsPerKg / 1000)`; `gross profit = revenue - adjusted purchase cost`; `net profit = gross profit - posted direct expenses + signed financial adjustments`. Integer cents/milli-units and BigInt intermediate products avoid binary-floating sale and ratio errors. Supplier payments and advance recoveries are balance-sheet movements, not procurement cost or profit. An invoice receipt reduces receivable and increases cash/bank, not revenue.

## Executed verification

- Docker Desktop and the local MongoDB replica set were started successfully. Tests used isolated `latex_phase_a_verify_20261103` and `latex_phase_b_verify_20261103` databases. Synthetic records were retained.
- Phase A opt-in transaction regression: **6/6 passed**.
- Phase B opt-in transaction/integration suite: **17/17 passed** as of the last run. It covers exact boundary and stale draft rollback, concurrent confirmation, quantity/profit, expense allocation and reversals, invoice debit/credit and credit rollback, paid and dispatched purchase correction, concurrent transfer, and the purchase -> supplier payment -> dispatch -> expense -> reconciliation -> invoice -> settlement -> profit path. One intermediate E2E assertion failed because it included a different test buyer's receivable; the test was isolated to its own buyer and passed on rerun.
- Shared arithmetic tests: **9/9 passed**, including large-intermediate ratio precision.
- Repository-wide `npm run typecheck`: **passed**. `npm test`: **15/15 baseline tests passed** (9 domain, 5 API/security, 1 web); the 23 opt-in MongoDB cases were skipped by that baseline command but separately executed as stated above.
- `npm run build`: **passed** for domain, API, and web with an explicit staging-shaped `VITE_API_URL`. The initial web JavaScript chunk is **761.36 kB** (222.29 kB gzip) and still exceeds Vite's 500 kB warning threshold.
- A separate local-only `latex_phase_b_browser_20261103` database was bootstrapped with a synthetic test administrator. The test API and Vite app started successfully and were stopped afterward. The in-app browser could not initialize, so no browser UI assertions or receipt-print tests were executed. Synthetic test records were retained.

## Remaining acceptance blockers and risks

1. The suite is below the requested full financial acceptance matrix. Browser-driven cashier/operator E2E and receipt-print verification have not run. The service-layer full financial path is not a UI acceptance test.
2. A dedicated partial customer-refund workflow is absent. Phase A's full receipt reversal posts a compensating cash movement, but invoice credits below receipts collected remain blocked until receipt reversal/refund is explicitly handled.
3. Transfer-vs-transfer concurrency is guarded and tested, but all Phase A and B debit paths do not share a single atomic non-overdraft policy. Define whether bank overdrafts are allowed and enforce/test cash insufficiency consistently.
4. Paid purchases with allocated supplier payments require reversal before correction. A cash-paid replacement can carry the same payment but cannot change/refund it in the correction. Dispatched supplier or settlement changes require a separate, approved cross-ledger workflow; none is implemented.
5. Business decisions remain for backdated entries, weighbridge document upload/retention, independent approvals, tax, and buyer notification for cost corrections after invoicing. Approval metadata commonly identifies the authorized acting user but does not enforce two-person control.
6. Cheque lifecycle, formal chart of accounts, returns/inventory adjustments, report exports, and Phase D security/performance/deployment gates remain open. The web initial bundle warning persists.
7. The new unique purchase-correction index and other Phase B indexes must be checked and built in staging against a representative copy before production rollout; no live-database index migration was attempted here.

**Acceptance decision:** Phase B does **not** yet meet all customer-deployment acceptance criteria. The outstanding financial-policy, refund, approval, and UI/E2E gates must be resolved and retested before a production claim.
