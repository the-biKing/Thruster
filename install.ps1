<#
.SYNOPSIS
    Installs / Links Thruster into Antigravity IDE and VS Code extension directories.
.DESCRIPTION
    Creates a Directory Junction linking the live development directory directly into
    Antigravity's extension folder so that updates in G:\code\Thruster take effect immediately.
#>

[CmdletBinding()]
param(
    [switch]$CopyOnly # Set to copy files instead of creating a live junction link
)

$sourceDir = $PSScriptRoot
$extDirName = "the-biking.thruster-0.2.0-universal"

$baseExtDirs = @(
    "$env:USERPROFILE\.antigravity-ide\extensions",
    "$env:USERPROFILE\.antigravity\extensions",
    "$env:USERPROFILE\.vscode\extensions"
)

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Installing Thruster Extension (v0.2.0)" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

foreach ($base in $baseExtDirs) {
    if (Test-Path $base) {
        # Check for any existing thruster extension installs and update them
        $existing = Get-ChildItem -Path $base -Directory -Filter "*thruster*" -ErrorAction SilentlyContinue
        $targets = @()
        if ($existing) {
            foreach ($item in $existing) {
                $targets += $item.FullName
            }
        }
        $defaultTarget = Join-Path $base $extDirName
        if ($targets -notcontains $defaultTarget) {
            $targets += $defaultTarget
        }

        foreach ($target in $targets) {
            Write-Host " Updating: $target" -ForegroundColor Cyan
            if (Test-Path $target) {
                # If it's a junction/symlink or directory, remove and recreate
                try {
                    cmd /c rmdir "$target" 2>$null
                } catch {}
                if (Test-Path $target) {
                    Remove-Item -Recurse -Force $target -ErrorAction SilentlyContinue
                }
            }

            if ($CopyOnly) {
                New-Item -ItemType Directory -Path $target -Force | Out-Null
                Copy-Item -Path "$sourceDir\package.json", "$sourceDir\extension.js", "$sourceDir\README.md", "$sourceDir\Thruster.png", "$sourceDir\LICENSE" -Destination $target -Force
                Write-Host " [COPIED] $target" -ForegroundColor Green
            } else {
                try {
                    New-Item -ItemType Junction -Path $target -Target $sourceDir -Force | Out-Null
                    Write-Host " [LINKED (Live Junction)] $target -> $sourceDir" -ForegroundColor Green
                } catch {
                    New-Item -ItemType Directory -Path $target -Force | Out-Null
                    Copy-Item -Path "$sourceDir\package.json", "$sourceDir\extension.js", "$sourceDir\README.md", "$sourceDir\Thruster.png", "$sourceDir\LICENSE" -Destination $target -Force
                    Write-Host " [COPIED (Fallback)] $target" -ForegroundColor Yellow
                }
            }
        }
    }
}

Write-Host "`nThruster is installed!" -ForegroundColor Cyan
Write-Host "1. In Antigravity IDE, press: Ctrl + Shift + P -> 'Developer: Reload Window'" -ForegroundColor Yellow
Write-Host "2. In Extensions View (Ctrl + Shift + X), search for 'Thruster' to Disable/Enable at any time." -ForegroundColor Yellow
