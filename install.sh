#!/usr/bin/env bash
# Thruster Local Extension Installer / Linker for macOS & Linux

set -e

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR_NAME="the-biking.thruster-0.2.0-universal"

TARGET_DIRS=(
    "$HOME/.antigravity-ide/extensions"
    "$HOME/.antigravity/extensions"
    "$HOME/.vscode/extensions"
)

echo "=========================================="
echo " Installing Thruster Extension (v0.2.0)"
echo "=========================================="

for base in "${TARGET_DIRS[@]}"; do
    if [ -d "$base" ]; then
        target="$base/$EXT_DIR_NAME"
        echo " Updating: $target"
        rm -rf "$target"
        mkdir -p "$target"
        cp "$SOURCE_DIR/package.json" "$target/"
        cp "$SOURCE_DIR/extension.js" "$target/"
        cp "$SOURCE_DIR/README.md" "$target/"
        cp "$SOURCE_DIR/Thruster.png" "$target/"
        cp "$SOURCE_DIR/LICENSE" "$target/"
        if [ -d "$SOURCE_DIR/scripts" ]; then
            cp -r "$SOURCE_DIR/scripts" "$target/"
        fi
        echo " [COPIED] $target"
    fi
done

echo ""
echo "Thruster is installed!"
echo "1. In Antigravity IDE, press Cmd + Shift + P -> 'Developer: Reload Window'"
echo "2. In Extensions View (Cmd + Shift + X), search for 'Thruster' to manage."
