$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$ngrokPath = Join-Path $projectRoot 'data\tools\ngrok\ngrok.exe'
$configPath = Join-Path $projectRoot 'data\ngrok-pindou.yml'
$logDirectory = Join-Path $projectRoot 'data\logs'
$serverOutput = Join-Path $logDirectory 'server-public.out.log'
$serverError = Join-Path $logDirectory 'server-public.err.log'
$startedServer = $null

if (-not (Test-Path -LiteralPath $ngrokPath)) {
  throw "Pindou ngrok was not found: $ngrokPath"
}
if (-not (Test-Path -LiteralPath $configPath)) {
  throw 'The new ngrok account is not configured. Run configure-ngrok.bat first.'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js was not found.'
}

& $ngrokPath config check --config $configPath
if ($LASTEXITCODE -ne 0) { throw 'The ngrok configuration is invalid. Run configure-ngrok.bat again.' }

function Test-PindouServer {
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4173/api/health' -TimeoutSec 2
    return $health.ok -eq $true
  } catch {
    return $false
  }
}

if (-not (Test-PindouServer)) {
  New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
  Write-Host 'Starting the local Pindou server...' -ForegroundColor Cyan
  $startedServer = Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $serverOutput -RedirectStandardError $serverError

  $ready = $false
  foreach ($attempt in 1..20) {
    Start-Sleep -Milliseconds 500
    if (Test-PindouServer) { $ready = $true; break }
    if ($startedServer.HasExited) { break }
  }
  if (-not $ready) {
    if ($startedServer -and -not $startedServer.HasExited) { Stop-Process -Id $startedServer.Id -ErrorAction SilentlyContinue }
    $details = if (Test-Path $serverError) { Get-Content $serverError -Raw } else { '' }
    throw "The local Pindou server failed to start.$([Environment]::NewLine)$details"
  }
}

Write-Host ''
Write-Host 'Local Pindou server: http://127.0.0.1:4173' -ForegroundColor Green
Write-Host 'Starting the public ngrok endpoint...' -ForegroundColor Cyan
Write-Host 'Copy the Forwarding HTTPS address shown by ngrok.'
Write-Host 'Press Ctrl+C to stop public access.'
Write-Host ''

try {
  & $ngrokPath http 4173 --url 'https://' --config $configPath
} finally {
  if ($startedServer -and -not $startedServer.HasExited) {
    Stop-Process -Id $startedServer.Id -ErrorAction SilentlyContinue
  }
}
