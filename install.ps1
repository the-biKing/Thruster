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
$extDirName = "antigravity.thruster-0.1.0"

$targetPaths = @(
    "$env:USERPROFILE\.antigravity-ide\extensions\$extDirName",
    "$env:USERPROFILE\.antigravity\extensions\$extDirName",
    "$env:USERPROFILE\.vscode\extensions\$extDirName"
)

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Installing Thruster Extension (v0.1.0)" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

foreach ($target in $targetPaths) {
    $parent = Split-Path $target -Parent
    if (Test-Path $parent) {
        if (Test-Path $target) {
            Remove-Item -Recurse -Force $target -ErrorAction SilentlyContinue
        }

        if ($CopyOnly) {
            New-Item -ItemType Directory -Path $target -Force | Out-Null
            Copy-Item -Path "$sourceDir\package.json", "$sourceDir\extension.js", "$sourceDir\README.md" -Destination $target -Force
            Write-Host " [COPIED] $target" -ForegroundColor Green
        } else {
            try {
                New-Item -ItemType Junction -Path $target -Target $sourceDir -Force | Out-Null
                Write-Host " [LINKED (Live Junction)] $target -> $sourceDir" -ForegroundColor Green
            } catch {
                # Fallback to copy if junction fails
                New-Item -ItemType Directory -Path $target -Force | Out-Null
                Copy-Item -Path "$sourceDir\package.json", "$sourceDir\extension.js", "$sourceDir\README.md" -Destination $target -Force
                Write-Host " [COPIED (Fallback)] $target" -ForegroundColor Yellow
            }
        }
    }
}

Write-Host "`nThruster is installed!" -ForegroundColor Cyan
Write-Host "1. In Antigravity IDE, press: Ctrl + Shift + P -> 'Developer: Reload Window'" -ForegroundColor Yellow
Write-Host "2. In Extensions View (Ctrl + Shift + X), search for 'Thruster' to Disable/Enable at any time." -ForegroundColor Yellow
