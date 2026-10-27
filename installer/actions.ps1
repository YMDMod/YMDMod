function Get-ModStatus([string]$InstallDir, [string]$ModDir) {
    $exe = Find-ClientExe $InstallDir
    if (-not $exe) { return $null }
    $patch = Join-Path $ModDir 'installer\patch.js'
    $result = Invoke-ClientNode $exe.FullName @($patch, 'status', '--dir', $InstallDir)
    if ($result.Code -ne 0) { $result.Output | ForEach-Object { Write-Host $_ }; return $null }
    $status = ($result.Output -join "`n") | ConvertFrom-Json
    $status | Add-Member -NotePropertyName exeFile -NotePropertyValue $exe.FullName
    return $status
}

function Install-ModIntoClient([string]$InstallDir, [string]$ModDir) {
    $exe = Find-ClientExe $InstallDir
    if (-not $exe) { Say 'notFound' $InstallDir; return $false }
    if (Test-ClientRunning $InstallDir) { Say 'running'; return $false }

    $patch = Join-Path $ModDir 'installer\patch.js'
    $result = Invoke-ClientNode $exe.FullName @($patch, 'prepare', '--dir', $InstallDir, '--mod-dir', $ModDir)
    $result.Output | ForEach-Object { Write-Host $_ }
    if ($result.Code -ne 0) { Say 'failed'; return $false }

    $asar = Join-Path $InstallDir 'resources\app.asar'
    $pairs = @(
        @{ Source = "$asar.ymdmod-new"; Target = $asar },
        @{ Source = "$($exe.FullName).ymdmod-new"; Target = $exe.FullName }
    )
    if (-not (Set-ClientFiles $pairs)) { Say 'failed'; return $false }
    Say 'swapped'

    $result = Invoke-ClientNode $exe.FullName @($patch, 'check', '--dir', $InstallDir)
    $result.Output | ForEach-Object { Write-Host $_ }
    if ($result.Code -ne 0) { return $false }
    Say 'signature'
    return $true
}

function Restore-ClientFiles([string]$InstallDir, [string]$ModDir) {
    $status = Get-ModStatus $InstallDir $ModDir
    if (-not $status) { Say 'notFound' $InstallDir; return $false }
    if (Test-ClientRunning $InstallDir) { Say 'running'; return $false }

    $asar = Join-Path $InstallDir 'resources\app.asar'
    $backups = @("$asar.ymdmod-backup", "$($status.exeFile).ymdmod-backup")
    if (-not $status.patched) {
        Say 'notInstalled'
        if ($status.backups) {
            Say 'staleBackups'
            foreach ($file in $backups) { Remove-Item -LiteralPath $file -Force }
        }
        return $true
    }
    if (-not $status.backups) { Say 'noBackups'; return $false }

    $pairs = @(
        @{ Source = $backups[0]; Target = $asar },
        @{ Source = $backups[1]; Target = $status.exeFile }
    )
    if (-not (Set-ClientFiles $pairs)) { return $false }
    $patch = Join-Path $ModDir 'installer\patch.js'
    $result = Invoke-ClientNode $status.exeFile @($patch, 'check', '--dir', $InstallDir)
    $result.Output | ForEach-Object { Write-Host $_ }
    Say 'restored'
    return $true
}

function Repair-Mod([string]$InstallDir, [string]$ModDir) {
    $exe = Find-ClientExe $InstallDir
    if (-not $exe) { Say 'notFound' $InstallDir; return $false }
    if (Test-ClientRunning $InstallDir) { Say 'running'; return $false }

    $asar = Join-Path $InstallDir 'resources\app.asar'
    foreach ($target in @($asar, $exe.FullName)) {
        foreach ($suffix in @('.ymdmod-new', '.ymdmod-old')) {
            $leftover = $target + $suffix
            if (Test-Path -LiteralPath $leftover) { Say 'leftover' $leftover; Remove-Item -LiteralPath $leftover -Force }
        }
    }

    $status = Get-ModStatus $InstallDir $ModDir
    if (-not $status) { Say 'failed'; return $false }
    if (-not $status.integrityOk) {
        if (-not ($status.backups -and $status.backupVersion -eq $status.version)) { Say 'brokenNoBackups'; return $false }
        Say 'brokenRestore'
        $pairs = @(
            @{ Source = "$asar.ymdmod-backup"; Target = $asar },
            @{ Source = "$($exe.FullName).ymdmod-backup"; Target = $exe.FullName }
        )
        foreach ($pair in $pairs) { Copy-Item -LiteralPath $pair.Source -Destination ($pair.Source + '.copy') -Force }
        $ok = Set-ClientFiles $pairs
        foreach ($pair in $pairs) { Move-Item -LiteralPath ($pair.Source + '.copy') -Destination $pair.Source -Force }
        if (-not $ok) { return $false }
    }
    return (Install-ModIntoClient $InstallDir $ModDir)
}

function Get-CommandDir([string]$ModDir) { Join-Path $ModDir 'bin' }

function Send-EnvironmentChanged {
    if (-not ('YmdEnv' -as [type])) {
        Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class YmdEnv {
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);
}
"@
    }
    $result = [UIntPtr]::Zero
    [void][YmdEnv]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 2000, [ref]$result)
}

function Edit-UserPath([string]$dir, [bool]$add, [string]$valueName = 'Path') {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
    try {
        $raw = [string]$key.GetValue($valueName, '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        $parts = @($raw -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ne $dir.TrimEnd('\') })
        if ($add) { $parts += $dir }
        $new = $parts -join ';'
        if ($new -eq $raw) { return }
        if ($new) { $key.SetValue($valueName, $new, [Microsoft.Win32.RegistryValueKind]::ExpandString) }
        else { $key.DeleteValue($valueName, $false) }
    } finally {
        $key.Close()
    }
    if ($valueName -eq 'Path') { Send-EnvironmentChanged }
}

function Register-ModCommand([string]$ModDir, [string]$PathValueName = 'Path') {
    $bin = Get-CommandDir $ModDir
    New-Item -ItemType Directory -Force -Path $bin | Out-Null
    $cmd = "@echo off`r`n" +
        "(goto) 2>nul & `"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`" -NoProfile -ExecutionPolicy Bypass -File `"%~dp0..\ymdmod.ps1`" %*`r`n"
    [IO.File]::WriteAllText((Join-Path $bin 'ymdmod.cmd'), $cmd, [Text.Encoding]::ASCII)
    Edit-UserPath $bin $true $PathValueName
    if (-not (($env:Path -split ';') -contains $bin)) { $env:Path = "$env:Path;$bin" }
    Say 'commandRegistered'
}

function Unregister-ModCommand([string]$ModDir, [string]$PathValueName = 'Path') {
    $bin = Get-CommandDir $ModDir
    Edit-UserPath $bin $false $PathValueName
    $cmdFile = Join-Path $bin 'ymdmod.cmd'
    if (Test-Path -LiteralPath $cmdFile) { Remove-Item -LiteralPath $cmdFile -Force }
    Say 'commandRemoved'
}

function Get-InstalledModVersion([string]$ModDir) {
    $file = Join-Path $ModDir 'package.json'
    if (-not (Test-Path -LiteralPath $file)) { return $null }
    (Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json).version
}

function Get-LatestModRelease([string]$Repo, [string]$ReleaseUrl, [int]$TimeoutSec = 15) {
    try {
        if ($ReleaseUrl -and (Test-Path -LiteralPath $ReleaseUrl)) {
            $release = Get-Content -Raw -Encoding UTF8 -LiteralPath $ReleaseUrl | ConvertFrom-Json
        } else {
            [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
            $url = if ($ReleaseUrl) { $ReleaseUrl } else { "https://api.github.com/repos/$Repo/releases/latest" }
            $release = Invoke-RestMethod -Uri $url -Headers @{ 'User-Agent' = 'ymdmod' } -TimeoutSec $TimeoutSec
        }
    } catch {
        return $null
    }
    $version = "$($release.tag_name)" -replace '^v', ''
    if ($version -notmatch '^\d+\.\d+\.\d+$') { return $null }
    $archive = Find-ReleaseArchive $release
    return @{ Version = $version; Tag = $release.tag_name; Url = $release.html_url; Zip = $archive.Url; Sha256 = $archive.Sha256 }
}

function Read-RemoteText([string]$location) {
    if (Test-Path -LiteralPath $location) { return Get-Content -Raw -LiteralPath $location }
    return [string](Invoke-RestMethod -Uri $location -Headers @{ 'User-Agent' = 'ymdmod' })
}

function Save-RemoteFile([string]$location, [string]$destination) {
    if (Test-Path -LiteralPath $location) { Copy-Item -LiteralPath $location -Destination $destination }
    else { Invoke-WebRequest -Uri $location -OutFile $destination -UseBasicParsing -Headers @{ 'User-Agent' = 'ymdmod' } }
}

function Find-ReleaseArchive($release) {
    $assets = @($release.assets)
    $archive = $assets | Where-Object { $_.name -like 'ymdmod-*.zip' } | Select-Object -First 1
    if (-not $archive) { return @{ Url = $null; Sha256 = $null } }
    $sha256 = $null
    if ("$($archive.digest)" -like 'sha256:*') { $sha256 = "$($archive.digest)".Substring(7) }
    $checksum = $assets | Where-Object { $_.name -eq "$($archive.name).sha256" } | Select-Object -First 1
    if (-not $sha256 -and $checksum) {
        try { $sha256 = (Read-RemoteText $checksum.browser_download_url).Trim().Split()[0] } catch {}
    }
    return @{ Url = $archive.browser_download_url; Sha256 = $sha256 }
}

function Save-ModRelease($Release, [string]$Temp) {
    if (-not $Release.Zip -or -not $Release.Sha256) { throw (Text 'releaseNoArchive') }
    Say 'downloading' "$($Release.Tag)"
    New-Item -ItemType Directory -Force -Path $Temp | Out-Null
    $zip = Join-Path $Temp 'release.zip'
    Save-RemoteFile $Release.Zip $zip
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash
    if ($actual -ne $Release.Sha256.ToUpperInvariant()) { throw ((Text 'releaseHashMismatch') + " $actual") }
    Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $Temp 'source')
    $hostFile = Get-ChildItem -LiteralPath (Join-Path $Temp 'source') -Filter 'host.js' -Recurse -Depth 2 | Where-Object { $_.Directory.Name -eq 'core' } | Select-Object -First 1
    if (-not $hostFile) { throw 'core\host.js not found in the release archive' }
    return $hostFile.Directory.Parent.FullName
}

function Install-SystemAddons([string]$InstallDir, [string]$ModDir, [string]$CatalogUrl) {
    $exe = Find-ClientExe $InstallDir
    if (-not $exe) { return $false }
    Say 'systemAddons'
    $arguments = @((Join-Path $ModDir 'installer\system-addons.js'), '--addons-dir', (Join-Path $ModDir 'addons'))
    if ($CatalogUrl) { $arguments += @('--catalog', $CatalogUrl) }
    $result = Invoke-ClientNode $exe.FullName $arguments
    $result.Output | ForEach-Object { Write-Host "  $_" }
    return ($result.Code -eq 0)
}

function Test-NewerVersion([string]$candidate, [string]$installed) {
    return ([version]$candidate) -gt ([version]$installed)
}

function Copy-ModFiles([string]$Source, [string]$ModDir) {
    if ([IO.Path]::GetFullPath($Source).TrimEnd('\') -eq [IO.Path]::GetFullPath($ModDir).TrimEnd('\')) { return }
    Say 'copying' $ModDir
    New-Item -ItemType Directory -Force -Path (Join-Path $ModDir 'addons') | Out-Null
    foreach ($part in @('core', 'installer')) {
        $target = Join-Path $ModDir $part
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
        Copy-Item -LiteralPath (Join-Path $Source $part) -Destination $target -Recurse
    }
    Remove-Item -LiteralPath (Join-Path $ModDir 'tools') -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $ModDir 'core\test') -Recurse -Force -ErrorAction SilentlyContinue
    foreach ($file in @('package.json', 'install.ps1', 'uninstall.ps1', 'ymdmod.ps1', 'LICENSE')) {
        $path = Join-Path $Source $file
        if (Test-Path -LiteralPath $path) { Copy-Item -LiteralPath $path -Destination $ModDir -Force }
    }
}

function Start-Client([string]$InstallDir, [string]$UserDataDir) {
    $exe = Find-ClientExe $InstallDir
    if (-not $exe) { return }
    Say 'launching'
    $commandLine = '"' + $exe.FullName + '"'
    if ($UserDataDir) { $commandLine += ' "--user-data-dir=' + [IO.Path]::GetFullPath($UserDataDir) + '"' }
    $result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $commandLine; CurrentDirectory = $exe.DirectoryName }
    if ($result.ReturnValue -eq 0) { return }
    if ($UserDataDir) { Start-Process -FilePath $exe.FullName -ArgumentList "--user-data-dir=$([IO.Path]::GetFullPath($UserDataDir))" }
    else { Start-Process -FilePath $exe.FullName }
}
