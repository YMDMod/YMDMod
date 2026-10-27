param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\YandexMusic')
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'installer\common.ps1')
. (Join-Path $PSScriptRoot 'installer\actions.ps1')

if (-not (Restore-ClientFiles $InstallDir $PSScriptRoot)) { exit 1 }
Say 'modDataKept' $PSScriptRoot
