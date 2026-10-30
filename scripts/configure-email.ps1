[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$dataDirectory = Join-Path $projectRoot 'data'
$configPath = Join-Path $dataDirectory 'smtp-config.json'

Write-Host ''
Write-Host '豆格真实邮箱验证码配置' -ForegroundColor Cyan
Write-Host '授权码只保存在本机 data/smtp-config.json，不会写入源码或上传 GitHub。'
Write-Host ''

$provider = (Read-Host '邮箱服务商：1=网易163（推荐当前使用），2=QQ邮箱，3=自定义 [默认 1]').Trim()
if (-not $provider) { $provider = '1' }

switch ($provider) {
  '1' { $smtpHost = 'smtp.163.com'; $smtpPort = 465 }
  '2' { $smtpHost = 'smtp.qq.com'; $smtpPort = 465 }
  '3' {
    $smtpHost = (Read-Host 'SMTP 服务器地址').Trim()
    $portText = (Read-Host 'SMTP TLS 端口 [默认 465]').Trim()
    $smtpPort = if ($portText) { [int]$portText } else { 465 }
  }
  default { throw '邮箱服务商选项不正确。' }
}

$email = (Read-Host '用于发送验证码的完整邮箱地址').Trim().ToLowerInvariant()
if ($email -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') { throw '邮箱地址格式不正确。' }
if (-not $smtpHost -or $smtpPort -lt 1 -or $smtpPort -gt 65535) { throw 'SMTP 服务器或端口不正确。' }

Write-Host '请输入邮箱的“客户端授权码”，不是网页登录密码。输入时不会显示字符。' -ForegroundColor Yellow
$secureAuthorizationCode = Read-Host '客户端授权码' -AsSecureString
$credentialPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureAuthorizationCode)
try {
  $authorizationCode = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($credentialPointer)
  if (-not $authorizationCode) { throw '客户端授权码不能为空。' }

  $config = [ordered]@{
    SMTP_HOST = $smtpHost
    SMTP_PORT = $smtpPort
    SMTP_USER = $email
    SMTP_PASS = $authorizationCode
    SMTP_FROM = $email
    SMTP_HELO = 'pindou.local'
  }

  New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
  $json = $config | ConvertTo-Json
  [IO.File]::WriteAllText($configPath, $json, [Text.UTF8Encoding]::new($false))
} finally {
  if ($credentialPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($credentialPointer) }
  $authorizationCode = $null
}

Write-Host ''
Write-Host "邮箱配置已保存：$configPath" -ForegroundColor Green
Write-Host '请重启豆格服务，然后在注册页面点击“发送验证码”测试真实邮件。'
