# Domain architecture

The suite is split into independently deployable `apps/api` and `apps/web` applications, with financial and measurement rules in `packages/domain`. The API follows route/controller-style handlers -> application services -> Mongoose repositories/models. Services own transactions and invariants; HTTP handlers never calculate financial totals.

## Core relationships and invariants

- A `Supplier` owns purchases, payments, advances, and immutable double-sided `SupplierLedgerEntry` records. Its displayed balance is an aggregate, never an editable field.
- A `Purchase` snapshots density-table version/factor and rate source/value. Money is integer LKR cents; litres, kilograms, and factors are scaled integers. Corrections create reversal/replacement records.
- A collection-location `Counter` atomically assigns every purchase an increasing sequence. `(locationId, sequence)` and bill number are unique.
- A `DispatchBatch` stores inclusive first/last sequences. Confirmation transactionally claims every eligible unassigned purchase after the previous confirmed boundary through the selected final purchase. Unique assignment and conditional updates prevent overlaps.
- Supplier obligation, advance asset, cash movement, procurement cost, buyer receivable, and revenue are separate postings. Allocating an advance settles an obligation; it never changes purchase cost.
- Historical amounts are snapshots. Configuration/rate changes only affect later events.
- Audit records are append-only and capture actor, reason, request correlation, and before/after values.

## Main data graph

`Supplier -> Purchase -> SupplierLedgerEntry`

`Supplier -> SupplierAdvance -> AdvanceAllocation -> Purchase`

`CollectionLocation -> Purchase(sequence) -> DispatchBatch -> BuyerCompany -> CompanySettlement`

`CashBankAccount -> CashBankTransaction` links payment events without redefining their accounting nature.

`CashierShift -> CashBankTransaction` defines the immutable opening-to-closing reconciliation boundary for cash movements.

`DispatchBatch -> CompanyInvoice -> CompanySettlement -> BuyerLedgerEntry` separates sale revenue, receivable, and collection.

## UI screens

Dashboard; keyboard-first Latex POS and receipt; purchase history/detail/reversal; suppliers and statements; advances and payments; rate/density settings; derived inventory; dispatch boundary picker/preview/confirmation; companies and settlements; expenses/cash book; reports/exports; audit; staff/roles; business settings.

## Conservative defaults and unresolved business choices

- Rounding: KG half-up to 3 decimals; money half-up to 2 decimals. Both are explicit settings, but changing them is prospective.
- One default collection location is seeded; multi-location sequencing is already modeled.
- A normal dispatch takes all unassigned, non-reversed purchases through an inclusive boundary. Split quantities require a future, explicit residual workflow.
- Supplier liabilities and advances remain gross; automatic netting is disabled. Operators explicitly allocate an advance.
- Inventory uses calculated purchased KG until an authorized physical adjustment or accepted dispatch quantity records a variance.
- Tax treatment, chart-of-accounts integration, cheque lifecycle, and Sinhala wording require owner/accountant confirmation before production use.

## Phased checklist

- [x] Phase 1: workspace, domain arithmetic, API foundation, database, authentication/RBAC, settings foundation, responsive shell.
- [x] Phase 2: supplier, density/rates, purchase service/API, functional POS.
- [x] Phase 3: print-safe 80 mm receipt and purchase history/reprint route.
- [x] Phase 4: transactional purchase settlement/advance allocation and supplier ledger foundation.
- [x] Phase 5: pending inventory and sequence-boundary dispatch preview/confirmation foundation.
- [x] Phase 6: snapshot-based dispatch profit calculation.
- [x] Phase A financial foundation: allocated supplier payments/reversals, advances/recovery/reversals, cash/bank ledger, cashier reconciliation, and buyer receivables/settlements.
- [ ] Phase 7: full report catalogue, XLSX/PDF exports, and all analytics screens.
- [ ] Phase 8: complete E2E matrix, hardened production operations, backup-restore drill, observability, and deployment smoke tests.

The checked phases mean their core vertical slice exists; the unchecked items and advanced correction/reconciliation screens remain explicit follow-on scope.
