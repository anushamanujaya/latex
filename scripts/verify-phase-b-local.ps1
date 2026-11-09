param(
  [string]$MongoExecutable = 'C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe',
  [string]$BrowserTest = ''
)

$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$mongoProcess = $null
$apiProcess = $null
$webProcess = $null
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()

function New-TestSecret {
  $bytes = New-Object byte[] 48
  $rng.GetBytes($bytes)
  return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

function Assert-FreePort([int]$port) {
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $port is already in use; refusing to reuse an existing service"
  }
}

function Wait-Http([string]$url) {
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try {
      $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -eq 200) { return }
    } catch { Start-Sleep -Milliseconds 500 }
  }
  throw "Local test server did not become ready: $url"
}

try {
  if ($BrowserTest -and $BrowserTest -notmatch '^test_[A-Za-z0-9_]+$') { throw 'BrowserTest must be a single test method name' }
  if (-not (Test-Path -LiteralPath $MongoExecutable)) { throw "MongoDB executable not found: $MongoExecutable" }
  foreach ($port in @(27018, 4000, 5173)) { Assert-FreePort $port }
  $suffix = [Guid]::NewGuid().ToString('N').Substring(0, 10)
  $runDirectory = Join-Path $workspace ".tmp\phase-b-browser-$suffix"
  $dataDirectory = Join-Path $runDirectory 'data'
  New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
  $keyPath = Join-Path $runDirectory 'replica.key'
  [System.IO.File]::WriteAllText($keyPath, (New-TestSecret), [System.Text.Encoding]::ASCII)

  $mongoProcess = Start-Process -FilePath $MongoExecutable -ArgumentList @('--replSet', 'rs0', '--bind_ip', '127.0.0.1', '--port', '27018', '--dbpath', $dataDirectory, '--keyFile', $keyPath, '--logpath', (Join-Path $runDirectory 'mongod.log')) -WindowStyle Hidden -PassThru
  Start-Sleep -Seconds 2
  if ($mongoProcess.HasExited) { throw "Isolated MongoDB exited; inspect $runDirectory\mongod.log" }

  $env:PHASE_B_BOOTSTRAP_PASSWORD = New-TestSecret
  $env:PHASE_B_RUNNER_PASSWORD = New-TestSecret
  $env:E2E_PASSWORD = New-TestSecret
  $env:PHASE_B_TEST_DB_A = "latex_phase_a_verify_$suffix"
  $env:PHASE_B_TEST_DB_B = "latex_phase_b_verify_$suffix"
  $env:PHASE_B_TEST_DB_E2E = "latex_dev_phase_b_e2e_$suffix"
  Push-Location $workspace
  try {
    & node tests/browser/prepare-local-replica.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Replica-set initialization or transaction smoke failed' }

    $env:NODE_ENV = 'test'
    $env:RUN_FINANCIAL_INTEGRATION = 'false'
    $env:RUN_PHASE_B_INTEGRATION = 'false'
    $env:VITE_API_URL = 'https://api.staging.example.test'
    & npm run typecheck
    if ($LASTEXITCODE -ne 0) { throw 'Repository TypeScript check failed' }
    & npm test
    if ($LASTEXITCODE -ne 0) { throw 'Baseline repository tests failed' }
    $env:NODE_ENV = 'production'
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Production build failed' }

    $env:NODE_ENV = 'test'
    $env:RUN_FINANCIAL_INTEGRATION = 'true'
    $env:MONGODB_URI = "mongodb://phase_b_runner:$($env:PHASE_B_RUNNER_PASSWORD)@127.0.0.1:27018/$($env:PHASE_B_TEST_DB_A)?authSource=admin&directConnection=true&replicaSet=rs0"
    & npm run test -w '@latex/api' -- src/financial-service.test.ts --reporter=dot
    if ($LASTEXITCODE -ne 0) { throw 'Phase A MongoDB integration tests failed' }
    $env:RUN_FINANCIAL_INTEGRATION = 'false'
    $env:RUN_PHASE_B_INTEGRATION = 'true'
    $env:MONGODB_URI = "mongodb://phase_b_runner:$($env:PHASE_B_RUNNER_PASSWORD)@127.0.0.1:27018/$($env:PHASE_B_TEST_DB_B)?authSource=admin&directConnection=true&replicaSet=rs0"
    & npm run test -w '@latex/api' -- src/phase-b.test.ts --reporter=dot
    if ($LASTEXITCODE -ne 0) { throw 'Phase B MongoDB integration tests failed' }

    $env:NODE_ENV = 'development'
    $env:RUN_PHASE_B_INTEGRATION = 'false'
    $env:MONGODB_URI = "mongodb://phase_b_runner:$($env:PHASE_B_RUNNER_PASSWORD)@127.0.0.1:27018/$($env:PHASE_B_TEST_DB_E2E)?authSource=admin&directConnection=true&replicaSet=rs0"
    $env:PORT = '4000'
    $env:WEB_ORIGIN = 'http://127.0.0.1:5173'
    $env:JWT_SECRET = New-TestSecret
    $env:E2E_BASE_URL = 'http://127.0.0.1:5173'
    Remove-Item Env:VITE_API_URL -ErrorAction SilentlyContinue
    & (Join-Path $workspace 'node_modules\.bin\tsx.cmd') apps/api/src/seed-e2e.ts
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic E2E seeding failed' }

    $nodeExecutable = (Get-Command node).Source
    $apiProcess = Start-Process -FilePath $nodeExecutable -ArgumentList 'apps/api/dist/server.js' -WorkingDirectory $workspace -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runDirectory 'api.out.log') -RedirectStandardError (Join-Path $runDirectory 'api.err.log')
    $viteScript = Join-Path $workspace 'node_modules\vite\bin\vite.js'
    $webProcess = Start-Process -FilePath $nodeExecutable -ArgumentList @($viteScript, '--host', '127.0.0.1', '--port', '5173', '--strictPort') -WorkingDirectory (Join-Path $workspace 'apps\web') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runDirectory 'web.out.log') -RedirectStandardError (Join-Path $runDirectory 'web.err.log')
    Wait-Http 'http://127.0.0.1:4000/health/ready'
    Wait-Http 'http://127.0.0.1:5173/'
    if ($BrowserTest) {
      Write-Output "Running Playwright browser flow $BrowserTest against $($env:PHASE_B_TEST_DB_E2E)"
      $env:PYTHONPATH = Join-Path $workspace 'tests\browser'
      & python -m unittest "test_acceptance.PhaseBBrowserSmoke.$BrowserTest" -v
    } else {
      Write-Output "Running 20 independent Playwright browser flows against $($env:PHASE_B_TEST_DB_E2E)"
      & python -m unittest discover -s tests/browser -p test_acceptance.py -v
    }
    if ($LASTEXITCODE -ne 0) { throw "Browser acceptance failed with exit code $LASTEXITCODE; test data retained at $runDirectory" }
    Write-Output "Browser acceptance PASSED; isolated test data retained at $runDirectory"
  } finally { Pop-Location }
} finally {
  foreach ($process in @($webProcess, $apiProcess, $mongoProcess)) {
    if ($null -ne $process) {
      $process.Refresh()
      if (-not $process.HasExited) { Stop-Process -InputObject $process -ErrorAction SilentlyContinue }
    }
  }
  $rng.Dispose()
  foreach ($name in @('PHASE_B_BOOTSTRAP_PASSWORD', 'PHASE_B_RUNNER_PASSWORD', 'E2E_PASSWORD', 'MONGODB_URI', 'JWT_SECRET')) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
}
