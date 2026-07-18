param(
  [Parameter(Mandatory = $true)][string]$RokuIp,
  [Parameter(Mandatory = $true)][string]$Password,
  [string]$Username = "rokudev"
)
$ErrorActionPreference = "Stop"
$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$zipPath = & (Join-Path $appRoot "package.ps1") | Select-Object -Last 1
curl.exe --fail --silent --show-error --digest --user "${Username}:${Password}" -F "mysubmit=Install" -F "archive=@$zipPath" "http://$RokuIp/plugin_install"
if ($LASTEXITCODE -ne 0) { throw "Roku sideload failed" }
Write-Output "Flux Roku sideloaded to $RokuIp"

