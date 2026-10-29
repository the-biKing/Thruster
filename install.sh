#!/usr/bin/env bash
# Thruster Local Extension Installer / Linker for macOS & Linux

set -e

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION=$(grep '"version"' "$SOURCE_DIR/package.json" | head -n 1 | awk -F '"' '{print $4}')
if [ -z "$VERSION" ]; then
    VERSION="1.0.0"
fi
EXT_DIR_NAME="the-biking.thruster-${VERSION}-universal"

TARGET_DIRS=(
    "$HOME/.antigravity-ide/extensions"
    "$HOME/.antigravity/extensions"
    "$HOME/.vscode/extensions"
)

echo "=========================================="
echo " Installing Thruster Extension (v${VERSION})"
echo "=========================================="

for base in "${TARGET_DIRS[@]}"; do
    if [ -d "$base" ]; then
        # Remove any older version folders
        rm -rf "$base"/the-biking.thruster-*-universal
        target="$base/$EXT_DIR_NAME"
        echo " Updating: $target"
        mkdir -p "$target"
        cp "$SOURCE_DIR/package.json" "$target/"
        cp "$SOURCE_DIR/extension.js" "$target/"
        cp "$SOURCE_DIR/README.md" "$target/"
        cp "$SOURCE_DIR/Thruster.png" "$target/"
        cp "$SOURCE_DIR/LICENSE" "$target/"
        if [ -d "$SOURCE_DIR/scripts" ]; then
            cp -r "$SOURCE_DIR/scripts" "$target/"
        fi
        if [ -d "$SOURCE_DIR/templates" ]; then
            cp -r "$SOURCE_DIR/templates" "$target/"
        fi
        echo " [COPIED] $target"
    fi
done

echo ""
echo "Thruster is installed!"
echo "1. In Antigravity IDE, press Cmd + Shift + P -> 'Developer: Reload Window'"
echo "2. In Extensions View (Cmd + Shift + X), search for 'Thruster' to manage."
