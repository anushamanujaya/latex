# Phase A — Financial management implementation

Implementation date: 2026-11-02. This document records the delivered behavior, verification evidence, and remaining deployment risks. It does not declare the application production-ready.

## Delivered modules

### Supplier liabilities and payments

- `SupplierPayment` records an immutable payment header and explicit purchase allocations.
- Posting conditionally decrements each purchase's outstanding liability inside one MongoDB transaction. Allocations must exactly equal the payment amount.
- Cash/bank movement and supplier-ledger payment entries are committed in the same transaction.
- Reversal restores each purchase liability and writes supplier/cash compensation records. The original payment becomes `REVERSED`; it is never deleted or overwritten.
- Cash reversals use the operator's current open shift. A previously closed reconciliation is never changed.

### Advances, loans, and recovery

- Advance issue creates the supplier advance asset, supplier-ledger entry, cash/bank outflow, and audit record atomically.
- Purchases explicitly allocate advances. Allocation reduces both the supplier obligation and advance asset without changing purchase cost.
- Direct repayment records cash/bank inflow and reduces the recoverable advance.
- Allocation, repayment, and unused issuance have guarded compensating reversal operations and idempotency keys.
- Legacy non-reversed advances remain eligible for purchase allocation and repayment. Historical advances created before account linkage cannot be issuance-reversed until their cash-account provenance is reviewed; the system does not invent or silently backfill that provenance.

### Cash, bank, and daily cashier control

- `CashBankAccount` balances are calculated from signed `CashBankTransaction` records, not editable balance fields.
- Opening balances, purchase cash payments, supplier payments, advances, repayments, company receipts, reversals, and approved shift variances are ledger movements.
- Cash movements require an open shift for the acting user and matching cash account. Bank movements require a bank account and no cashier shift.
- Close calculates `opening float + all shift movements`, compares it with counted cash, and stores the variance. Cashiers cannot approve a non-zero variance; admin, manager, or accountant roles can.
- Opening and closing are idempotent. Closed shifts are historical records and are not reused for later reversals.

### Company receivables and settlements

- One invoice may be created for one reconciled dispatch. Invoice creation posts buyer receivable and changes a confirmed dispatch to `FINALIZED` atomically.
- Partial/full receipts decrement invoice outstanding, post buyer ledger and cash/bank movements, and retain payment history.
- Receipt reversal restores receivable and writes a cash/bank compensation record. Dispatch revenue and invoice total remain unchanged.

### Operator UI and APIs

- `/payments`: allocate supplier payments and perform audited reversals.
- `/advances`: issue advances, view recovery, accept repayments, and reverse eligible issues/repayments.
- `/pos`: select an available supplier advance and apply an explicit recovery amount during purchase settlement.
- `/cash-bank`: live account balances, movement history, shift open, close, and reconciliation.
- `/sales`: create dispatch invoices, view receivables, receive company payments, and reverse receipts.
- Read APIs provide supplier statements, buyer statements, payment history, advance history, cashier shifts, accounts, transactions, invoices, and settlements.

## Accounting invariants

1. Purchase `totalCents` is the procurement-cost snapshot and is not changed by payment, advance allocation, repayment, or reversal.
2. Dispatch revenue and profit do not include supplier payments or advances.
3. Supplier liabilities change only through supplier ledger entries paired with the corresponding source operation.
4. Cash/bank balance is the sum of signed movements. No workflow directly edits a stored balance.
5. Buyer receivable is the sum of buyer ledger entries; a receipt never changes invoiced revenue.
6. Every multi-document financial operation runs in a MongoDB transaction and uses a unique idempotency key.
7. Corrections append compensation and audit records; historical source records are retained.

## Verification evidence

- `npm run typecheck`: passed for domain, API, and web.
- `npm test`: 12 baseline tests passed; the database integration suite is skipped unless explicitly enabled.
- `RUN_FINANCIAL_INTEGRATION=true` against the local MongoDB replica set: 6 tests passed.
- Covered database flows: idempotent payment retry; payment allocation and reversal; advance repayment; allocation and issue reversal; repayment reversal; company invoice, partial receipt, and receipt reversal; exact zero-variance cashier close; cash balance; preservation of procurement cost and invoice revenue.
- `npm run build`: API and web production builds passed. Vite reports a 736.92 kB initial JavaScript chunk; route splitting remains Phase D work.
- Tests used the isolated `latex_phase_a_test` database. No existing development or customer records were deleted or rewritten.

## Remaining risks and gates

- Phase B dispatch reconciliation is required before company invoice creation is a complete real-world workflow. Actual accepted KG, discrepancy approval, and post-dispatch finalization are not yet implemented.
- Purchase correction/replacement is still missing. Supplier-payment correction does not solve an incorrect weight, density, rate, or supplier on the source purchase.
- Expense posting, cash/bank transfers, cheque states, and accountant-approved opening-balance migration are not yet implemented.
- Existing advances without recorded account provenance require explicit financial review; no automatic historical cash entries are created.
- The full concurrency/E2E/security/export acceptance matrix, NIC encryption, session revocation/MFA, route code splitting, and production deployment smoke tests remain later phases.
- Production deployment and customer data remain blocked.
