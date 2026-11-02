#!/usr/bin/env bash
# Install WinK (KWin script) and rewire Plasma 6 shortcuts.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG="${ROOT}/wink"
SCRIPT_ID="wink"

if ! command -v kpackagetool6 >/dev/null 2>&1; then
    echo "error: kpackagetool6 not found. Install plasma-workspace / kwin (Plasma 6)." >&2
    exit 1
fi

if kpackagetool6 --type=KWin/Script --list 2>/dev/null | grep -q "${SCRIPT_ID}"; then
    echo "Updating existing WinK…"
    kpackagetool6 --type=KWin/Script --upgrade "${PKG}"
else
    echo "Installing WinK…"
    kpackagetool6 --type=KWin/Script --install "${PKG}"
fi

"${ROOT}/scripts/apply-plasma-config.sh"

echo
echo "Installed: WinK"
echo "Try: Meta+Up (maximize) → Meta+Up again (top half)"
echo "     Meta+Right → Meta+Up (top-right quadrant)"
