# Staging and production deployment guide

This guide prepares deployment infrastructure; it does not override the production blockers in `PRODUCTION_AUDIT.md`.

## 1. Create MongoDB Atlas environments

Create separate Atlas projects or clusters for staging and production. Use a replica-set-backed Atlas cluster, enable TLS, select a region close to the chosen Vercel function region, and enable the backup/PITR policy required by the recovery objectives.

Create a distinct database user for each environment. Grant only `readWrite` on that environment's application database; do not use an Atlas organization/project administrator in the connection string. Generate a long random password and URL-encode it in the SRV connection string.

Prefer Vercel Secure Compute/static egress and allowlist only those addresses in Atlas. If the selected Vercel plan has no stable egress, document the temporary Atlas network policy and compensate with least-privilege credentials, TLS, monitoring, rotation, and a migration plan to restricted networking.

Use a URI shaped like:

```text
mongodb+srv://<app-user>:<encoded-password>@<cluster>/<database>?retryWrites=true&w=majority
```

Never put this value in Git, `.env.example`, frontend variables, screenshots, tickets, or customer documents.

## 2. Push to a private GitHub repository

From the repository root, after reviewing `git status` and secrets:

```powershell
git init
git add .
git commit -m "Prepare latex suite for staging deployment"
git branch -M main
git remote add origin git@github.com:<organization>/<private-repository>.git
git push -u origin main
```

Create the GitHub repository as **Private** before the push. Enable protected branches, required reviews, secret scanning, Dependabot/security alerts, and required CI checks. No push or repository creation is performed automatically by this project.

## 3. Create the backend Vercel project

Import the private repository as a new Vercel project.

- Root Directory: `apps/api`
- Include source files outside the Root Directory: enabled (required for `packages/domain` and the root lockfile)
- Framework: allow Vercel to detect Express
- Install Command: `npm install` (or leave the npm workspace default)
- Build Command: `npm run vercel-build`
- Output Directory: leave empty; Express is emitted as a Vercel Function
- Node.js: `24.x` (also pinned in the root `package.json`)

The supported entry point is the default Express export in `apps/api/src/app.ts`. `server.ts` is local-only.

Set these Vercel variables separately for Preview and Production:

```text
NODE_ENV=production
MONGODB_URI=<Atlas SRV secret>
JWT_SECRET=<at least 32 cryptographically random characters>
WEB_ORIGIN=https://staging-app.example.lk
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
MONGODB_MAX_POOL_SIZE=10
MONGODB_SERVER_SELECTION_TIMEOUT_MS=10000
```

`WEB_ORIGIN` accepts exact comma-separated origins when an environment has more than one trusted frontend. Do not use `*`. For unrelated frontend/API sites set `COOKIE_SAME_SITE=none`; sibling HTTPS subdomains can normally use `lax`.

Deploy and verify:

```text
GET https://<backend>/health/live  -> 200
GET https://<backend>/health/ready -> 200 only when Atlas is reachable
```

## 4. Create the frontend Vercel project

Import the same repository as a second project.

- Root Directory: `apps/web`
- Include source files outside the Root Directory: enabled
- Framework Preset: Vite
- Install Command: `npm install` (or leave the npm workspace default)
- Build Command: `npm run vercel-build`
- Output Directory: `dist`
- Node.js: `24.x`

Set:

```text
VITE_API_URL=https://<backend-domain>/api/v1
```

This is the only API location exposed to the browser. Never create a `VITE_` variable containing database credentials, JWT secrets, encryption keys, or administrator passwords.

The checked-in `apps/web/vercel.json` provides React Router fallback. Test direct navigation to `/pos`, `/purchases/<id>/receipt`, and `/dispatches`, not only navigation from `/`.

## 5. Configure domains and cookies

Recommended layout:

```text
app.example.lk -> frontend Vercel project
api.example.lk -> backend Vercel project
```

Add both domains in Vercel, create the requested DNS records, wait for verification and managed HTTPS certificates, then update:

```text
Backend WEB_ORIGIN=https://app.example.lk
Frontend VITE_API_URL=https://api.example.lk/api/v1
```

Redeploy both projects after changing variables. Verify that login responses set an `HttpOnly; Secure` cookie and that the browser sends it only to the API host.

## 6. Create the first administrator

Do not run the demo seed. From a trusted administrator workstation, set production variables temporarily without writing them to a file or shell history where possible:

```powershell
$env:NODE_ENV='production'
$env:MONGODB_URI='<Atlas SRV secret>'
$env:JWT_SECRET='<production secret>'
$env:WEB_ORIGIN='https://app.example.lk'
$env:COOKIE_SECURE='true'
$env:COOKIE_SAME_SITE='lax'
$env:ADMIN_EMAIL='<owner email>'
$env:ADMIN_NAME='<owner name>'
$env:ADMIN_PASSWORD='<unique 14+ character password>'
npm run admin:create -w @latex/api
```

The command refuses to run if any user already exists and never prints the password. Clear the temporary environment values afterward. Never add these administrator variables to the Vercel project.

## 7. Staging smoke test

Use synthetic staging data only:

1. Confirm liveness and database readiness.
2. Sign in and verify unauthorized requests return 401 and untrusted origins return 403.
3. Register a supplier and set an effective rate.
4. Record the 10 L / reading 150 / LKR 820 case; confirm 4.000 KG and LKR 3,280.00 in the API, register, and receipt.
5. Test unpaid, partial, cash-paid, and advance allocation balances.
6. Reprint the receipt and verify purchase count does not change.
7. Create purchases with identical event timestamps and confirm sequence ordering.
8. Preview a bowser boundary and verify the final selected purchase is included.
9. Attempt a duplicate/overlapping confirmation and confirm it is rejected atomically.
10. Verify historical rate/factor snapshots after creating newer configuration.
11. Inspect audit records and Atlas metrics/logs.
12. Test direct frontend routes, mobile layout, 80 mm printing, logout, cookie flags, and CORS failures.

Do not promote until automated transaction rollback, concurrent dispatch, correction/reversal, and full E2E tests are implemented and passing.

## 8. Backups, monitoring, and rollback

- Enable Atlas backups/PITR appropriate to the recovery objectives. Alert on backup failure, replication health, connection saturation, storage, slow queries, and authentication anomalies.
- Perform a documented restore into an isolated Atlas staging project before go-live and at least quarterly. Reconcile supplier ledger totals, purchase counts/cost, dispatch membership, and audit counts after restoration.
- Enable Vercel logs/observability and alerts for 5xx rate, p95 latency, cold starts, function duration, rate-limit events, and `/health/ready` failure. Do not log passwords, tokens, cookies, NICs, or connection strings.
- Promote a tested immutable deployment from staging. Use Vercel Instant Rollback for application regressions. Never roll database state backward by deploying old code; use forward-compatible migrations and audited correction entries.
- Rotate Atlas/JWT secrets through the platform secret store and redeploy. Document the rotation owner and emergency revocation procedure.

## 9. Customer handover

Deliver the custom-domain URLs, role/account register, support contacts, incident process, backup/restore evidence, recovery objectives, data-retention policy, operating procedures, known limitations, and signed acceptance-test results. Transfer Vercel, Atlas, GitHub, DNS, and monitoring ownership through organization/team access—not shared personal passwords.
