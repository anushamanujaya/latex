# Phase B final-acceptance continuation — 2026-11-04

> **Final closure update (2026-11-04):** Eight additional independent browser scenarios were implemented in the existing Playwright suite. The final-code isolated run passed **20/20 in 198.445 seconds** on `latex_dev_phase_b_e2e_closure_v6`. Phase A MongoDB **6/6**, Phase B MongoDB **25/25**, repository **16/16**, TypeScript, and production build passed again. See [final release report](FINAL_RELEASE_REPORT.md) for the two release decisions. Earlier 12-flow figures below are retained as the preceding snapshot, not the current result. Actual staging, physical printer, and accounting-policy gates remain open; Phase B is **NOT ACCEPTED** for real customers.

**Decision: NOT ACCEPTED for customer deployment.** This continuation used isolated local MongoDB replica-set databases and synthetic records only. No production database was accessed, reset, seeded, or migrated; no commit, push, or deployment occurred. The repository remains on `main` with preexisting uncommitted work preserved.

## Completed software work

- Audited the correction boundary in [cross-ledger policy](PHASE_B_CROSS_LEDGER_POLICY.md). Existing approved paths preserve posted purchase/payment history, dispatch boundaries, supplier and buyer ledgers, and cash/bank movements. Unspecified cross-supplier and dispatched-settlement accounting remains blocked; no rule was invented.
- New purchase corrections store an exact request-payload hash. A retry with the same key and different financial details is rejected, including a concurrent duplicate-key race. Previously created correction rows without this hash retain legacy retry behavior and require staging review.
- Added MongoDB tests for a forbidden dispatched cash-settlement change with ledger rollback, and two competing independently approved purchase corrections with only one winner. Existing suites also cover partial/final refunds, cash delta, transfer concurrency, approvals, and purchase-to-settlement profit.
- Added cash/bank transfer history and a maker/checker reversal-request control. A successful transfer/reversal browser flow verifies both balances return to their original values.
- Receipt now displays the stored latex subtotal and signed price adjustment separately, with total/advance/cash/outstanding verified against database arithmetic. A self-hosted Noto Sans Sinhala font fixed the illegible Sinhala name in the local browser PDF. No tax field or distinct discount classification exists in the purchase model; these cannot honestly be printed or validated as separate amounts until finance defines them.
- Added seven independent browser scenarios beyond the original five, including approved unused-advance and repayment reversals. The suite now has twelve independent flows. The original 20 checkpoints remain checkpoints, **not** 20 independent flows. See [browser matrix](PHASE_B_BROWSER_MATRIX.md).

## Executed tests and evidence

| Check | Result |
|---|---|
| Phase A opt-in MongoDB transaction/integration suite | **6/6 passed** on isolated `latex_phase_a_final_acceptance_20261104_v1` |
| Phase B opt-in MongoDB transaction/integration suite | **25/25 passed** on isolated `latex_phase_b_final_acceptance_20261104_v2` |
| Repository `npm test` | **16/16 passed**: domain 9, API/authorization 6, web 1; opt-in MongoDB suites are skipped by this command and were run separately |
| Repository TypeScript check | **Passed** |
| Production `npm run build` | **Passed**; initial web JavaScript 311.10 kB (98.82 kB gzip), dashboard separate at 366.00 kB |
| Local API and web `vercel-build` scripts | **Passed**; compilation/build only, no preview deployment or remote staging test |
| Local Playwright/Chromium suite | **12/12 passed in 130.033 seconds** on isolated `latex_dev_phase_b_e2e_20261104_cont_v2` |
| Strengthened supplier-statement checks for the two advance flows | **2/2 passed in 25.633 seconds** on separate isolated `latex_dev_phase_b_e2e_20261104_cont_v3`; verified compensating supplier-ledger deltas as well as bank balances |
| Local production-configuration shape smoke | Unsafe localhost/HTTP/insecure-cookie production shape **rejected**; fake Atlas-SRV/HTTPS/secure-cookie shape **accepted without connecting** |
| Production dependency audit | `npm audit --omit=dev`: **0 vulnerabilities**; full development-tool audit: **3 advisories** (Vitest/tinypool tree), not automatically upgraded |
| Browser-generated receipt PDF | One page, 227.04 pt (about 80 mm) wide; text and rendered image inspected, no horizontal clipping observed, Sinhala supplier name legible after font change |

Individual browser scenarios, all passed in the final local run:

1. Purchase → confirmed dispatch → independent accepted-KG reconciliation → invoice → partial receipt → credit/refund → unsafe receipt reversal rejected.
2. Cashier denied financial approvals and audit.
3. Paid cash purchase → approved signed cash correction; original movement preserved.
4. Supplier payment → independent reversal; payable restored without changing purchase cost.
5. Checker rejects purchase correction; original KG, cost, and outstanding remain unchanged.
6. Maker cancels purchase correction; original purchase remains unchanged.
7. General expense → bank payment → independent reversal; bank balance and audit reconcile.
8. Overdrawn transfer rejected atomically without changing either account.
9. Successful transfer → independent reversal; both account balances restored.
10. Sinhala supplier → latex purchase/receipt and browser print PDF → independently approved correction.
11. Unused supplier advance → independent reversal → original bank balance restored, source status and audit verified.
12. Supplier advance → partial repayment → independent repayment reversal → bank and available advance balance restored.

Interim failures were not hidden: an earlier new-role test hit the default five-second timeout, then a test assumption expected `400` for a privileged request while the intentionally database-free test environment returned `503`; the role test was scoped to deterministic denied roles and the final repository suite passed. An individual new transfer browser test initially hit the local login rate limit after prior runs; restarting only the local test API cleared the in-memory limiter. The first two advance browser tests passed but emitted a Playwright duplicate-dialog-handler callback error; that test-harness error was removed before the clean 12/12 fresh-database run. No financial assertion failure or production-data mutation occurred.

## Open acceptance gates

1. **Accounting policy:** dispatched changes to already-posted cash, supplier payment, advance allocation, or supplier identity; cross-supplier cash-paid transfers; refund/recovery of a settled reduction; backdated amendments; tax and discount classification; cheque treatment; invoice/buyer notification after cost changes; legacy negative balances. These need finance-owner decisions before code.
2. **Browser coverage:** twelve independent scenarios are implemented, not the requested complete independent-flow matrix. Missing advance allocation/reversal on a purchase, company-settlement reversal, direct-dispatch expense/adjustment reversal, concurrent cashiers, stale-execution, mobile/tablet, and other variants are listed in the [matrix](PHASE_B_BROWSER_MATRIX.md).
3. **Physical printer:** **PENDING**. Local CSS/screenshot/PDF checks passed, but no actual 80 mm thermal printer, driver, paper, or cashier sign-off was available. Follow the [hardware checklist](PHASE_B_RECEIPT_PRINT_CHECK.md).
4. **Staging:** **PENDING**. No separate Atlas staging credentials, HTTPS staging URLs, Vercel preview, restore test, real staging logs/metrics, or migration/index validation existed. The [staging gate](PHASE_B_STAGING_VERIFICATION.md) defines evidence required; local build/config checks are not staging acceptance.
5. Later-phase reports/exports, NIC protection, session revocation/MFA, and security/performance work remain outside this acceptance continuation. Resolve the development-tool audit advisories in a controlled dependency update and rerun all tests.

**Final readiness decision: NOT ACCEPTED / NOT PRODUCTION READY.** Keep financial customer operation blocked until mandatory policy, browser, hardware, and staging gates are signed off with actual evidence.
