[CmdletBinding()]
param([string]$ReleaseDirectory)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($ReleaseDirectory)) {
  $ReleaseDirectory = Join-Path $PSScriptRoot '..\release'
}
$resolvedRelease = [System.IO.Path]::GetFullPath($ReleaseDirectory)
if (-not (Test-Path -LiteralPath $resolvedRelease)) { throw "Release directory not found: $resolvedRelease" }

$signTool = Get-ChildItem -LiteralPath 'C:\Program Files (x86)\Windows Kits\10\bin' -Filter 'signtool.exe' -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
  Sort-Object FullName -Descending |
  Select-Object -First 1
if (-not $signTool) { throw 'Windows SDK SignTool was not found.' }

$artifacts = @(Get-ChildItem -LiteralPath $resolvedRelease -Filter '*.exe' -File)
if ($artifacts.Count -eq 0) { throw "No Windows executables found in $resolvedRelease" }

foreach ($artifact in $artifacts) {
  & $signTool.FullName verify /pa /all /v $artifact.FullName
  if ($LASTEXITCODE -ne 0) { throw "Signature verification failed: $($artifact.FullName)" }
}
Write-Host "Verified $($artifacts.Count) signed release artifact(s)."
