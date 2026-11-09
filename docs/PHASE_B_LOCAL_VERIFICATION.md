# Reproducible Phase B local verification

Use only synthetic data. Do **not** point these tests at Atlas, a production MongoDB URI, or the existing MongoDB service on port 27017. The local runner creates a new authenticated, loopback-only single-node replica set on port 27018, a unique data directory under ignored `.tmp/`, a random database-scoped test user, and three uniquely named test databases. Passwords exist only in its process environment and are not printed. The runner checks that ports 27018, 4000, and 5173 are free, and stops only processes it started. It retains the isolated database files and logs; it never drops another database.

Prerequisites: Windows, Node 24, npm dependencies installed, Python Playwright with Chromium installed, and a local MongoDB Community `mongod.exe`. The tested binary is `C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe` (8.3.11). MongoDB's [Windows ZIP installation guide](https://www.mongodb.com/docs/v8.0/tutorial/install-mongodb-on-windows-zip/) is the supported non-Docker route; an installed service on port 27017 is **not** used. Run from the repository root:

```powershell
npm ci --include=dev
python -m playwright install chromium
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\verify-phase-b-local.ps1
```

If `mongod.exe` is elsewhere, append `-MongoExecutable 'C:\path\to\mongod.exe'`. The script runs, in order:

1. An authenticated replica-set commit/rollback smoke via `node tests/browser/prepare-local-replica.mjs`.
2. `npm run typecheck`, `npm test`, and `npm run build` (with a dummy non-production `VITE_API_URL`).
3. `npm run test -w @latex/api -- src/financial-service.test.ts --reporter=dot` with `RUN_FINANCIAL_INTEGRATION=true` and its own Phase A database.
4. `npm run test -w @latex/api -- src/phase-b.test.ts --reporter=dot` with `RUN_PHASE_B_INTEGRATION=true` and its own Phase B database.
5. The existing `apps/api/src/seed-e2e.ts` synthetic fixture, actual API and Vite servers, then `python -m unittest discover -s tests/browser -p test_acceptance.py -v` against a third database. The 20 `test_` methods are independent scenarios, not checkpoints.

For an isolated targeted browser rerun while still running all preceding checks, append `-BrowserTest test_11_purchase_uses_advance_without_new_cash_cost` (or another exact `test_` method name). This reports only that one browser scenario, not 20/20.

The dedicated browser database name must start `latex_dev_phase_b_e2e_`; the seed script enforces this. The browser suite writes a screenshot under `.tmp/` and regenerates `tmp/pdfs/phase-b-receipt-print.pdf`. The PDF is software evidence only. Measure with `pdfinfo tmp/pdfs/phase-b-receipt-print.pdf`, render with `pdftoppm -f 1 -singlefile -png tmp/pdfs/phase-b-receipt-print.pdf .tmp/phase-b-receipt-review`, and inspect the PNG. A physical 80 mm printer and separate HTTPS/Atlas staging remain manual acceptance gates.

If any command fails, preserve the printed run directory, log, database name, failing test, and exit code. Do not delete the data or relabel a skipped/failed gate as passed. The runner is for a local synthetic verification environment; it does not constitute production-shaped staging.
