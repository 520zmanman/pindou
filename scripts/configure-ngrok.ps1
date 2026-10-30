$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$ngrokPath = Join-Path $projectRoot 'data\tools\ngrok\ngrok.exe'
$configPath = Join-Path $projectRoot 'data\ngrok-pindou.yml'

if (-not (Test-Path -LiteralPath $ngrokPath)) {
  throw "Pindou ngrok was not found: $ngrokPath"
}

Write-Host ''
Write-Host 'Pindou ngrok setup' -ForegroundColor Cyan
Write-Host '1. Sign in to the new ngrok Free account.'
Write-Host '2. Open https://dashboard.ngrok.com/get-started/your-authtoken'
Write-Host '3. Copy and paste the Authtoken below. Input is hidden.'
Write-Host ''

$secureToken = Read-Host 'Authtoken' -AsSecureString
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
  $plainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
  if ([string]::IsNullOrWhiteSpace($plainToken) -or $plainToken.Length -lt 20) {
    throw 'The Authtoken looks incomplete. Copy it again from the ngrok dashboard.'
  }

  & $ngrokPath config add-authtoken $plainToken --config $configPath
  if ($LASTEXITCODE -ne 0) { throw 'ngrok could not save the Authtoken.' }
} finally {
  if ($tokenPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
  }
  $plainToken = $null
}

& $ngrokPath config check --config $configPath
if ($LASTEXITCODE -ne 0) { throw 'Pindou ngrok configuration validation failed.' }

Write-Host ''
Write-Host 'Setup complete. You can now run start-public-ngrok.bat.' -ForegroundColor Green
Write-Host "Private configuration: $configPath"
Write-Host 'This file is inside the Git-ignored data directory.'
