[CmdletBinding()]
param(
  [ValidateSet('win', 'mac', 'linux')]
  [string]$Platform = 'win',
  [string]$Tag
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$desktopPackage = Get-Content -Raw (Join-Path $repoRoot 'apps/desktop/package.json') | ConvertFrom-Json
$version = [string]$desktopPackage.version

if (-not $Tag) { $Tag = "pc-v$version" }
if ($Tag -ne "pc-v$version") {
  throw "Tag $Tag does not match the desktop package version $version. Update apps/desktop/package.json and package-lock.json first."
}

Push-Location $repoRoot
try {
  gh auth status
  if ($LASTEXITCODE -ne 0) { throw 'GitHub CLI is not authenticated.' }

  gh release view $Tag --json tagName | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "GitHub Release $Tag does not exist." }

  npm test --workspace @flux/desktop
  if ($LASTEXITCODE -ne 0) { throw 'Desktop tests failed.' }

  npm run dist --workspace @flux/desktop -- --$Platform
  if ($LASTEXITCODE -ne 0) { throw "$Platform packaging failed." }

  $pattern = switch ($Platform) {
    'win' { '^(latest\.yml|Flux-Setup-.*\.(exe|exe\.blockmap))$' }
    'mac' { '^(latest-mac\.yml|Flux-.*-mac-.*\.(dmg|zip|blockmap))$' }
    'linux' { '^(latest-linux.*\.yml|Flux-.*-linux-.*\.(AppImage|deb|rpm|blockmap))$' }
  }

  $assets = Get-ChildItem (Join-Path $repoRoot 'apps/desktop/release') -File |
    Where-Object { $_.Name -match $pattern } |
    Select-Object -ExpandProperty FullName
  if (-not $assets) { throw "No $Platform release assets were produced." }

  gh release upload $Tag @assets --clobber
  if ($LASTEXITCODE -ne 0) { throw "Uploading $Platform assets failed." }

  Write-Host "Uploaded $($assets.Count) ready-to-use $Platform assets to $Tag."
} finally {
  Pop-Location
}
