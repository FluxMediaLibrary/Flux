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

  $manifest = @{}
  Get-Content (Join-Path $appRoot "manifest") | ForEach-Object {
    if ($_ -match '^([^#=]+)=(.*)$') { $manifest[$matches[1].Trim()] = $matches[2].Trim() }
  }
  $version = "$($manifest.major_version).$($manifest.minor_version).$($manifest.build_version)"
  New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
  $zipPath = Join-Path $OutputDirectory "flux-roku-$version.zip"
  if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath }

  $staging = Join-Path $OutputDirectory "staging-$([guid]::NewGuid().ToString('N'))"
  New-Item -ItemType Directory -Path $staging | Out-Null
  try {
    Copy-Item -LiteralPath (Join-Path $appRoot "manifest") -Destination $staging
    foreach ($folder in @("source", "components", "images", "locale")) {
      $candidate = Join-Path $appRoot $folder
      if (Test-Path -LiteralPath $candidate) { Copy-Item -Recurse -LiteralPath $candidate -Destination $staging }
    }
    Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $zipPath -CompressionLevel Optimal
  } finally {
    if (Test-Path -LiteralPath $staging) { Remove-Item -Recurse -Force -LiteralPath $staging }
  }
  Write-Output $zipPath
} finally {
  Pop-Location
}
