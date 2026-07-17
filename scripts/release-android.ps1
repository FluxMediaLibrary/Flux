param(
  [Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
  [switch]$Mandatory,
  [int]$MinimumSupportedVersionCode = 4
)

$root = Split-Path -Parent $PSScriptRoot
$gradle = Join-Path $root 'android'
$buildFile = Join-Path $gradle 'app\build.gradle.kts'
$releaseRoot = Join-Path $root 'releases\android'
$name = "Flux-Android-v$Version.apk"
$destination = Join-Path $releaseRoot $name
if (-not (Test-Path (Join-Path $root 'flux-release.keystore'))) { throw 'Release keystore is missing.' }
if (-not (Test-Path (Join-Path $root '.twa-keystore-password.txt'))) { throw 'Release keystore password file is missing.' }

$source = Get-Content -LiteralPath $buildFile -Raw
$match = [regex]::Match($source, 'versionCode\s*=\s*(\d+)')
if (-not $match.Success) { throw 'Could not find Android versionCode.' }
$code = [int]$match.Groups[1].Value
$nameMatch = [regex]::Match($source, 'versionName\s*=\s*"([^"]+)"')
if (-not $nameMatch.Success -or $nameMatch.Groups[1].Value -ne $Version) { throw "Set versionName to $Version in android/app/build.gradle.kts before releasing." }
& gradle :app:assembleRelease --no-daemon -p $gradle
if ($LASTEXITCODE -ne 0) { throw 'Android release build failed.' }
$apk = Join-Path $gradle 'app\build\outputs\apk\release\app-release.apk'
if (-not (Test-Path $apk)) { throw 'Signed release APK was not produced.' }
New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
Copy-Item -LiteralPath $apk -Destination $destination -Force
$hash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
$size = (Get-Item -LiteralPath $destination).Length
$manifest = [ordered]@{
  versionCode = $code; versionName = $Version; minimumSupportedVersionCode = $MinimumSupportedVersionCode
  mandatory = [bool]$Mandatory; releaseDate = [DateTime]::UtcNow.ToString('o')
  releaseNotes = @('Rebuilt native TV casting', 'Added verified in-app APK updates', 'Improved receiver playback security')
  apkUrl = "/api/app/android/download/$name"; sha256 = $hash; fileSize = $size
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $releaseRoot 'latest.json') -Encoding utf8
Copy-Item -LiteralPath $destination -Destination (Join-Path $root $name) -Force
Write-Output "Published $name (versionCode $code, SHA-256 $hash)"
