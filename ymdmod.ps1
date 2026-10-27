param(
    [string]$Action = '',
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\YandexMusic'),
    [string]$UserDataDir = '',
    [switch]$NoLaunch,
    [switch]$Purge,
    [switch]$WaitForClient,
    [string]$Source = '',
    [string]$ReleaseUrl = '',
    [string]$Repo = 'ymdmod/ymdmod',
    [string]$CatalogUrl = '',
    [string]$PathValueName = 'Path'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'installer\common.ps1')
. (Join-Path $PSScriptRoot 'installer\actions.ps1')

if (-not $Action -and $args.Count) { $Action = [string]$args[0] }
$Action = $Action.TrimStart('-').ToLowerInvariant()
if ($Action -and $Action -notin @('install', 'repair', 'uninstall', 'status')) {
    Say 'usage'
    exit 2
}

$ModDir = $PSScriptRoot
$IsCheckout = Test-Path -LiteralPath (Join-Path $ModDir '.git')

function Test-ClientLostMod($status) {
    if ($status.backups) { return $true }
    return -not $IsCheckout -and [bool](Get-InstalledModVersion $ModDir)
}

function Show-Status {
    $modVersion = Get-InstalledModVersion $ModDir
    if (-not $modVersion) { $modVersion = '-' }
    Write-Host ((Text 'statusMod') + " $modVersion  ($ModDir)")
    $status = Get-ModStatus $InstallDir $ModDir
    if (-not $status) { Write-Host ((Text 'statusNoClient') + " $([IO.Path]::GetFullPath($InstallDir))") -ForegroundColor Yellow; return $null }
    Write-Host ((Text 'statusLocation') + " $(Split-Path -Parent $status.exeFile)")
    $line = (Text 'statusClient') + " $($status.version)  -  "
    if (-not $status.integrityOk) { Write-Host ($line + (Text 'stateBroken')) -ForegroundColor Red }
    elseif ($status.patched) { Write-Host ($line + (Text 'stateInstalled')) -ForegroundColor Green }
    elseif (Test-ClientLostMod $status) { Write-Host ($line + (Text 'stateUpdated')) -ForegroundColor Yellow }
    else { Write-Host ($line + (Text 'stateOriginal')) }
    if (Test-ClientRunning $InstallDir) { Write-Host (Text 'stateRunning') -ForegroundColor Yellow }
    return $status
}

function Update-ModFiles {
    if ($Source) { Copy-ModFiles $Source $ModDir; return $true }
    $installed = Get-InstalledModVersion $ModDir
    $release = Get-LatestModRelease $Repo $ReleaseUrl
    if (-not $release) {
        if ($installed) { Say 'releaseOfflineKeep'; return $true }
        Say 'releaseUnavailable'
        return $false
    }
    if ($installed -and -not (Test-NewerVersion $release.Version $installed)) { Say 'modUpToDate' $installed; return $true }
    $temp = Join-Path $env:TEMP "ymdmod-release-$([guid]::NewGuid().ToString('N'))"
    try {
        Copy-ModFiles (Save-ModRelease $release $temp) $ModDir
        return $true
    } catch {
        Write-Host ((Text 'releaseFailed') + ' ' + $_.Exception.Message) -ForegroundColor Red
        return $false
    } finally {
        Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-Install {
    if (-not (Find-ClientExe $InstallDir)) { Say 'notFound' $InstallDir; return $false }
    if ($WaitForClient -and (Test-ClientRunning $InstallDir)) {
        Say 'waitingClient'
        [void](Wait-ClientExit $InstallDir 60)
    }
    if (-not (Close-Client $InstallDir)) { return $false }
    if (-not $IsCheckout) {
        if (-not (Update-ModFiles)) { return $false }
        if (-not (Install-SystemAddons $InstallDir $ModDir $CatalogUrl)) { Say 'systemAddonsMissing' }
    }
    if (-not (Install-ModIntoClient $InstallDir $ModDir)) { return $false }
    Say 'afterUpdateMenu'
    if (-not $NoLaunch) { Start-Client $InstallDir $UserDataDir }
    return $true
}

function Close-ClientIfFound {
    if (-not (Find-ClientExe $InstallDir)) { return $true }
    return (Close-Client $InstallDir)
}

function Invoke-Repair {
    if (-not (Close-ClientIfFound)) { return $false }
    if (-not (Repair-Mod $InstallDir $ModDir)) { return $false }
    if (-not $IsCheckout) { Register-ModCommand $ModDir $PathValueName }
    if (-not $NoLaunch) { Start-Client $InstallDir $UserDataDir }
    return $true
}

function Invoke-Uninstall([bool]$interactive) {
    $wasRunning = (Find-ClientExe $InstallDir) -and (Test-ClientRunning $InstallDir)
    if (-not (Close-ClientIfFound)) { return $false }
    if (-not (Restore-ClientFiles $InstallDir $ModDir)) { return $false }
    if ($wasRunning -and -not $NoLaunch) { Start-Client $InstallDir $UserDataDir }
    if ($IsCheckout) { Say 'modDataKept' $ModDir; return $true }
    $removeFiles = $Purge
    if ($interactive -and -not $Purge) {
        $answer = Read-Host (Text 'askPurge')
        $da = [string][char]0x434
        $removeFiles = "$answer".Trim().ToLower() -in @('y', 'yes', 'd', 'da', $da, $da + [char]0x430)
    }
    if (-not $removeFiles) { Say 'modDataKept' $ModDir; return $true }
    Unregister-ModCommand $ModDir $PathValueName
    Remove-Item -LiteralPath $ModDir -Recurse -Force
    Say 'modFilesRemoved' $ModDir
    return $true
}

function Invoke-Action([string]$name, [bool]$interactive) {
    switch ($name) {
        'install' { return (Invoke-Install) }
        'repair' { return (Invoke-Repair) }
        'update' { return (Invoke-Install) }
        'uninstall' { return (Invoke-Uninstall $interactive) }
        'status' { $null = Show-Status; return $true }
    }
}

function Read-MenuChoice($items) {
    if ([Console]::IsInputRedirected) {
        for ($i = 0; $i -lt $items.Count; $i++) { Write-Host "  $($i + 1). $($items[$i].Label)" }
        $answer = Read-Host (Text 'menuNumber')
        $n = 0
        if ([int]::TryParse("$answer", [ref]$n) -and $n -ge 1 -and $n -le $items.Count) { return $items[$n - 1].Id }
        return 'exit'
    }
    Write-Host (Text 'menuHint') -ForegroundColor DarkGray
    $selected = 0
    $done = $false
    $top = [Console]::CursorTop
    $cursorVisible = $true
    try { $cursorVisible = [Console]::CursorVisible; [Console]::CursorVisible = $false } catch {}
    try {
        while ($true) {
            for ($i = 0; $i -lt $items.Count; $i++) {
                [Console]::SetCursorPosition(0, $top + $i)
                $label = "$($i + 1). $($items[$i].Label)"
                if ($i -eq $selected) { Write-Host ("  > " + $label).PadRight(40) -ForegroundColor Black -BackgroundColor Cyan -NoNewline }
                else { Write-Host ("    " + $label).PadRight(40) -NoNewline }
            }
            $top = [Console]::CursorTop - ($items.Count - 1)
            if ($done) { break }
            $key = [Console]::ReadKey($true)
            if ($key.Key -eq 'UpArrow') { $selected = ($selected + $items.Count - 1) % $items.Count }
            elseif ($key.Key -eq 'DownArrow') { $selected = ($selected + 1) % $items.Count }
            elseif ($key.Key -eq 'Enter') { $done = $true }
            elseif ($key.Key -eq 'Escape') { $selected = $items.Count - 1; $done = $true }
            elseif ($key.KeyChar -ge '1' -and $key.KeyChar -le [char](48 + $items.Count)) { $selected = [int]$key.KeyChar - 49; $done = $true }
        }
    } finally {
        [Console]::SetCursorPosition(0, $top + $items.Count - 1)
        Write-Host ''
        try { [Console]::CursorVisible = $cursorVisible } catch {}
    }
    return $items[$selected].Id
}

if ($Action) {
    if (Invoke-Action $Action $false) { exit 0 }
    if ($WaitForClient) {
        Write-Host (Text 'pressKeyClose') -ForegroundColor DarkGray
        [void][Console]::ReadKey($true)
    }
    exit 1
}

$latest = if ($IsCheckout) { $null } else { Get-LatestModRelease $Repo $ReleaseUrl 5 }

while ($true) {
    if (-not [Console]::IsInputRedirected) { Clear-Host }
    Write-Host (Text 'menuTitle') -ForegroundColor Cyan
    $status = Show-Status
    $installedVersion = Get-InstalledModVersion $ModDir
    $updateAvailable = $latest -and $latest.Zip -and $latest.Sha256 -and $installedVersion -and (Test-NewerVersion $latest.Version $installedVersion)
    if ($updateAvailable) { Write-Host ((Text 'statusUpdate') + " $($latest.Version)") -ForegroundColor Cyan }
    Write-Host ''
    $hasMod = $status -and ($status.patched -or -not $status.integrityOk -or (Test-ClientLostMod $status))
    $main = if ($hasMod) { @{ Id = 'repair'; Label = (Text 'menuRepair') } } else { @{ Id = 'install'; Label = (Text 'menuInstall') } }
    $items = @($main)
    if ($updateAvailable) { $items += @{ Id = 'update'; Label = ((Text 'menuUpdate') + " $($latest.Version)") } }
    $items += @(
        @{ Id = 'uninstall'; Label = (Text 'menuUninstall') },
        @{ Id = 'exit'; Label = (Text 'menuExit') }
    )
    $choice = Read-MenuChoice $items
    if ($choice -eq 'exit') { break }
    Write-Host ''
    $ok = Invoke-Action $choice $true
    if (-not $ok) { Write-Host (Text 'actionFailed') -ForegroundColor Red }
    if ($choice -eq 'uninstall' -and -not (Test-Path -LiteralPath $ModDir)) { break }
    if ($choice -eq 'update' -and $ok) { break }
    if ([Console]::IsInputRedirected) { break }
    Write-Host ''
    Write-Host (Text 'pressKey') -ForegroundColor DarkGray
    [void][Console]::ReadKey($true)
}
