[CmdletBinding()]
param([switch]$Force)

$ErrorActionPreference = 'Stop'
$subject = 'CN=DAV Studios'
$friendlyName = 'Commit Bubble Development Signing'

if (-not $Force) {
  $answer = Read-Host 'Create/reuse and trust a CURRENT USER DAV Studios development certificate, then build signed artifacts? Type YES to continue'
  if ($answer -cne 'YES') {
    Write-Host 'Cancelled. No certificate or trust-store changes were made.'
    exit 1
  }
}

$certificate = Get-ChildItem 'Cert:\CurrentUser\My' |
  Where-Object { $_.Subject -eq $subject -and $_.FriendlyName -eq $friendlyName -and $_.NotAfter -gt (Get-Date).AddDays(30) } |
  Sort-Object NotAfter -Descending |
  Select-Object -First 1

if (-not $certificate) {
  $certificate = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject $subject `
    -FriendlyName $friendlyName `
    -CertStoreLocation 'Cert:\CurrentUser\My' `
    -HashAlgorithm SHA256 `
    -KeyAlgorithm RSA `
    -KeyLength 3072 `
    -KeyExportPolicy Exportable `
    -NotAfter (Get-Date).AddYears(3)
}

$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("commit-bubble-signing-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
$pfxPath = Join-Path $temporaryDirectory 'commit-bubble-dev.pfx'
$cerPath = Join-Path $temporaryDirectory 'commit-bubble-dev.cer'
$randomBytes = New-Object byte[] 36
$randomGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $randomGenerator.GetBytes($randomBytes) } finally { $randomGenerator.Dispose() }
$passwordText = [Convert]::ToBase64String($randomBytes)
$password = ConvertTo-SecureString $passwordText -AsPlainText -Force

try {
  Export-Certificate -Cert $certificate -FilePath $cerPath -Force | Out-Null
  Export-PfxCertificate -Cert $certificate -FilePath $pfxPath -Password $password -CryptoAlgorithmOption AES256_SHA256 -Force | Out-Null

  $trustedRoot = Get-ChildItem 'Cert:\CurrentUser\Root' | Where-Object Thumbprint -eq $certificate.Thumbprint
  if (-not $trustedRoot) { Import-Certificate -FilePath $cerPath -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null }
  $trustedPublisher = Get-ChildItem 'Cert:\CurrentUser\TrustedPublisher' | Where-Object Thumbprint -eq $certificate.Thumbprint
  if (-not $trustedPublisher) { Import-Certificate -FilePath $cerPath -CertStoreLocation 'Cert:\CurrentUser\TrustedPublisher' | Out-Null }

  $env:CSC_LINK = $pfxPath
  $env:CSC_KEY_PASSWORD = $passwordText
  & npm.cmd run dist:win
  if ($LASTEXITCODE -ne 0) { throw "Signed packaging failed with exit code $LASTEXITCODE" }
} finally {
  $env:CSC_LINK = $null
  $env:CSC_KEY_PASSWORD = $null
  if (Test-Path -LiteralPath $temporaryDirectory) {
    Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
  }
}

Write-Host "Signed Commit Bubble artifacts with $subject ($($certificate.Thumbprint))."
Write-Warning 'This development certificate is trusted only for the current Windows user and does not create public SmartScreen reputation.'
