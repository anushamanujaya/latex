# 80 mm thermal receipt acceptance procedure

Status: **software print check passed locally; physical printer PENDING.** A local Chromium-generated PDF measured 227.04 pt wide (approximately 80 mm), rendered as one page, and was visually inspected after adding a self-hosted Noto Sans Sinhala font. The supplier name, bill/sequence/date, 10.00 L, 4.000 kg, rate, subtotal, signed price adjustment, total, advance, cash, outstanding, and status were legible and unclipped in that synthetic PDF. The automated browser test also checks print-media width, horizontal overflow, stored subtotal-plus-adjustment arithmetic, and balance due. These are not hardware acceptance evidence.

The current purchase model has one latex line and a signed price adjustment; it has **no tax field or separately classified discount**. Do not infer that tax is zero or relabel a negative adjustment as a discount. Finance must decide tax/discount rules before those details can be validated or printed as separate fields.

Use a staging system with synthetic records, the actual production printer model/driver, an 80 mm roll, and the intended cashier workstation. Record printer model, driver version, browser/version, paper width, date, tester, and test bill numbers.

1. Open a synthetic unpaid purchase for 10.000 L at density reading 150. Confirm 4.000 KG, the configured rate, total, advance, cash paid, balance due, supplier name/code, bill number, local date/time, and status on screen and on paper.
2. Print using the normal browser print command with paper set to 80 mm, margins none/minimum, scale 100%, headers/footers off. Confirm no horizontal clipping, overlapping lines, extra blank page, or unintended scaling. Measure the printed content width and verify it fits the roll.
3. Repeat with a Sinhala supplier name and village, a long supplier name, a long bill/reference number, and a high-value amount. Confirm glyphs are legible, line wrapping is safe, and decimal punctuation remains clear.
4. Print partially paid and fully paid purchases, including one with an advance application. Confirm that procurement total, each settlement component, and balance due reconcile exactly to the posted database records; no payment appears twice.
5. Reload the saved receipt URL and print again. Confirm the same immutable bill/amounts print without creating another purchase, cash movement, supplier payment, or advance allocation.
6. Check paper feed/cut, duplicate-print behavior, and printer-unavailable/cancel behavior. A failed or canceled print must not reverse, repost, or duplicate the underlying transaction.
7. Obtain cashier and finance sign-off with photos or scanned samples of each print and database/API evidence for the corresponding synthetic bill numbers. Record defects and retest after fixes.

Do not mark physical receipt printing accepted until these checks are witnessed on the actual hardware and attached to the deployment record.
