$script:Msg = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'messages.json') | ConvertFrom-Json

function Text([string]$key) { $script:Msg.$key }

function Say([string]$key, [string]$extra = '') {
    $text = $script:Msg.$key
    if ($extra) { $text = "$text $extra" }
    Write-Host $text
}

function Find-ClientExe([string]$dir) {
    if (-not (Test-Path (Join-Path $dir 'resources\app.asar'))) { return $null }
    Get-ChildItem -LiteralPath $dir -Filter *.exe | Where-Object { $_.Name -notlike 'Uninstall*' } | Select-Object -First 1
}

function Get-ClientProcesses([string]$dir) {
    $prefix = (Resolve-Path -LiteralPath $dir).Path.TrimEnd('\') + '\'
    @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) })
}

function Test-ClientRunning([string]$dir) {
    return (Get-ClientProcesses $dir).Count -gt 0
}

function Wait-ClientExit([string]$dir, [int]$Seconds) {
    for ($i = 0; $i -lt $Seconds * 2; $i++) {
        if (-not (Test-ClientRunning $dir)) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return -not (Test-ClientRunning $dir)
}

function Close-Client([string]$dir, [int]$GraceSeconds = 15) {
    if (-not (Test-ClientRunning $dir)) { return $true }
    Say 'closingClient'
    foreach ($process in Get-ClientProcesses $dir) {
        if ($process.MainWindowHandle -ne [IntPtr]::Zero) { [void]$process.CloseMainWindow() }
    }
    if (Wait-ClientExit $dir $GraceSeconds) { return $true }
    Say 'closingClientForce'
    Get-ClientProcesses $dir | Stop-Process -Force -ErrorAction SilentlyContinue
    if (Wait-ClientExit $dir 10) { return $true }
    Say 'clientNotClosed'
    return $false
}

function Invoke-ClientNode([string]$exe, [string[]]$arguments) {
    $env:ELECTRON_RUN_AS_NODE = '1'
    $encoding = [Console]::OutputEncoding
    try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false } catch {}
    try {
        $output = & $exe @arguments | ForEach-Object { $_ }
        $code = $LASTEXITCODE
    } finally {
        Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
        try { [Console]::OutputEncoding = $encoding } catch {}
    }
    return @{ Code = $code; Output = $output }
}

function Move-WithRetry([string]$from, [string]$to) {
    for ($attempt = 1; ; $attempt++) {
        try {
            Move-Item -LiteralPath $from -Destination $to -ErrorAction Stop
            return
        } catch {
            if ($attempt -ge 10) { throw }
            Start-Sleep -Milliseconds 1000
        }
    }
}

function Set-ClientFiles($pairs) {
    $done = @()
    try {
        foreach ($pair in $pairs) {
            $old = $pair.Target + '.ymdmod-old'
            Remove-Item -LiteralPath $old -Force -ErrorAction SilentlyContinue
            Move-WithRetry $pair.Target $old
            $done += $pair
            Move-WithRetry $pair.Source $pair.Target
        }
    } catch {
        Say 'swapFailed' $_.Exception.Message
        foreach ($pair in $done) {
            $old = $pair.Target + '.ymdmod-old'
            if (Test-Path -LiteralPath $pair.Target) { Move-Item -LiteralPath $pair.Target -Destination $pair.Source -Force }
            Move-Item -LiteralPath $old -Destination $pair.Target -Force
        }
        return $false
    }
    foreach ($pair in $pairs) { Remove-Item -LiteralPath ($pair.Target + '.ymdmod-old') -Force -ErrorAction SilentlyContinue }
    return $true
}
