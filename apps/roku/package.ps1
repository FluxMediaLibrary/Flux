param(
  [string]$OutputDirectory = ""
)
$ErrorActionPreference = "Stop"
$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $appRoot "..\..")
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $appRoot "dist" }

Push-Location $repoRoot
try {
  npm run roku:test
  if ($LASTEXITCODE -ne 0) { throw "Roku unit tests failed" }
  npm run roku:check
  if ($LASTEXITCODE -ne 0) { throw "Roku validation failed" }

  # Compress-Archive records Windows backslashes in ZIP entry names. Roku's
  # Linux-based developer installer rejects those archives with HTTP 400.
  # The Python packager emits the required POSIX entry names and verifies them.
  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($null -eq $python) { throw "Python is required to create a Roku-compatible archive. Install Python 3 and retry." }

  & $python.Source (Join-Path $appRoot "package.py")
  if ($LASTEXITCODE -ne 0) { throw "Roku archive creation failed" }

  $manifest = @{}
  Get-Content (Join-Path $appRoot "manifest") | ForEach-Object {
    if ($_ -match '^([^#=]+)=(.*)$') { $manifest[$matches[1].Trim()] = $matches[2].Trim() }
  }
  $version = "$($manifest.major_version).$($manifest.minor_version).$($manifest.build_version)"
  $builtZipPath = Join-Path $appRoot "dist\flux-roku-$version.zip"
  if (-not (Test-Path -LiteralPath $builtZipPath)) { throw "Roku archive was not created at $builtZipPath" }
  New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
  $zipPath = Join-Path $OutputDirectory "flux-roku-$version.zip"
  if ((Resolve-Path $OutputDirectory).Path -ne (Resolve-Path (Join-Path $appRoot "dist")).Path) {
    Copy-Item -LiteralPath $builtZipPath -Destination $zipPath -Force
  }
  Write-Output $zipPath
} finally {
  Pop-Location
}
