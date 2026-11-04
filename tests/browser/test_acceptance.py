"""Local Playwright smoke for an isolated latex_dev_phase_b_e2e_* database.

Run only with local API/Vite servers pointed at that dedicated database.
No database cleanup is performed by this test.
"""

import os
import unittest
from pathlib import Path
from uuid import uuid4

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:5173")
PASSWORD = os.environ.get("E2E_PASSWORD")


class PhaseBBrowserSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not PASSWORD or len(PASSWORD) < 12:
            raise RuntimeError("Set synthetic E2E_PASSWORD before running browser acceptance")
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True)
        cls.auth_cookies = {}

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def login(self, page, email):
        if email in self.auth_cookies:
            page.context.add_cookies(self.auth_cookies[email])
            page.goto(BASE_URL)
            page.get_by_role("link", name="New purchase").wait_for(timeout=20000)
            return
        page.goto(BASE_URL)
        page.get_by_label("Email address").fill(email)
        page.get_by_label("Password").fill(PASSWORD)
        page.get_by_role("button", name="Sign in securely").click()
        page.get_by_role("link", name="New purchase").wait_for(timeout=20000)
        self.auth_cookies[email] = page.context.cookies()

    def create_unpaid_purchase(self, page):
        page.goto(f"{BASE_URL}/pos")
        supplier_response = page.request.get(f"{BASE_URL}/api/v1/suppliers")
        self.assertEqual(supplier_response.status, 200, supplier_response.text()[:300])
        self.assertTrue(any(item["code"] == "E2E-SUP-001" for item in supplier_response.json()["data"]))
        supplier = page.get_by_label("Supplier")
        option = supplier.locator("option").filter(has_text="E2E-SUP-001").first
        try:
            option.wait_for(state="attached", timeout=10000)
        except Exception:
            print("Supplier selector diagnostic:", supplier.locator("option").all_text_contents(), page.locator("body").inner_text()[-500:])
            raise
        supplier.select_option(value=option.get_attribute("value"))
        page.get_by_label("Latex volume (litres)").fill("10")
        page.get_by_label("Density reading").select_option("150")
        page.get_by_role("button", name="Save only").click()
        page.locator("#receipt").wait_for(timeout=20000)
        return page.url.split("/purchases/")[1].split("/")[0]

    def issue_advance(self, page, amount):
        before_ids = {item["_id"] for item in page.request.get(f"{BASE_URL}/api/v1/advances").json()["data"]}
        page.goto(f"{BASE_URL}/advances")
        supplier = page.get_by_label("Supplier")
        option = supplier.locator("option").filter(has_text="E2E-SUP-001").first
        option.wait_for(state="attached")
        supplier.select_option(value=option.get_attribute("value"))
        page.get_by_label("Advance amount").fill(amount)
        page.get_by_label("Method").select_option("BANK")
        page.get_by_label("Account").select_option(label="E2E-BANK")
        page.get_by_label("Reference").fill(f"BROWSER-ADV-{uuid4().hex[:8]}")
        page.get_by_role("button", name="Issue advance").click()
        page.get_by_text("Advance issued and posted to the supplier and cash ledgers.").wait_for(timeout=15000)
        created = [item for item in page.request.get(f"{BASE_URL}/api/v1/advances").json()["data"] if item["_id"] not in before_ids]
        self.assertEqual(len(created), 1)
        return created[0]

    def approve_and_execute_first_request(self, page, checker):
        page.goto(f"{BASE_URL}/approvals")
        page.get_by_role("link", name="Review").first.click()
        approval_url = page.url
        self.assertEqual(page.get_by_role("button", name="Approve").count(), 0)
        checker.goto(approval_url)
        checker.get_by_label("Decision or cancellation reason").fill("Checked original posting and both financial ledgers")
        checker.once("dialog", lambda dialog: dialog.accept())
        checker.get_by_role("button", name="Approve").click()
        checker.get_by_text("APPROVED", exact=True).first.wait_for(timeout=15000)
        page.reload()
        page.get_by_role("button", name="Execute approved request").click()
        page.get_by_text("EXECUTED", exact=True).first.wait_for(timeout=15000)

    def create_reconciled_dispatch(self, page, checker):
        purchase_id = self.create_unpaid_purchase(page)
        purchase = page.request.get(f"{BASE_URL}/api/v1/purchases/{purchase_id}").json()["data"]
        before_dispatch_ids = {d["_id"] for d in page.request.get(f"{BASE_URL}/api/v1/dispatches").json()["data"]}
        page.goto(f"{BASE_URL}/dispatches")
        page.get_by_label("Final included sequence").fill(str(purchase["sequence"]))
        page.get_by_label("Buyer company").select_option(index=1)
        page.get_by_label("Vehicle").fill(f"BROWSER-{uuid4().hex[:8]}")
        page.get_by_role("button", name="Preview boundary").click()
        page.get_by_role("button", name="Persist & lock").click()
        page.get_by_role("link", name="Open").first.wait_for(timeout=20000)
        created = [d for d in page.request.get(f"{BASE_URL}/api/v1/dispatches").json()["data"] if d["_id"] not in before_dispatch_ids]
        self.assertEqual(len(created), 1)
        dispatch_id = created[0]["_id"]
        dispatch_url = f"{BASE_URL}/dispatches/{dispatch_id}"
        page.goto(dispatch_url)
        page.get_by_label("Accepted KG").fill("4")
        page.get_by_label("Selling rate / KG").fill("1000")
        page.get_by_label("Weighbridge reference").fill(f"WB-{uuid4().hex[:8]}")
        page.get_by_label("Discrepancy / correction reason").fill("Independent company weight certificate")
        page.get_by_role("button", name="Request reconciliation approval").click()
        page.get_by_text("Weighbridge reconciliation submitted").wait_for(timeout=15000)
        self.approve_and_execute_first_request(page, checker)
        detail = page.request.get(f"{BASE_URL}/api/v1/dispatches/{dispatch_id}").json()["data"]
        self.assertTrue(any(p["_id"] == purchase_id for p in detail["purchases"]))
        self.assertEqual(detail["dispatch"]["acceptedKgMilli"], 4000)
        return dispatch_id, dispatch_url, detail["dispatch"]

    def test_00_purchase_dispatch_reconcile_invoice_and_settlement(self):
        admin_context = self.browser.new_context(locale="en-LK", viewport={"width": 1280, "height": 900})
        checker_context = self.browser.new_context(locale="en-LK")
        try:
            page = admin_context.new_page()
            self.login(page, "admin@e2e.test")
            page.goto(f"{BASE_URL}/pos")
            supplier = page.get_by_label("Supplier")
            option = supplier.locator("option").filter(has_text="E2E-SUP-001").first
            option.wait_for(state="attached")
            supplier.select_option(value=option.get_attribute("value"))
            page.get_by_label("Latex volume (litres)").fill("10")
            page.get_by_label("Density reading").select_option("150")
            page.get_by_role("button", name="Save only").click()
            page.locator("#receipt").wait_for(timeout=20000)
            purchase_id = page.url.split("/purchases/")[1].split("/")[0]
            purchase = page.request.get(f"{BASE_URL}/api/v1/purchases/{purchase_id}").json()["data"]
            self.assertEqual(purchase["kgMilli"], 4000)

            page.goto(f"{BASE_URL}/dispatches")
            page.get_by_label("Final included sequence").fill(str(purchase["sequence"]))
            page.get_by_label("Buyer company").select_option(index=1)
            page.get_by_label("Vehicle").fill("E2E-BOWSER")
            page.get_by_role("button", name="Preview boundary").click()
            page.get_by_text("SEQ", exact=False).first.wait_for()
            page.get_by_role("button", name="Persist & lock").click()
            page.get_by_role("link", name="Open").first.wait_for(timeout=20000)
            page.get_by_role("link", name="Open").first.click()
            dispatch_url = page.url
            dispatch_id = dispatch_url.split("/dispatches/")[1].split("/")[0]
            page.get_by_label("Accepted KG").fill("3.9")
            page.get_by_label("Selling rate / KG").fill("1000")
            page.get_by_label("Weighbridge reference").fill("WB-BROWSER-E2E")
            page.get_by_label("Discrepancy / correction reason").fill("Company scale recorded lower accepted weight")
            page.get_by_role("button", name="Request reconciliation approval").click()
            page.get_by_text("Weighbridge reconciliation submitted").wait_for(timeout=15000)

            page.goto(f"{BASE_URL}/approvals")
            page.get_by_role("link", name="Review").first.click()
            approval_url = page.url
            self.assertEqual(page.get_by_role("button", name="Approve").count(), 0)
            checker = checker_context.new_page()
            self.login(checker, "checker@e2e.test")
            checker.goto(approval_url)
            checker.get_by_label("Decision or cancellation reason").fill("Independent company scale review")
            checker.on("dialog", lambda dialog: dialog.accept())
            checker.get_by_role("button", name="Approve").click()
            checker.get_by_text("APPROVED", exact=True).first.wait_for(timeout=15000)
            page.reload()
            page.on("dialog", lambda dialog: dialog.accept())
            page.get_by_role("button", name="Execute approved request").click()
            page.get_by_text("EXECUTED", exact=True).first.wait_for(timeout=15000)

            page.goto(dispatch_url)
            page.get_by_label("Accepted KG").wait_for(timeout=15000)
            self.assertIn("3.900 kg", page.locator("body").inner_text())
            dispatch = page.request.get(f"{BASE_URL}/api/v1/dispatches/{dispatch_id}").json()["data"]["dispatch"]
            self.assertEqual(dispatch["revenueCents"], 390_000)
            self.assertEqual(dispatch["grossProfitCents"], 62_000)
            page.goto(f"{BASE_URL}/sales")
            invoice_form = page.locator("form").filter(has_text="Create company invoice")
            invoice_form.locator("select").select_option(value=dispatch_id)
            invoice_form.get_by_role("button", name="Invoice").click()
            page.get_by_text("Company invoice created").wait_for(timeout=15000)
            invoice_records = page.request.get(f"{BASE_URL}/api/v1/company-invoices").json()["data"]
            invoice_id = next(item["_id"] for item in invoice_records if item["dispatchId"]["_id"] == dispatch_id)
            payment_form = page.locator("form").filter(has_text="Receive company payment")
            payment_form.locator("select").first.select_option(value=invoice_id)
            payment_form.get_by_placeholder("Amount").fill("1000")
            payment_form.locator("select").nth(2).select_option(index=1)
            payment_form.get_by_placeholder("Bank/reference number").fill("E2E-COMPANY-RECEIPT")
            payment_form.get_by_role("button", name="Post receipt").click()
            page.get_by_text("Company receipt posted").wait_for(timeout=15000)
            receipts = page.request.get(f"{BASE_URL}/api/v1/company-settlements").json()["data"]
            self.assertTrue(any(item.get("referenceNumber") == "E2E-COMPANY-RECEIPT" and item["invoiceId"]["_id"] == invoice_id for item in receipts))

            # A later weighbridge credit below money already collected creates a refundable liability.
            page.goto(dispatch_url)
            page.get_by_label("Accepted KG").wait_for(timeout=15000)
            page.get_by_label("Accepted KG").fill("0.5")
            page.get_by_label("Selling rate / KG").fill("1000")
            page.get_by_label("Weighbridge reference").fill("WB-BROWSER-CREDIT")
            page.get_by_label("Discrepancy / correction reason").fill("Final company certificate reduced the accepted weight")
            page.get_by_role("button", name="Request reconciliation approval").click()
            page.get_by_text("Weighbridge reconciliation submitted").wait_for(timeout=15000)
            page.goto(f"{BASE_URL}/approvals")
            page.get_by_role("link", name="Review").first.click()
            credit_approval_url = page.url
            checker.goto(credit_approval_url)
            checker.get_by_label("Decision or cancellation reason").fill("Final company certificate independently checked")
            checker.get_by_role("button", name="Approve").click()
            checker.get_by_text("APPROVED", exact=True).first.wait_for(timeout=15000)
            page.reload()
            page.get_by_role("button", name="Execute approved request").click()
            page.get_by_text("EXECUTED", exact=True).first.wait_for(timeout=15000)
            credited_invoice = page.request.get(f"{BASE_URL}/api/v1/company-invoices").json()["data"]
            credited_invoice = next(item for item in credited_invoice if item["_id"] == invoice_id)
            self.assertEqual(credited_invoice["refundDueCents"], 50_000)

            page.goto(f"{BASE_URL}/sales")
            refund_form = page.locator("form").filter(has_text="Request company refund")
            refund_form.locator("select").first.select_option(value=invoice_id)
            refund_form.locator("select").nth(2).select_option(index=1)
            refund_form.locator("textarea").fill("Refund the verified company weighbridge credit")
            refund_form.get_by_role("button", name="Request approval").click()
            page.get_by_text("Refund submitted for independent approval").wait_for(timeout=15000)
            page.goto(f"{BASE_URL}/approvals")
            page.get_by_role("link", name="Review").first.click()
            refund_approval_url = page.url
            checker.goto(refund_approval_url)
            checker.get_by_label("Decision or cancellation reason").fill("Verified refund due and bank account")
            checker.get_by_role("button", name="Approve").click()
            checker.get_by_text("APPROVED", exact=True).first.wait_for(timeout=15000)
            page.reload()
            page.get_by_role("button", name="Execute approved request").click()
            page.get_by_text("EXECUTED", exact=True).first.wait_for(timeout=15000)
            refunds = page.request.get(f"{BASE_URL}/api/v1/company-refunds").json()["data"]
            self.assertTrue(any(item["invoiceId"]["_id"] == invoice_id and item["amountCents"] == 50_000 for item in refunds))

            # Once refunded, the original receipt cannot be reversed without recovering that cash.
            original_receipt = next(item for item in receipts if item.get("referenceNumber") == "E2E-COMPANY-RECEIPT" and item["invoiceId"]["_id"] == invoice_id)
            page.goto(f"{BASE_URL}/sales")
            receipt_row = page.locator("tr").filter(has_text=original_receipt["receiptNumber"])
            receipt_row.get_by_role("button").click()
            page.get_by_text("Receipt reversal submitted for independent approval").wait_for(timeout=15000)
            page.goto(f"{BASE_URL}/approvals")
            page.get_by_role("link", name="Review").first.click()
            reversal_approval_url = page.url
            checker.goto(reversal_approval_url)
            checker.get_by_label("Decision or cancellation reason").fill("Independent receipt reversal review")
            checker.get_by_role("button", name="Approve").click()
            checker.get_by_text("APPROVED", exact=True).first.wait_for(timeout=15000)
            page.reload()
            page.get_by_role("button", name="Execute approved request").click()
            page.get_by_text("Refunded cash must be recovered before reversing this receipt").wait_for(timeout=15000)
            self.assertEqual(page.get_by_text("APPROVED", exact=True).count(), 1)
            current_receipt = page.request.get(f"{BASE_URL}/api/v1/company-settlements").json()["data"]
            self.assertEqual(next(item for item in current_receipt if item["_id"] == original_receipt["_id"])["status"], "POSTED")
        finally:
            admin_context.close()
            checker_context.close()

    def test_01_cashier_cannot_approve_or_read_audit(self):
        context = self.browser.new_context(locale="en-LK")
        try:
            page = context.new_page()
            self.login(page, "cashier@e2e.test")
            page.goto(f"{BASE_URL}/approvals")
            page.get_by_text("Could not load approvals.").wait_for(timeout=15000)
            self.assertEqual(page.request.get(f"{BASE_URL}/api/v1/approvals").status, 403)
            page.goto(f"{BASE_URL}/audit")
            page.get_by_text("Audit history could not be loaded.").wait_for(timeout=15000)
            self.assertEqual(page.request.get(f"{BASE_URL}/api/v1/audit").status, 403)
        finally:
            context.close()

    def test_02_paid_purchase_cash_correction(self):
        admin_context = self.browser.new_context(locale="en-LK")
        checker_context = self.browser.new_context(locale="en-LK")
        try:
            page = admin_context.new_page()
            self.login(page, "admin@e2e.test")
            page.goto(f"{BASE_URL}/cash-bank")
            shift_state = page.request.get(f"{BASE_URL}/api/v1/cashier-shifts/current").json()["data"]
            if not shift_state:
                page.get_by_role("button", name="Open shift").wait_for(timeout=15000)
                page.get_by_label("Cash account").select_option(index=1)
                page.get_by_label("Opening float").fill("100000")
                page.get_by_role("button", name="Open shift").click()
                page.get_by_text("Cashier shift opened.").wait_for(timeout=15000)
            page.goto(f"{BASE_URL}/pos")
            supplier = page.get_by_label("Supplier")
            option = supplier.locator("option").filter(has_text="E2E-SUP-001").first
            option.wait_for(state="attached")
            supplier.select_option(value=option.get_attribute("value"))
            page.get_by_label("Latex volume (litres)").fill("10")
            page.get_by_label("Density reading").select_option("150")
            page.get_by_label("Cash paid now (LKR)").fill("3280")
            page.get_by_role("button", name="Save only").click()
            try:
                page.locator("#receipt").wait_for(timeout=15000)
            except Exception:
                print("Paid purchase page:", ascii(page.locator("body").inner_text()[-1600:]))
                raise
            original_id = page.url.split("/purchases/")[1].split("/")[0]
            self.assertIn("PAID", page.locator("#receipt").inner_text())
            page.goto(f"{BASE_URL}/purchases/{original_id}/correct")
            page.get_by_label("Corrected cash paid (LKR)").fill("3000")
            page.get_by_label("Approval reason").fill("Supplier returned excess cash after confirmed count")
            page.on("dialog", lambda dialog: dialog.accept())
            page.get_by_role("button", name="Request correction approval").click()
            page.get_by_text("Correction requested.").wait_for(timeout=15000)
            page.goto(f"{BASE_URL}/approvals")
            page.get_by_role("link", name="Review").first.click()
            approval_url = page.url
            checker = checker_context.new_page()
            self.login(checker, "checker@e2e.test")
            checker.goto(approval_url)
            checker.get_by_label("Decision or cancellation reason").fill("Confirmed cash refund and original account")
            checker.on("dialog", lambda dialog: dialog.accept())
            checker.get_by_role("button", name="Approve").click()
            checker.get_by_text("APPROVED", exact=True).first.wait_for(timeout=15000)
            page.reload()
            page.get_by_role("button", name="Execute approved request").click()
            page.get_by_text("EXECUTED", exact=True).first.wait_for(timeout=15000)
            corrections = page.request.get(f"{BASE_URL}/api/v1/purchase-corrections").json()["data"]
            correction = next(item for item in corrections if item["originalPurchaseId"]["_id"] == original_id)
            replacement = page.request.get(f"{BASE_URL}/api/v1/purchases/{correction['replacementPurchaseId']['_id']}").json()["data"]
            self.assertEqual(replacement["cashPaidCents"], 300_000)
            self.assertEqual(replacement["outstandingCents"], 28_000)
            movements = page.request.get(f"{BASE_URL}/api/v1/cash-transactions").json()["data"]
            self.assertTrue(any(item["referenceType"] == "PurchaseCorrection" and item["referenceId"] == correction["_id"] and item["signedAmountCents"] == 28_000 for item in movements))
        finally:
            admin_context.close()
            checker_context.close()

    def test_03_supplier_payment_reversal_requires_checker(self):
        admin_context = self.browser.new_context(locale="en-LK")
        checker_context = self.browser.new_context(locale="en-LK")
        try:
            page = admin_context.new_page()
            self.login(page, "admin@e2e.test")
            page.goto(f"{BASE_URL}/pos")
            supplier = page.get_by_label("Supplier")
            option = supplier.locator("option").filter(has_text="E2E-SUP-001").first
            option.wait_for(state="attached")
            supplier_id = option.get_attribute("value")
            supplier.select_option(value=supplier_id)
            page.get_by_label("Latex volume (litres)").fill("10")
            page.get_by_label("Density reading").select_option("150")
            page.get_by_role("button", name="Save only").click()
            page.locator("#receipt").wait_for(timeout=15000)
            purchase_id = page.url.split("/purchases/")[1].split("/")[0]
            original_cost = page.request.get(f"{BASE_URL}/api/v1/purchases/{purchase_id}").json()["data"]["totalCents"]
            page.goto(f"{BASE_URL}/payments")
            page.get_by_label("Supplier").select_option(value=supplier_id)
            page.get_by_label("Outstanding purchase").select_option(value=purchase_id)
            page.get_by_label("Account").select_option(index=1)
            page.get_by_role("button", name="Post payment").click()
            page.get_by_text("Supplier payment posted and allocated.").wait_for(timeout=15000)
            paid_purchase = page.request.get(f"{BASE_URL}/api/v1/purchases/{purchase_id}").json()["data"]
            self.assertEqual(paid_purchase["outstandingCents"], 0)
            self.assertEqual(paid_purchase["totalCents"], original_cost)
            payment = next(item for item in page.request.get(f"{BASE_URL}/api/v1/supplier-payments").json()["data"] if any(allocation["purchaseId"] == purchase_id for allocation in item["allocations"]))
            page.on("dialog", lambda dialog: dialog.accept())
            page.locator("tr").filter(has_text=payment["paymentNumber"]).get_by_role("button", name="Request reversal").click()
            page.get_by_text("Payment reversal submitted for independent approval").wait_for(timeout=15000)
            self.assertEqual(page.request.get(f"{BASE_URL}/api/v1/purchases/{purchase_id}").json()["data"]["outstandingCents"], 0)
            page.goto(f"{BASE_URL}/approvals")
            page.get_by_role("link", name="Review").first.click()
            approval_url = page.url
            self.assertEqual(page.get_by_role("button", name="Approve").count(), 0)
            checker = checker_context.new_page()
            self.login(checker, "checker@e2e.test")
            checker.goto(approval_url)
            checker.get_by_label("Decision or cancellation reason").fill("Verified supplier payment reversal")
            checker.on("dialog", lambda dialog: dialog.accept())
            checker.get_by_role("button", name="Approve").click()
            checker.get_by_text("APPROVED", exact=True).first.wait_for(timeout=15000)
            page.reload()
            page.get_by_role("button", name="Execute approved request").click()
            page.get_by_text("EXECUTED", exact=True).first.wait_for(timeout=15000)
            self.assertEqual(page.request.get(f"{BASE_URL}/api/v1/purchases/{purchase_id}").json()["data"]["outstandingCents"], 328_000)
            current_payment = next(item for item in page.request.get(f"{BASE_URL}/api/v1/supplier-payments").json()["data"] if item["_id"] == payment["_id"])
            self.assertEqual(current_payment["status"], "REVERSED")
        finally:
            admin_context.close()
            checker_context.close()

    def test_purchase_receipt_and_independent_correction(self):
        admin_context = self.browser.new_context(locale="en-LK", viewport={"width": 1280, "height": 900})
        checker_context = self.browser.new_context(locale="en-LK")
        try:
            page = admin_context.new_page()
            self.login(page, "admin@e2e.test")
            suffix = uuid4().hex[:8].upper()
            supplier_code = f"E2E-{suffix}"
            supplier_name = f"සමන් කුමාර {suffix}"

            page.goto(f"{BASE_URL}/suppliers")
            page.get_by_role("button", name="Register supplier").click()
            page.get_by_placeholder("Supplier code").fill(supplier_code)
            page.get_by_placeholder("Full name").fill(supplier_name)
            page.get_by_placeholder("Village").fill("කළුතර")
            page.get_by_role("button", name="Save supplier").click()
            page.get_by_text(supplier_name).first.wait_for()

            page.goto(f"{BASE_URL}/pos")
            supplier_select = page.locator("select").first
            supplier_option = supplier_select.locator("option").filter(has_text=supplier_code).first
            supplier_option.wait_for(state="attached", timeout=15000)
            supplier_select.select_option(value=supplier_option.get_attribute("value"))
            page.get_by_label("Latex volume (litres)").fill("10")
            page.get_by_label("Density reading").select_option("150")
            self.assertIn("4.000 kg", page.locator("body").inner_text())
            page.get_by_label("Cash paid now (LKR)").fill("0")
            page.get_by_role("button", name="Save only").click()
            page.locator("#receipt").wait_for(timeout=20000)
            purchase_url = page.url
            purchase_id = purchase_url.split("/purchases/")[1].split("/")[0]
            receipt = page.locator("#receipt").inner_text()
            for expected in (supplier_name, supplier_code, "10.00 L", "4.000 kg", "150", "Latex subtotal:", "Price adjustment:", "TOTAL:", "Advance Applied:", "Cash Paid:", "BALANCE DUE:", "UNPAID"):
                self.assertIn(expected, receipt)
            posted = page.request.get(f"{BASE_URL}/api/v1/purchases/{purchase_id}").json()["data"]
            self.assertEqual(posted["subtotalCents"] + posted["adjustmentCents"], posted["totalCents"])
            self.assertEqual(posted["totalCents"] - posted["cashPaidCents"] - posted["advanceAppliedCents"], posted["outstandingCents"])
            page.reload()
            page.locator("#receipt").wait_for()
            self.assertEqual(page.url, purchase_url)
            self.assertEqual(page.locator("#receipt").inner_text(), receipt)

            page.emulate_media(media="print")
            page.evaluate("name => document.fonts.load('400 11px Noto Sans Sinhala', name)", supplier_name)
            page.evaluate("document.fonts.ready")
            self.assertTrue(page.evaluate("name => document.fonts.check('400 11px Noto Sans Sinhala', name)", supplier_name))
            width = page.locator("#receipt").evaluate("el => parseFloat(getComputedStyle(el).width)")
            self.assertTrue(295 <= width <= 310, f"80 mm receipt CSS width was {width} px")
            self.assertFalse(page.locator("#receipt").evaluate("el => [...el.querySelectorAll('*')].some(child => child.getBoundingClientRect().right > el.getBoundingClientRect().right + 1)"))
            self.assertIn(supplier_name, page.locator("#receipt").inner_text())
            screenshot_path = Path(".tmp/phase-b-receipt-print.png")
            screenshot_path.parent.mkdir(exist_ok=True)
            page.screenshot(path=str(screenshot_path), full_page=True)
            pdf_path = Path("tmp/pdfs/phase-b-receipt-print.pdf")
            pdf_path.parent.mkdir(parents=True, exist_ok=True)
            self.assertTrue(page.pdf(path=str(pdf_path), width="80mm", height="200mm", print_background=True).startswith(b"%PDF"))
            page.emulate_media(media="screen")

            page.goto(f"{BASE_URL}/purchases/{purchase_id}/correct")
            page.get_by_label("Corrected litres").fill("11")
            request_reason = f"Browser-approved scale correction {suffix}"
            page.get_by_label("Approval reason").fill(request_reason)
            page.on("dialog", lambda dialog: dialog.accept())
            page.get_by_role("button", name="Request correction approval").click()
            page.get_by_text("Correction requested.").wait_for(timeout=15000)

            page.goto(f"{BASE_URL}/approvals")
            page.get_by_role("link", name="Review").first.click()
            approval_url = page.url
            page.get_by_text(request_reason, exact=True).wait_for(timeout=15000)
            self.assertEqual(page.get_by_role("button", name="Approve").count(), 0)

            checker = checker_context.new_page()
            self.login(checker, "checker@e2e.test")
            checker.goto(approval_url)
            checker.get_by_label("Decision or cancellation reason").fill("Independent browser review passed")
            checker.on("dialog", lambda dialog: dialog.accept())
            checker.get_by_role("button", name="Approve").click()
            checker.get_by_text("APPROVED", exact=True).first.wait_for(timeout=15000)

            page.reload()
            page.get_by_role("button", name="Execute approved request").click()
            try:
                page.get_by_text("EXECUTED", exact=True).first.wait_for(timeout=15000)
            except Exception:
                print("Approval execution page:", page.locator("body").inner_text()[-1800:])
                raise
            self.assertIn("Action completed", page.locator("body").inner_text())
        finally:
            admin_context.close()
            checker_context.close()

    def test_04_rejected_purchase_correction_preserves_history(self):
        admin_context = self.browser.new_context(locale="en-LK")
        checker_context = self.browser.new_context(locale="en-LK")
        try:
            page = admin_context.new_page()
            self.login(page, "admin@e2e.test")
            purchase_id = self.create_unpaid_purchase(page)
            original = page.request.get(f"{BASE_URL}/api/v1/purchases/{purchase_id}").json()["data"]
            page.goto(f"{BASE_URL}/purchases/{purchase_id}/correct")
            page.get_by_label("Corrected litres").fill("12")
            page.get_by_label("Approval reason").fill("Rejected independent correction check")
            page.on("dialog", lambda dialog: dialog.accept())
            page.get_by_role("button", name="Request correction approval").click()
            page.get_by_text("Correction requested.").wait_for(timeout=15000)
            page.goto(f"{BASE_URL}/approvals")
            page.get_by_role("link", name="Review").first.click()
            approval_url = page.url
            checker = checker_context.new_page()
            self.login(checker, "checker@e2e.test")
            checker.goto(approval_url)
            checker.get_by_label("Decision or cancellation reason").fill("Source volume evidence was not sufficient")
            checker.on("dialog", lambda dialog: dialog.accept())
            checker.get_by_role("button", name="Reject").click()
            checker.get_by_text("REJECTED", exact=True).first.wait_for(timeout=15000)
            self.assertEqual(checker.get_by_role("button", name="Execute approved request").count(), 0)
            current = checker.request.get(f"{BASE_URL}/api/v1/purchases/{purchase_id}").json()["data"]
            self.assertEqual((current["kgMilli"], current["totalCents"], current["outstandingCents"]), (original["kgMilli"], original["totalCents"], original["outstandingCents"]))
        finally:
            admin_context.close()
            checker_context.close()

    def test_05_maker_cancels_purchase_correction(self):
        context = self.browser.new_context(locale="en-LK")
        try:
            page = context.new_page()
            self.login(page, "admin@e2e.test")
            purchase_id = self.create_unpaid_purchase(page)
            page.goto(f"{BASE_URL}/purchases/{purchase_id}/correct")
            page.get_by_label("Corrected litres").fill("11")
            page.get_by_label("Approval reason").fill("Cancel erroneous correction request")
            page.on("dialog", lambda dialog: dialog.accept())
            page.get_by_role("button", name="Request correction approval").click()
            page.get_by_text("Correction requested.").wait_for(timeout=15000)
            page.goto(f"{BASE_URL}/approvals")
            page.get_by_role("link", name="Review").first.click()
            page.get_by_label("Decision or cancellation reason").fill("Maker withdrew erroneous scale evidence")
            page.get_by_role("button", name="Cancel request").click()
            page.get_by_text("CANCELLED", exact=True).first.wait_for(timeout=15000)
            self.assertEqual(page.get_by_role("button", name="Execute approved request").count(), 0)
            self.assertEqual(page.request.get(f"{BASE_URL}/api/v1/purchases/{purchase_id}").json()["data"]["kgMilli"], 4_000)
        finally:
            context.close()

    def test_06_paid_expense_reversal_restores_bank_and_audit(self):
        admin_context = self.browser.new_context(locale="en-LK")
        checker_context = self.browser.new_context(locale="en-LK")
        try:
            page = admin_context.new_page()
            self.login(page, "admin@e2e.test")
            accounts = page.request.get(f"{BASE_URL}/api/v1/cash-accounts").json()["data"]
            bank = next(item for item in accounts if item["code"] == "E2E-BANK")
            before = bank["balanceCents"]
            description = f"Browser expense {uuid4().hex[:8]}"
            page.goto(f"{BASE_URL}/expenses")
            page.get_by_placeholder("Description").fill(description)
            page.get_by_placeholder("Amount (LKR)").fill("125")
            page.get_by_role("button", name="Record expense").click()
            page.get_by_text("General expense recorded.").wait_for(timeout=15000)
            row = page.locator("tr").filter(has_text=description)
            row.wait_for()
            page.get_by_label("Account for paying an unpaid expense").select_option(value=bank["_id"])
            row.get_by_role("button", name="Pay", exact=True).click()
            page.get_by_text("Expense payment posted to the cash/bank ledger.").wait_for(timeout=15000)
            self.assertEqual(next(a for a in page.request.get(f"{BASE_URL}/api/v1/cash-accounts").json()["data"] if a["_id"] == bank["_id"])["balanceCents"], before - 12_500)
            page.on("dialog", lambda dialog: dialog.accept("Verified expense reversal"))
            row.get_by_role("button", name="Request reversal").click()
            page.get_by_text("Expense reversal submitted for independent approval.").wait_for(timeout=15000)
            page.goto(f"{BASE_URL}/approvals")
            page.get_by_role("link", name="Review").first.click()
            approval_url = page.url
            checker = checker_context.new_page()
            self.login(checker, "checker@e2e.test")
            checker.goto(approval_url)
            checker.get_by_label("Decision or cancellation reason").fill("Checked original paid expense and bank movement")
            checker.on("dialog", lambda dialog: dialog.accept())
            checker.get_by_role("button", name="Approve").click()
            checker.get_by_text("APPROVED", exact=True).first.wait_for(timeout=15000)
            page.reload()
            page.get_by_role("button", name="Execute approved request").click()
            page.get_by_text("EXECUTED", exact=True).first.wait_for(timeout=15000)
            self.assertEqual(next(a for a in page.request.get(f"{BASE_URL}/api/v1/cash-accounts").json()["data"] if a["_id"] == bank["_id"])["balanceCents"], before)
            page.goto(f"{BASE_URL}/audit")
            page.get_by_text("EXPENSE_REVERSED", exact=False).first.wait_for(timeout=15000)
        finally:
            admin_context.close()
            checker_context.close()

    def test_07_insufficient_bank_transfer_is_atomic(self):
        context = self.browser.new_context(locale="en-LK")
        try:
            page = context.new_page()
            self.login(page, "admin@e2e.test")
            accounts = page.request.get(f"{BASE_URL}/api/v1/cash-accounts").json()["data"]
            bank = next(a for a in accounts if a["code"] == "E2E-BANK")
            cash = next(a for a in accounts if a["code"] == "E2E-CASH")
            before = {a["_id"]: a["balanceCents"] for a in accounts}
            page.goto(f"{BASE_URL}/cash-bank")
            page.get_by_label("From").select_option(value=bank["_id"])
            page.get_by_label("To").select_option(value=cash["_id"])
            page.get_by_label("Amount (LKR)").fill("9999999")
            page.get_by_label("Reference").fill(f"DECLINED-{uuid4().hex[:8]}")
            page.get_by_role("button", name="Post transfer").click()
            page.get_by_text("Posting would exceed", exact=False).wait_for(timeout=15000)
            after = {a["_id"]: a["balanceCents"] for a in page.request.get(f"{BASE_URL}/api/v1/cash-accounts").json()["data"]}
            self.assertEqual(after, before)
        finally:
            context.close()

    def test_08_transfer_reversal_restores_both_accounts(self):
        admin_context = self.browser.new_context(locale="en-LK")
        checker_context = self.browser.new_context(locale="en-LK")
        try:
            page = admin_context.new_page()
            self.login(page, "admin@e2e.test")
            accounts = page.request.get(f"{BASE_URL}/api/v1/cash-accounts").json()["data"]
            bank = next(a for a in accounts if a["code"] == "E2E-BANK")
            cash = next(a for a in accounts if a["code"] == "E2E-CASH")
            before = {a["_id"]: a["balanceCents"] for a in accounts}
            reference = f"BROWSER-{uuid4().hex[:8]}"
            page.goto(f"{BASE_URL}/cash-bank")
            page.get_by_label("From").select_option(value=bank["_id"])
            page.get_by_label("To").select_option(value=cash["_id"])
            page.get_by_label("Amount (LKR)").fill("100")
            page.get_by_label("Reference").fill(reference)
            page.get_by_role("button", name="Post transfer").click()
            page.get_by_text("Atomic paired transfer posted.").wait_for(timeout=15000)
            transfer = next(t for t in page.request.get(f"{BASE_URL}/api/v1/cash-transfers").json()["data"] if t["referenceNumber"] == reference)
            posted = {a["_id"]: a["balanceCents"] for a in page.request.get(f"{BASE_URL}/api/v1/cash-accounts").json()["data"]}
            self.assertEqual((posted[bank["_id"]], posted[cash["_id"]]), (before[bank["_id"]] - 10_000, before[cash["_id"]] + 10_000))
            page.on("dialog", lambda dialog: dialog.accept("Verified paired transfer reversal"))
            page.locator("tr").filter(has_text=reference).get_by_role("button", name="Request reversal").click()
            page.get_by_text("Transfer reversal submitted for independent approval.", exact=False).wait_for(timeout=15000)
            self.assertEqual({a["_id"]: a["balanceCents"] for a in page.request.get(f"{BASE_URL}/api/v1/cash-accounts").json()["data"]}, posted)
            page.goto(f"{BASE_URL}/approvals")
            page.get_by_role("link", name="Review").first.click()
            approval_url = page.url
            checker = checker_context.new_page()
            self.login(checker, "checker@e2e.test")
            checker.goto(approval_url)
            checker.get_by_label("Decision or cancellation reason").fill("Checked both original account movements")
            checker.on("dialog", lambda dialog: dialog.accept())
            checker.get_by_role("button", name="Approve").click()
            checker.get_by_text("APPROVED", exact=True).first.wait_for(timeout=15000)
            page.reload()
            page.get_by_role("button", name="Execute approved request").click()
            page.get_by_text("EXECUTED", exact=True).first.wait_for(timeout=15000)
            self.assertEqual({a["_id"]: a["balanceCents"] for a in page.request.get(f"{BASE_URL}/api/v1/cash-accounts").json()["data"]}, before)
            current = next(t for t in page.request.get(f"{BASE_URL}/api/v1/cash-transfers").json()["data"] if t["_id"] == transfer["_id"])
            self.assertEqual(current["status"], "REVERSED")
        finally:
            admin_context.close()
            checker_context.close()


    def test_09_unused_advance_reversal_restores_bank_and_supplier(self):
        admin_context = self.browser.new_context(locale="en-LK")
        checker_context = self.browser.new_context(locale="en-LK")
        try:
            page = admin_context.new_page()
            self.login(page, "admin@e2e.test")
            checker = checker_context.new_page()
            self.login(checker, "checker@e2e.test")
            bank = next(a for a in page.request.get(f"{BASE_URL}/api/v1/cash-accounts").json()["data"] if a["code"] == "E2E-BANK")
            before = bank["balanceCents"]
            supplier = next(s for s in page.request.get(f"{BASE_URL}/api/v1/suppliers").json()["data"] if s["code"] == "E2E-SUP-001")
            statement_url = f"{BASE_URL}/api/v1/suppliers/{supplier['_id']}/statement"
            before_advance = page.request.get(statement_url).json()["summary"]["advanceCents"]
            advance = self.issue_advance(page, "137.23")
            self.assertEqual(advance["issuedCents"], 13_723)
            self.assertEqual(next(a for a in page.request.get(f"{BASE_URL}/api/v1/cash-accounts").json()["data"] if a["_id"] == bank["_id"])["balanceCents"], before - 13_723)
            self.assertEqual(page.request.get(statement_url).json()["summary"]["advanceCents"], before_advance + 13_723)
            page.on("dialog", lambda dialog: dialog.accept())
            page.get_by_role("button", name=f"Request reversal of advance {advance['_id']}").click()
            page.get_by_text("Advance reversal submitted for independent approval.").wait_for(timeout=15000)
            self.assertEqual(next(a for a in page.request.get(f"{BASE_URL}/api/v1/cash-accounts").json()["data"] if a["_id"] == bank["_id"])["balanceCents"], before - 13_723)
            self.approve_and_execute_first_request(page, checker)
            current = next(a for a in page.request.get(f"{BASE_URL}/api/v1/advances").json()["data"] if a["_id"] == advance["_id"])
            self.assertEqual(current["status"], "REVERSED")
            self.assertEqual(next(a for a in page.request.get(f"{BASE_URL}/api/v1/cash-accounts").json()["data"] if a["_id"] == bank["_id"])["balanceCents"], before)
            statement = page.request.get(statement_url).json()
            self.assertEqual(statement["summary"]["advanceCents"], before_advance)
            self.assertEqual(sum(entry["advanceDeltaCents"] for entry in statement["data"] if entry["referenceId"] == advance["_id"]), 0)
            page.goto(f"{BASE_URL}/audit")
            page.get_by_text("SUPPLIER_ADVANCE_REVERSED", exact=False).first.wait_for(timeout=15000)
        finally:
            admin_context.close()
            checker_context.close()

    def test_10_repayment_reversal_restores_advance_and_bank(self):
        admin_context = self.browser.new_context(locale="en-LK")
        checker_context = self.browser.new_context(locale="en-LK")
        try:
            page = admin_context.new_page()
            self.login(page, "admin@e2e.test")
            checker = checker_context.new_page()
            self.login(checker, "checker@e2e.test")
            bank = next(a for a in page.request.get(f"{BASE_URL}/api/v1/cash-accounts").json()["data"] if a["code"] == "E2E-BANK")
            before = bank["balanceCents"]
            supplier = next(s for s in page.request.get(f"{BASE_URL}/api/v1/suppliers").json()["data"] if s["code"] == "E2E-SUP-001")
            statement_url = f"{BASE_URL}/api/v1/suppliers/{supplier['_id']}/statement"
            before_advance = page.request.get(statement_url).json()["summary"]["advanceCents"]
            advance = self.issue_advance(page, "213.37")
            page.locator("tr").filter(has_text="213.37").get_by_role("button", name="Repay").click()
            page.get_by_label("Amount", exact=True).fill("73.19")
            page.get_by_role("button", name="Post repayment").click()
            page.get_by_text("Advance repayment recorded.").wait_for(timeout=15000)
            repayments = [r for r in page.request.get(f"{BASE_URL}/api/v1/advance-repayments").json()["data"] if r["advanceId"] == advance["_id"]]
            self.assertEqual(len(repayments), 1)
            repayment = repayments[0]
            self.assertEqual(repayment["amountCents"], 7_319)
            self.assertEqual(next(a for a in page.request.get(f"{BASE_URL}/api/v1/cash-accounts").json()["data"] if a["_id"] == bank["_id"])["balanceCents"], before - 21_337 + 7_319)
            page.on("dialog", lambda dialog: dialog.accept())
            page.get_by_role("button", name=f"Request reversal of repayment {repayment['repaymentNumber']}").click()
            page.get_by_text("Repayment reversal submitted for independent approval.").wait_for(timeout=15000)
            self.approve_and_execute_first_request(page, checker)
            current_advance = next(a for a in page.request.get(f"{BASE_URL}/api/v1/advances").json()["data"] if a["_id"] == advance["_id"])
            current_repayment = next(r for r in page.request.get(f"{BASE_URL}/api/v1/advance-repayments").json()["data"] if r["_id"] == repayment["_id"])
            self.assertEqual(current_advance["repaidCents"], 0)
            self.assertEqual(current_repayment["status"], "REVERSED")
            self.assertEqual(next(a for a in page.request.get(f"{BASE_URL}/api/v1/cash-accounts").json()["data"] if a["_id"] == bank["_id"])["balanceCents"], before - 21_337)
            statement = page.request.get(statement_url).json()
            self.assertEqual(statement["summary"]["advanceCents"], before_advance + 21_337)
            self.assertEqual(sum(entry["advanceDeltaCents"] for entry in statement["data"] if entry["referenceId"] == repayment["_id"]), 0)
        finally:
            admin_context.close()
            checker_context.close()


    def test_11_purchase_uses_advance_without_new_cash_cost(self):
        context = self.browser.new_context(locale="en-LK")
        try:
            page = context.new_page()
            self.login(page, "admin@e2e.test")
            bank = next(a for a in page.request.get(f"{BASE_URL}/api/v1/cash-accounts").json()["data"] if a["code"] == "E2E-BANK")
            advance = self.issue_advance(page, "500")
            bank_after_issue = next(a for a in page.request.get(f"{BASE_URL}/api/v1/cash-accounts").json()["data"] if a["_id"] == bank["_id"])["balanceCents"]
            page.goto(f"{BASE_URL}/pos")
            supplier = page.get_by_label("Supplier")
            option = supplier.locator("option").filter(has_text="E2E-SUP-001").first
            option.wait_for(state="attached")
            supplier.select_option(value=option.get_attribute("value"))
            page.get_by_label("Latex volume (litres)").fill("10")
            page.get_by_label("Density reading").select_option("150")
            page.get_by_text("Advance applied").locator("..").locator("select").select_option(value=advance["_id"])
            page.get_by_text("Advance applied").locator("..").locator("input").fill("200")
            page.get_by_role("button", name="Save only").click()
            page.locator("#receipt").wait_for(timeout=20000)
            purchase_id = page.url.split("/purchases/")[1].split("/")[0]
            purchase = page.request.get(f"{BASE_URL}/api/v1/purchases/{purchase_id}").json()["data"]
            current_advance = next(a for a in page.request.get(f"{BASE_URL}/api/v1/advances").json()["data"] if a["_id"] == advance["_id"])
            self.assertEqual((purchase["totalCents"], purchase["advanceAppliedCents"], purchase["cashPaidCents"], purchase["outstandingCents"]), (328_000, 20_000, 0, 308_000))
            self.assertEqual(current_advance["allocatedCents"], 20_000)
            self.assertEqual(next(a for a in page.request.get(f"{BASE_URL}/api/v1/cash-accounts").json()["data"] if a["_id"] == bank["_id"])["balanceCents"], bank_after_issue)
        finally:
            context.close()

    def test_12_company_receipt_reversal_restores_receivable_and_bank(self):
        admin_context = self.browser.new_context(locale="en-LK")
        checker_context = self.browser.new_context(locale="en-LK")
        try:
            page = admin_context.new_page()
            self.login(page, "admin@e2e.test")
            checker = checker_context.new_page()
            self.login(checker, "checker@e2e.test")
            page.on("dialog", lambda dialog: dialog.accept())
            dispatch_id, _, _ = self.create_reconciled_dispatch(page, checker)
            bank = next(a for a in page.request.get(f"{BASE_URL}/api/v1/cash-accounts").json()["data"] if a["code"] == "E2E-BANK")
            before = bank["balanceCents"]
            page.goto(f"{BASE_URL}/sales")
            invoice_form = page.locator("form").filter(has_text="Create company invoice")
            invoice_form.locator("select").select_option(value=dispatch_id)
            invoice_form.get_by_role("button", name="Invoice").click()
            page.get_by_text("Company invoice created").wait_for(timeout=15000)
            invoice = next(i for i in page.request.get(f"{BASE_URL}/api/v1/company-invoices").json()["data"] if i["dispatchId"]["_id"] == dispatch_id)
            payment_form = page.locator("form").filter(has_text="Receive company payment")
            payment_form.locator("select").first.select_option(value=invoice["_id"])
            payment_form.get_by_placeholder("Amount").fill("123")
            payment_form.locator("select").nth(2).select_option(value=bank["_id"])
            ref = f"SAFE-RECEIPT-{uuid4().hex[:8]}"
            payment_form.get_by_placeholder("Bank/reference number").fill(ref)
            payment_form.get_by_role("button", name="Post receipt").click()
            page.get_by_text("Company receipt posted").wait_for(timeout=15000)
            settlement = next(s for s in page.request.get(f"{BASE_URL}/api/v1/company-settlements").json()["data"] if s.get("referenceNumber") == ref)
            self.assertEqual(next(a for a in page.request.get(f"{BASE_URL}/api/v1/cash-accounts").json()["data"] if a["_id"] == bank["_id"])["balanceCents"], before + 12_300)
            page.locator("tr").filter(has_text=settlement["receiptNumber"]).get_by_role("button").click()
            page.get_by_text("Receipt reversal submitted for independent approval").wait_for(timeout=15000)
            self.approve_and_execute_first_request(page, checker)
            after_invoice = next(i for i in page.request.get(f"{BASE_URL}/api/v1/company-invoices").json()["data"] if i["_id"] == invoice["_id"])
            after_settlement = next(s for s in page.request.get(f"{BASE_URL}/api/v1/company-settlements").json()["data"] if s["_id"] == settlement["_id"])
            self.assertEqual(after_settlement["status"], "REVERSED")
            self.assertEqual(after_invoice["outstandingCents"], invoice["outstandingCents"])
            self.assertEqual(next(a for a in page.request.get(f"{BASE_URL}/api/v1/cash-accounts").json()["data"] if a["_id"] == bank["_id"])["balanceCents"], before)
        finally:
            admin_context.close()
            checker_context.close()

    def test_13_direct_dispatch_expense_reversal_restores_profit(self):
        admin_context = self.browser.new_context(locale="en-LK")
        checker_context = self.browser.new_context(locale="en-LK")
        try:
            page = admin_context.new_page()
            self.login(page, "admin@e2e.test")
            checker = checker_context.new_page()
            self.login(checker, "checker@e2e.test")
            page.on("dialog", lambda dialog: dialog.accept("Verified direct expense reversal") if dialog.type == "prompt" else dialog.accept())
            dispatch_id, dispatch_url, dispatch = self.create_reconciled_dispatch(page, checker)
            before_profit = dispatch["netProfitCents"]
            page.goto(dispatch_url)
            page.get_by_label("Amount (LKR)", exact=True).fill("47.29")
            page.get_by_role("button", name="Allocate unpaid expense").click()
            page.get_by_text("Direct expense allocated to batch profit.").wait_for(timeout=15000)
            detail = page.request.get(f"{BASE_URL}/api/v1/dispatches/{dispatch_id}").json()["data"]
            self.assertEqual(detail["dispatch"]["netProfitCents"], before_profit - 4_729)
            expense = next(x for x in detail["expenses"] if x["amountCents"] == 4_729 and x["status"] == "POSTED")
            page.goto(f"{BASE_URL}/expenses")
            page.locator("tr").filter(has_text=expense["expenseNumber"]).get_by_role("button", name="Request reversal").click()
            page.get_by_text("Expense reversal submitted for independent approval.").wait_for(timeout=15000)
            self.approve_and_execute_first_request(page, checker)
            final = page.request.get(f"{BASE_URL}/api/v1/dispatches/{dispatch_id}").json()["data"]
            self.assertEqual(final["dispatch"]["netProfitCents"], before_profit)
            self.assertEqual(next(x for x in final["expenses"] if x["_id"] == expense["_id"])["status"], "REVERSED")
        finally:
            admin_context.close()
            checker_context.close()

    def test_14_profit_adjustment_reversal_restores_net_profit(self):
        admin_context = self.browser.new_context(locale="en-LK")
        checker_context = self.browser.new_context(locale="en-LK")
        try:
            page = admin_context.new_page()
            self.login(page, "admin@e2e.test")
            checker = checker_context.new_page()
            self.login(checker, "checker@e2e.test")
            page.on("dialog", lambda dialog: dialog.accept("Verified profit adjustment reversal") if dialog.type == "prompt" else dialog.accept())
            dispatch_id, dispatch_url, dispatch = self.create_reconciled_dispatch(page, checker)
            before_profit = dispatch["netProfitCents"]
            page.goto(dispatch_url)
            form = page.locator("form").filter(has_text="Profit-only adjustment request")
            form.get_by_label("Signed amount (LKR)").fill("-31.17")
            form.get_by_label("Reason").fill("Verified batch handling loss")
            form.get_by_role("button", name="Request adjustment approval").click()
            page.get_by_text("Profit adjustment submitted for independent approval.").wait_for(timeout=15000)
            self.approve_and_execute_first_request(page, checker)
            adjusted = page.request.get(f"{BASE_URL}/api/v1/dispatches/{dispatch_id}").json()["data"]
            self.assertEqual(adjusted["dispatch"]["netProfitCents"], before_profit - 3_117)
            adjustment = next(a for a in adjusted["financialAdjustments"] if a["amountCents"] == -3_117 and a["status"] == "POSTED")
            page.goto(dispatch_url)
            page.locator("tr").filter(has_text="Verified batch handling loss").get_by_role("button", name="Request reversal").click()
            page.get_by_text("Financial adjustment reversal submitted").wait_for(timeout=15000)
            self.approve_and_execute_first_request(page, checker)
            final = page.request.get(f"{BASE_URL}/api/v1/dispatches/{dispatch_id}").json()["data"]
            self.assertEqual(final["dispatch"]["netProfitCents"], before_profit)
            self.assertEqual(next(a for a in final["financialAdjustments"] if a["_id"] == adjustment["_id"])["status"], "REVERSED")
        finally:
            admin_context.close()
            checker_context.close()


    def test_15_cashier_open_close_reconciles_without_variance(self):
        context = self.browser.new_context(locale="en-LK")
        try:
            page = context.new_page()
            self.login(page, "cashier@e2e.test")
            page.goto(f"{BASE_URL}/cash-bank")
            self.assertIsNone(page.request.get(f"{BASE_URL}/api/v1/cashier-shifts/current").json()["data"])
            page.get_by_label("Cash account").select_option(index=1)
            page.get_by_label("Opening float").fill("0")
            page.get_by_role("button", name="Open shift").click()
            page.get_by_text("Cashier shift opened.").wait_for(timeout=15000)
            opened = page.request.get(f"{BASE_URL}/api/v1/cashier-shifts/current").json()["data"]
            self.assertEqual(opened["status"], "OPEN")
            page.get_by_label("Counted cash at close").fill("0")
            page.get_by_role("button", name="Close & reconcile").click()
            page.get_by_text("Shift closed and reconciled.").wait_for(timeout=15000)
            self.assertIsNone(page.request.get(f"{BASE_URL}/api/v1/cashier-shifts/current").json()["data"])
            page.goto(f"{BASE_URL}/audit")
            self.assertEqual(page.request.get(f"{BASE_URL}/api/v1/audit").status, 403)
        finally:
            context.close()

    def test_16_stale_approved_purchase_correction_does_not_post(self):
        admin_context = self.browser.new_context(locale="en-LK")
        checker_context = self.browser.new_context(locale="en-LK")
        try:
            page = admin_context.new_page()
            self.login(page, "admin@e2e.test")
            checker = checker_context.new_page()
            self.login(checker, "checker@e2e.test")
            page.on("dialog", lambda dialog: dialog.accept())
            purchase_id = self.create_unpaid_purchase(page)
            original = page.request.get(f"{BASE_URL}/api/v1/purchases/{purchase_id}").json()["data"]
            requests = []
            for litres_value in ("12", "13"):
                reason = f"Independent competing correction {litres_value} litres"
                page.goto(f"{BASE_URL}/purchases/{purchase_id}/correct")
                page.get_by_label("Corrected litres").fill(litres_value)
                page.get_by_label("Approval reason").fill(reason)
                page.get_by_role("button", name="Request correction approval").click()
                page.get_by_text("Correction requested.").wait_for(timeout=15000)
                approval = next(a for a in page.request.get(f"{BASE_URL}/api/v1/approvals").json()["data"] if a["targetId"] == purchase_id and a["requestReason"] == reason)
                requests.append(approval["_id"])
                checker.goto(f"{BASE_URL}/approvals/{approval['_id']}")
                checker.get_by_label("Decision or cancellation reason").fill("Independent review of competing source correction")
                checker.once("dialog", lambda dialog: dialog.accept())
                checker.get_by_role("button", name="Approve").click()
                checker.get_by_text("APPROVED", exact=True).first.wait_for(timeout=15000)
            page.goto(f"{BASE_URL}/approvals/{requests[1]}")
            page.get_by_role("button", name="Execute approved request").click()
            page.get_by_text("EXECUTED", exact=True).first.wait_for(timeout=15000)
            corrected = page.request.get(f"{BASE_URL}/api/v1/purchases/{purchase_id}").json()["data"]
            self.assertTrue(corrected.get("reversedAt"))
            page.goto(f"{BASE_URL}/approvals/{requests[0]}")
            page.get_by_role("button", name="Execute approved request").click()
            page.get_by_text("APPROVED", exact=True).first.wait_for(timeout=15000)
            self.assertEqual(page.request.get(f"{BASE_URL}/api/v1/approvals/{requests[0]}").json()["data"]["status"], "APPROVED")
            self.assertEqual(page.request.get(f"{BASE_URL}/api/v1/purchases/{purchase_id}").json()["data"]["totalCents"], original["totalCents"])
        finally:
            admin_context.close()
            checker_context.close()

    def test_17_cross_supplier_cash_correction_is_blocked(self):
        admin_context = self.browser.new_context(locale="en-LK")
        checker_context = self.browser.new_context(locale="en-LK")
        try:
            page = admin_context.new_page()
            self.login(page, "admin@e2e.test")
            checker = checker_context.new_page()
            self.login(checker, "checker@e2e.test")
            page.on("dialog", lambda dialog: dialog.accept())
            page.goto(f"{BASE_URL}/cash-bank")
            if page.request.get(f"{BASE_URL}/api/v1/cashier-shifts/current").json()["data"] is None:
                page.get_by_label("Cash account").select_option(index=1)
                page.get_by_label("Opening float").fill("0")
                page.get_by_role("button", name="Open shift").click()
                page.get_by_text("Cashier shift opened.").wait_for(timeout=15000)
            page.goto(f"{BASE_URL}/suppliers")
            page.get_by_role("button", name="Register supplier").click()
            code = f"OTHER-{uuid4().hex[:8]}"
            page.get_by_placeholder("Supplier code").fill(code)
            page.get_by_placeholder("Full name").fill(f"Independent supplier {code}")
            page.get_by_role("button", name="Save supplier").click()
            page.get_by_text(code).first.wait_for(timeout=15000)
            other = next(s for s in page.request.get(f"{BASE_URL}/api/v1/suppliers").json()["data"] if s["code"] == code)
            cash = next(a for a in page.request.get(f"{BASE_URL}/api/v1/cash-accounts").json()["data"] if a["code"] == "E2E-CASH")
            before = cash["balanceCents"]
            page.goto(f"{BASE_URL}/pos")
            supplier = page.get_by_label("Supplier")
            option = supplier.locator("option").filter(has_text="E2E-SUP-001").first
            option.wait_for(state="attached")
            supplier.select_option(value=option.get_attribute("value"))
            page.get_by_label("Latex volume (litres)").fill("10")
            page.get_by_label("Density reading").select_option("150")
            page.get_by_label("Cash paid now (LKR)").fill("100")
            page.get_by_role("button", name="Save only").click()
            page.locator("#receipt").wait_for(timeout=20000)
            purchase_id = page.url.split("/purchases/")[1].split("/")[0]
            after_purchase = next(a for a in page.request.get(f"{BASE_URL}/api/v1/cash-accounts").json()["data"] if a["_id"] == cash["_id"])["balanceCents"]
            self.assertEqual(after_purchase, before - 10_000)
            page.goto(f"{BASE_URL}/purchases/{purchase_id}/correct")
            page.get_by_label("Supplier").select_option(value=other["_id"])
            page.get_by_label("Approval reason").fill("Wrong supplier identified after original cash was paid")
            page.get_by_role("button", name="Request correction approval").click()
            page.get_by_text("Correction requested.").wait_for(timeout=15000)
            approval = next(a for a in page.request.get(f"{BASE_URL}/api/v1/approvals").json()["data"] if a["targetId"] == purchase_id and a["status"] == "REQUESTED")
            checker.goto(f"{BASE_URL}/approvals/{approval['_id']}")
            checker.get_by_label("Decision or cancellation reason").fill("Confirmed mismatch but no refund policy exists")
            checker.on("dialog", lambda dialog: dialog.accept())
            checker.get_by_role("button", name="Approve").click()
            checker.get_by_text("APPROVED", exact=True).first.wait_for(timeout=15000)
            page.goto(f"{BASE_URL}/approvals/{approval['_id']}")
            page.get_by_role("button", name="Execute approved request").click()
            page.get_by_text("Cash paid to the original supplier cannot be carried", exact=False).wait_for(timeout=15000)
            self.assertEqual(page.request.get(f"{BASE_URL}/api/v1/approvals/{approval['_id']}").json()["data"]["status"], "APPROVED")
            self.assertEqual(next(a for a in page.request.get(f"{BASE_URL}/api/v1/cash-accounts").json()["data"] if a["_id"] == cash["_id"])["balanceCents"], after_purchase)
            self.assertFalse(page.request.get(f"{BASE_URL}/api/v1/purchases/{purchase_id}").json()["data"].get("reversedAt"))
        finally:
            admin_context.close()
            checker_context.close()

    def test_18_mobile_receipt_reprint_does_not_duplicate_purchase(self):
        context = self.browser.new_context(locale="en-LK", viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        try:
            page = context.new_page()
            self.login(page, "admin@e2e.test")
            purchase_id = self.create_unpaid_purchase(page)
            before = page.request.get(f"{BASE_URL}/api/v1/purchases/{purchase_id}").json()["data"]
            url = page.url
            page.reload()
            page.locator("#receipt").wait_for(timeout=15000)
            self.assertEqual(page.url, url)
            self.assertIn(before["billNumber"], page.locator("#receipt").inner_text())
            page.evaluate("() => { window.__receiptPrintCalls = 0; window.print = () => { window.__receiptPrintCalls += 1; }; }")
            page.get_by_role("button", name="Print 80 mm receipt").click()
            self.assertEqual(page.evaluate("window.__receiptPrintCalls"), 1)
            page.emulate_media(media="print")
            self.assertTrue(295 <= page.locator("#receipt").evaluate("el => parseFloat(getComputedStyle(el).width)") <= 310)
            self.assertFalse(page.locator("#receipt").evaluate("el => [...el.querySelectorAll('*')].some(child => child.getBoundingClientRect().right > el.getBoundingClientRect().right + 1)"))
            page.emulate_media(media="screen")
            self.assertEqual(page.request.get(f"{BASE_URL}/api/v1/purchases/{purchase_id}").json()["data"]["totalCents"], before["totalCents"])
        finally:
            context.close()


if __name__ == "__main__":
    unittest.main()
