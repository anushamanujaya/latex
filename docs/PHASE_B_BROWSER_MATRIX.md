# Phase B browser acceptance matrix

The local Playwright suite is `tests/browser/test_acceptance.py`. It uses synthetic users and an isolated `latex_dev_phase_b_e2e_*` MongoDB replica-set database; it does not reset data. **Final-code closure run: 20/20 independent browser scenarios passed in 198.445 seconds** on `latex_dev_phase_b_e2e_closure_v6`. Eight new scenarios were added to the previously passing twelve. An earlier combined run failed while local Vite/API hot reloads coincided with builds. A later mobile-print test failed because its spy assignment was itself evaluated as a function by Playwright; the test setup was corrected, passed individually, then the full final-code suite passed. The original 20 checkpoints below are separate checkpoints, not these 20 independent end-to-end tests.

| Independent scenario | Browser test | Latest result |
|---|---|---|
| Purchase → dispatch → approved weight → invoice → receipt → credit/refund → unsafe reversal rejected | `test_00_purchase_dispatch_reconcile_invoice_and_settlement` | Passed locally |
| Cashier cannot access financial approval/audit | `test_01_cashier_cannot_approve_or_read_audit` | Passed locally |
| Cash-paid purchase → approved cash correction delta | `test_02_paid_purchase_cash_correction` | Passed locally |
| Supplier payment → independent reversal → payable restored, purchase cost unchanged | `test_03_supplier_payment_reversal_requires_checker` | Passed locally |
| Purchase correction rejected by checker → source unchanged | `test_04_rejected_purchase_correction_preserves_history` | Passed locally |
| Purchase correction cancelled by maker → source unchanged | `test_05_maker_cancels_purchase_correction` | Passed locally |
| General expense → bank payment → approved reversal → bank/audit reconciliation | `test_06_paid_expense_reversal_restores_bank_and_audit` | Passed locally |
| Attempted overdrawn internal transfer → no account change | `test_07_insufficient_bank_transfer_is_atomic` | Passed locally |
| Successful transfer → independent reversal → both balances restored | `test_08_transfer_reversal_restores_both_accounts` | Passed locally |
| Unused supplier advance → independent reversal → bank restored and source audited | `test_09_unused_advance_reversal_restores_bank_and_supplier` | Passed locally |
| Supplier advance → partial repayment → independent repayment reversal → bank and advance restored | `test_10_repayment_reversal_restores_advance_and_bank` | Passed locally |
| Supplier advance → purchase allocation → payable/cost reconcile with no second bank outflow | `test_11_purchase_uses_advance_without_new_cash_cost` | Passed locally |
| Reconciled dispatch → invoice → company receipt → approved safe reversal → bank/receivable restored | `test_12_company_receipt_reversal_restores_receivable_and_bank` | Passed locally |
| Reconciled dispatch → direct expense → approved reversal → net profit restored | `test_13_direct_dispatch_expense_reversal_restores_profit` | Passed locally |
| Reconciled dispatch → profit adjustment → approved reversal → net profit restored | `test_14_profit_adjustment_reversal_restores_net_profit` | Passed locally |
| Cashier shift opened → counted close → zero-variance reconciliation and role isolation | `test_15_cashier_open_close_reconciles_without_variance` | Passed locally |
| Two competing approved purchase corrections → second execution rejected after first posts | `test_16_stale_approved_purchase_correction_does_not_post` | Passed locally |
| Cash-paid purchase → cross-supplier correction independently approved but execution blocked without policy | `test_17_cross_supplier_cash_correction_is_blocked` | Passed locally |
| Mobile purchase receipt → reload/reprint layout → no duplicate purchase | `test_18_mobile_receipt_reprint_does_not_duplicate_purchase` | Passed locally |
| Sinhala supplier → latex purchase → receipt/print → independent correction | `test_purchase_receipt_and_independent_correction` | Passed locally; browser-generated PDF inspected |

| # | Browser checkpoint | Automated test |
|---|---|---|
| 1 | Administrator signs in through the login UI | `test_00_purchase_dispatch_reconcile_invoice_and_settlement` |
| 2 | Cashier cannot view approvals or financial audit | `test_01_cashier_cannot_approve_or_read_audit` |
| 3 | Supplier with Sinhala name is registered through UI | `test_purchase_receipt_and_independent_correction` |
| 4 | POS converts 10 L / density 150 to 4.000 KG | `test_purchase_receipt_and_independent_correction` |
| 5 | POS persists purchase and creates receipt | `test_purchase_receipt_and_independent_correction` |
| 6 | Reloading receipt does not change its financial fields | `test_purchase_receipt_and_independent_correction` |
| 7 | Print-media receipt width fits 80 mm CSS and Sinhala content remains visible | `test_purchase_receipt_and_independent_correction` |
| 8 | Purchase correction request is submitted without immediate mutation | `test_purchase_receipt_and_independent_correction` |
| 9 | Maker has no self-approval action | `test_purchase_receipt_and_independent_correction` |
| 10 | Independent checker approves and maker executes correction | `test_purchase_receipt_and_independent_correction` |
| 11 | Cashier shift is opened before a paid cash purchase | `test_02_paid_purchase_cash_correction` |
| 12 | Fully cash-paid purchase is saved and receipted | `test_02_paid_purchase_cash_correction` |
| 13 | Approved cash correction posts only the refund delta and new outstanding balance | `test_02_paid_purchase_cash_correction` |
| 14 | Supplier payment allocates to a purchase without changing cost | `test_03_supplier_payment_reversal_requires_checker` |
| 15 | Reversal request leaves supplier payment and balance unchanged until approval | `test_03_supplier_payment_reversal_requires_checker` |
| 16 | Independent reversal restores liability with compensating history | `test_03_supplier_payment_reversal_requires_checker` |
| 17 | Dispatch preview and permanent boundary lock use the selected sequence | `test_00_purchase_dispatch_reconcile_invoice_and_settlement` |
| 18 | Company weight request, checker approval and final gross profit are verified | `test_00_purchase_dispatch_reconcile_invoice_and_settlement` |
| 19 | Invoice and partial company receipt are posted through the UI | `test_00_purchase_dispatch_reconcile_invoice_and_settlement` |
| 20 | Credit below receipts, approved refund, and rejected unsafe receipt reversal are exercised | `test_00_purchase_dispatch_reconcile_invoice_and_settlement` |

These 20 local flows do **not** establish every conceivable variant. Advance-allocation reversal has a service/integration test but no dedicated browser flow; concurrent browser cashiers, cross-account correction, tablet layout, and every receipt/refund print variant are not independently browser-tested. Local browser success is not production-shaped staging, and no physical printer was tested. Policy-dependent cross-ledger workflows remain blocked; do not infer real-customer readiness from the scenario count.
