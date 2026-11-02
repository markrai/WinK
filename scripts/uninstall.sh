#!/usr/bin/env bash
# Disable and remove WinK. Does not auto-restore shortcut backups.
set -euo pipefail

SCRIPT_ID="wink"
BACKUP_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/wink/backups"

if command -v kwriteconfig6 >/dev/null 2>&1; then
    kwriteconfig6 --file kwinrc --group Plugins --key "${SCRIPT_ID}Enabled" false
fi

if command -v kpackagetool6 >/dev/null 2>&1; then
    kpackagetool6 --type=KWin/Script --remove "${SCRIPT_ID}" 2>/dev/null || \
        kpackagetool6 --type=KWin/Script -r "${SCRIPT_ID}" 2>/dev/null || true
fi

if command -v qdbus >/dev/null 2>&1; then
    qdbus org.kde.KWin /KWin reconfigure >/dev/null 2>&1 || true
elif command -v qdbus6 >/dev/null 2>&1; then
    qdbus6 org.kde.KWin /KWin reconfigure >/dev/null 2>&1 || true
fi

echo "WinK removed."
echo "To restore prior shortcuts, copy a backup from:"
echo "  ${BACKUP_DIR}/"
echo "Then: qdbus org.kde.KWin /KWin reconfigure"
