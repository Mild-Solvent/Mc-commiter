[CmdletBinding()]
param(
  [string]$OutputDirectory,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $PSScriptRoot '..\.certs'
}
$publisher = 'DAV Studios'
$subject = 'CN=DAV Studios'

if (-not $Force) {
  $answer = Read-Host "Create and trust a CURRENT USER self-signed code-signing certificate for $publisher on this machine? Type YES to continue"
  if ($answer -cne 'YES') {
    Write-Host 'Cancelled. No certificate or trust-store changes were made.'
    exit 1
  }
}

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null
$password = Read-Host 'Choose a password for the exported PFX' -AsSecureString
if ($password.Length -eq 0) { throw 'A non-empty PFX password is required.' }

$certificate = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject $subject `
  -FriendlyName 'Commit Bubble Development Signing' `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -HashAlgorithm SHA256 `
  -KeyAlgorithm RSA `
  -KeyLength 3072 `
  -KeyExportPolicy Exportable `
  -NotAfter (Get-Date).AddYears(3)

$cerPath = Join-Path $resolvedOutput 'DAV-Studios-Commit-Bubble.cer'
$pfxPath = Join-Path $resolvedOutput 'DAV-Studios-Commit-Bubble.pfx'
Export-Certificate -Cert $certificate -FilePath $cerPath -Force | Out-Null
Export-PfxCertificate -Cert $certificate -FilePath $pfxPath -Password $password -CryptoAlgorithmOption AES256_SHA256 -Force | Out-Null
Import-Certificate -FilePath $cerPath -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null
Import-Certificate -FilePath $cerPath -CertStoreLocation 'Cert:\CurrentUser\TrustedPublisher' | Out-Null

Write-Host "Created and trusted $subject for the current Windows user."
Write-Host "PFX: $pfxPath"
Write-Host 'Before packaging, set CSC_LINK to the PFX path and CSC_KEY_PASSWORD to its password in the current shell.'
Write-Warning 'This certificate is trusted only on machines where its public certificate is installed. It does not create public SmartScreen reputation.'
