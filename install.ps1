param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\YandexMusic'),
    [string]$ModDir = (Join-Path $env:LOCALAPPDATA 'YMDMod'),
    [switch]$Latest,
    [switch]$Dev,
    [switch]$NoCommand,
    [string]$UserDataDir = '',
    [switch]$NoLaunch,
    [string]$ReleaseUrl = '',
    [string]$RawBase = 'https://raw.githubusercontent.com',
    [string]$CatalogUrl = '',
    [string]$Repo = 'ymdmod/ymdmod',
    [string]$PathValueName = 'Path'
)
$ErrorActionPreference = 'Stop'

$ManagerFiles = @('ymdmod.ps1', 'installer\common.ps1', 'installer\actions.ps1', 'installer\messages.json')

function Get-LatestTag {
    if ($ReleaseUrl -and (Test-Path -LiteralPath $ReleaseUrl)) {
        return (Get-Content -Raw -Encoding UTF8 -LiteralPath $ReleaseUrl | ConvertFrom-Json).tag_name
    }
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $url = if ($ReleaseUrl) { $ReleaseUrl } else { "https://api.github.com/repos/$Repo/releases/latest" }
    return (Invoke-RestMethod -Uri $url -Headers @{ 'User-Agent' = 'ymdmod' }).tag_name
}

function Save-ManagerFromRelease([string]$target) {
    $tag = Get-LatestTag
    Write-Host "YMDMod $tag"
    foreach ($file in $ManagerFiles) {
        $dest = Join-Path $target $file
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
        $relative = $file.Replace('\', '/')
        if (Test-Path -LiteralPath $RawBase) { Copy-Item -LiteralPath (Join-Path $RawBase "$Repo\$tag\$file") -Destination $dest -Force }
        else { Invoke-WebRequest -Uri "$RawBase/$Repo/$tag/$relative" -OutFile $dest -UseBasicParsing -Headers @{ 'User-Agent' = 'ymdmod' } }
    }
}

function Install-Manager {
    try {
        $hasLocalFiles = $PSScriptRoot -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'core\host.js'))
        $fromFolder = $hasLocalFiles -and -not $Latest
        $target = if ($Dev) { $PSScriptRoot } else { [IO.Path]::GetFullPath($ModDir) }

        if (-not $Dev) {
            if ($fromFolder) {
                foreach ($file in $ManagerFiles) {
                    $dest = Join-Path $target $file
                    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
                    if ((Join-Path $PSScriptRoot $file) -ne $dest) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $dest -Force }
                }
            } else {
                Save-ManagerFromRelease $target
            }
        }

        . (Join-Path $target 'installer\common.ps1')
        . (Join-Path $target 'installer\actions.ps1')
        if ($Dev) { Say 'devMode' $target }
        $registerCommand = -not $Dev -and -not $NoCommand
        if ($registerCommand) { Register-ModCommand $target $PathValueName }

        $options = @{ Action = 'install'; InstallDir = $InstallDir; UserDataDir = $UserDataDir; Repo = $Repo; PathValueName = $PathValueName }
        if ($fromFolder -and -not $Dev) { $options.Source = $PSScriptRoot }
        if ($ReleaseUrl) { $options.ReleaseUrl = $ReleaseUrl }
        if ($CatalogUrl) { $options.CatalogUrl = $CatalogUrl }
        if ($NoLaunch) { $options.NoLaunch = $true }
        & (Join-Path $target 'ymdmod.ps1') @options
        $code = $LASTEXITCODE
        if ($code -eq 0 -and $registerCommand) { Say 'commandHint' }
        return $code
    } catch {
        Write-Host "YMDMod: $($_.Exception.Message)" -ForegroundColor Red
        return 1
    }
}

$code = Install-Manager
if ($PSCommandPath) { exit $code }
