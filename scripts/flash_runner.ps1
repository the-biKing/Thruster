# Thruster Flashing Runner (PowerShell for Windows)
# Provides a clean, single-line in-place progress bar, formatted memory statistics,
# and automated log retention management (.thruster\logs and .thruster\crashes).

param(
    [Parameter(Mandatory=$true)]
    [string]$JobFile
)

if (-not (Test-Path $JobFile)) {
    Write-Error "Job file not found: $JobFile"
    exit 1
}

$job = Get-Content -Path $JobFile -Raw -Encoding UTF8 | ConvertFrom-Json

$cliPath = if ($job.cliPath) { $job.cliPath } else { "arduino-cli" }
$port = $job.port
$fqbn = $job.fqbn
$sketchDir = $job.sketchDir
$workspaceDir = if ($job.workspaceDir) { $job.workspaceDir } else { $sketchDir }
$lockFile = $job.lockFile
$statusFile = $job.statusFile
$maxLogs = if ($job.maxLogs) { [int]$job.maxLogs } else { 10 }
$maxCrashLogs = if ($job.maxCrashLogs) { [int]$job.maxCrashLogs } else { 10 }
$memory = $job.memory
$doMonitor = [bool]$job.monitor
$baud = if ($job.baud) { $job.baud } else { 115200 }

function Format-Bytes([long]$n) {
    if ($null -eq $n) { return "N/A" }
    return "{0:N0} bytes" -f $n
}

# 1. Print Header
Write-Host "=== Thruster: Flashing (Uploading) to $port... ===" -ForegroundColor Cyan

# 2. Render Memory Usage
if ($memory) {
    Write-Host "📊 Memory Usage:" -ForegroundColor Blue
    if ($memory.flash) {
        $used = Format-Bytes $memory.flash.used
        $total = Format-Bytes $memory.flash.max
        $pct = $memory.flash.percent
        $free = Format-Bytes $memory.flash.free
        Write-Host "   • Program Storage (Flash): $used / $total ($pct%) [$free free]" -ForegroundColor DarkCyan
    }
    if ($memory.ram) {
        $used = Format-Bytes $memory.ram.used
        $total = Format-Bytes $memory.ram.max
        $pct = $memory.ram.percent
        $free = Format-Bytes $memory.ram.free
        Write-Host "   • Dynamic Memory (RAM):    $used / $total ($pct%) [$free free]" -ForegroundColor DarkCyan
    }
    Write-Host ""
}

function Render-ProgressBar([int]$pct, [double]$elapsedSec, [string]$status = "") {
    $pct = [Math]::Max(0, [Math]::Min(100, $pct))
    $width = 32
    $filled = [int]($width * $pct / 100)
    $bar = ""
    if ($filled -gt 0) {
        $bar = ("=" * ($filled - 1)) + $(if ($filled -lt $width) { ">" } else { "=" })
    }
    $bar = $bar.PadRight($width, ' ')
    $elapsedStr = "{0:N1}s" -f $elapsedSec
    $statusStr = if ($status) { " $status" } else { "" }

    $msg = "`r`e[KFlashing [$bar] {0,3}% ({1}){2}" -f $pct, $elapsedStr, $statusStr
    [Console]::Write($msg)
}

function Ensure-GitIgnore($wsDir) {
    if (-not $wsDir) { return }
    $gitDir = Join-Path $wsDir ".git"
    if (-not (Test-Path $gitDir)) { return }

    $gitignorePath = Join-Path $wsDir ".gitignore"
    $existing = ""
    if (Test-Path $gitignorePath) {
        try { $existing = Get-Content -Path $gitignorePath -Raw -ErrorAction SilentlyContinue } catch { }
    }
    if ($null -eq $existing) { $existing = "" }

    $lines = $existing -split "`r?`n" | ForEach-Object { $_.Trim() }
    if ($lines -contains ".thruster" -or $lines -contains ".thruster/") { return }

    $entriesToAdd = @()
    if (-not ($lines -contains ".thruster/logs" -or $lines -contains ".thruster/logs/")) {
        $entriesToAdd += ".thruster/logs/"
    }
    if (-not ($lines -contains ".thruster/crashes" -or $lines -contains ".thruster/crashes/")) {
        $entriesToAdd += ".thruster/crashes/"
    }

    if ($entriesToAdd.Count -gt 0) {
        $toAppend = ""
        if ($existing.Length -gt 0 -and -not $existing.EndsWith("`n") -and -not $existing.EndsWith("`r`n")) {
            $toAppend += "`n"
        }
        $toAppend += "# Thruster logs`n" + ($entriesToAdd -join "`n") + "`n"
        Add-Content -Path $gitignorePath -Value $toAppend -NoNewline -Encoding UTF8
    }
}

function Prune-Logs([string]$dir, [int]$maxCount) {
    if (-not (Test-Path $dir)) { return }
    $files = Get-ChildItem -Path $dir -Filter "*.log" | Sort-Object LastWriteTime -Descending
    if ($files.Count -gt $maxCount) {
        $files | Select-Object -Skip $maxCount | ForEach-Object {
            Remove-Item -Path $_.FullName -Force -ErrorAction SilentlyContinue
        }
    }
}

$startTime = [DateTime]::UtcNow
$allOutput = [System.Collections.Generic.List[string]]::new()
$currentPct = 0
Render-ProgressBar 0 0 "Connecting..."

$pctRegex1 = [regex]"Writing at 0x[0-9a-fA-F]+\.\.\.\s*\(([0-9]+)\s*%\)"
$pctRegex2 = [regex]"([0-9]{1,3})%"

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $cliPath
$psi.Arguments = "upload -p `"$port`" --fqbn $fqbn `"$sketchDir`""
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true

$proc = [System.Diagnostics.Process]::Start($psi)

$readAction = {
    param($stream)
    while (-not $stream.EndOfStream) {
        $ch = [char]$stream.Read()
        if ($ch -eq "`r" -or $ch -eq "`n") {
            # Completed token
        }
    }
}

# Read output line by line / token
while (-not $proc.HasExited -or -not $proc.StandardOutput.EndOfStream) {
    $line = $proc.StandardOutput.ReadLine()
    if ($null -ne $line) {
        $cleaned = $line.Trim()
        if ($cleaned) {
            $allOutput.Add($cleaned)
            $elapsed = ([DateTime]::UtcNow - $startTime).TotalSeconds

            $foundPct = $null
            $m = $pctRegex1.Match($cleaned)
            if ($m.Success) {
                $foundPct = [int]$m.Groups[1].Value
            } else {
                $m2 = $pctRegex2.Match($cleaned)
                if ($m2.Success) {
                    $foundPct = [int]$m2.Groups[1].Value
                }
            }

            if ($null -ne $foundPct) {
                $currentPct = [Math]::Max($currentPct, $foundPct)
                Render-ProgressBar $currentPct $elapsed
            } else {
                $low = $cleaned.ToLower()
                $hint = ""
                if ($low.Contains("connecting")) { $hint = "Connecting..." }
                elseif ($low.Contains("chip is")) { $hint = $cleaned }
                elseif ($low.Contains("erasing")) { $hint = "Erasing flash..." }
                elseif ($low.Contains("compressed")) { $hint = "Compressing..." }
                elseif ($low.Contains("verifying")) { $hint = "Verifying..." }
                if ($hint) {
                    Render-ProgressBar $currentPct $elapsed $hint
                }
            }
        }
    } else {
        Start-Sleep -Milliseconds 20
    }
}

$proc.WaitForExit()
$exitCode = $proc.ExitCode
$totalTime = ([DateTime]::UtcNow - $startTime).TotalSeconds

# Setup .thruster folders
$thrusterDir = Join-Path $workspaceDir ".thruster"
$logsDir = Join-Path $thrusterDir "logs"
$crashesDir = Join-Path $thrusterDir "crashes"

if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir -Force | Out-Null }
if (-not (Test-Path $crashesDir)) { New-Item -ItemType Directory -Path $crashesDir -Force | Out-Null }

Ensure-GitIgnore $workspaceDir

$timestamp = (Get-Date).ToString("yyyy-MM-dd_HH-mm-ss")
$fullOutputText = $allOutput -join "`n"

if ($exitCode -eq 0) {
    Render-ProgressBar 100 $totalTime "Done!"
    [Console]::WriteLine("")
    Write-Host ("✔ Flash Succeeded! (Total time: {0:N2}s)" -f $totalTime) -ForegroundColor Green

    $logFilename = "flash_$timestamp.log"
    $logPath = Join-Path $logsDir $logFilename
    $relLogPath = Join-Path ".thruster" (Join-Path "logs" $logFilename)

    $logContent = @"
======================================================================
Thruster Flash Log: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Target Board: $fqbn
Serial Port:  $port
Result:       SUCCESS (Exit Code: 0)
Duration:     {0:N2}s
======================================================================
Detailed Command Output:
$fullOutputText
"@ -f $totalTime

    Set-Content -Path $logPath -Value $logContent -Encoding UTF8
    Prune-Logs $logsDir $maxLogs
    Write-Host "📁 Detailed log saved to: $relLogPath" -ForegroundColor DarkCyan

    if ($statusFile) {
        Set-Content -Path $statusFile -Value "0" -Encoding UTF8 -Force
    }
} else {
    [Console]::WriteLine("")
    Write-Host "❌ Flash Failed! (Exit code: $exitCode)" -ForegroundColor Red

    $crashFilename = "crash_$timestamp.log"
    $crashPath = Join-Path $crashesDir $crashFilename
    $relCrashPath = Join-Path ".thruster" (Join-Path "crashes" $crashFilename)

    $crashContent = @"
======================================================================
Thruster Flash Crash Log: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Target Board: $fqbn
Serial Port:  $port
Result:       FAILED (Exit Code: $exitCode)
Duration:     {0:N2}s
======================================================================
Detailed Command Output:
$fullOutputText
"@ -f $totalTime

    Set-Content -Path $crashPath -Value $crashContent -Encoding UTF8
    Prune-Logs $crashesDir $maxCrashLogs
    Write-Host "📁 Crash log saved to: $relCrashPath" -ForegroundColor Red

    if ($statusFile) {
        Set-Content -Path $statusFile -Value "1" -Encoding UTF8 -Force
    }
}

# Release Lock and clean job file
if ($lockFile -and (Test-Path $lockFile)) {
    Remove-Item -Path $lockFile -Force -ErrorAction SilentlyContinue
}
if (Test-Path $JobFile) {
    Remove-Item -Path $JobFile -Force -ErrorAction SilentlyContinue
}

# Launch Monitor if requested and successful
if ($exitCode -eq 0 -and $doMonitor) {
    Write-Host "`n=== Thruster Serial Monitor ($port @ $baud bps) - Press Ctrl+C to exit ===" -ForegroundColor Green
    & $cliPath monitor -p $port -c "baudrate=$baud"
}
