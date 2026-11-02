#!/usr/bin/env bash
# Rewire ~/.config/kwinrc + ~/.config/kglobalshortcutsrc for WinK.
# Targets Plasma 6 (incl. Fedora 6.8.x) where Meta+Up is often Maximize.
set -euo pipefail

SCRIPT_ID="wink"
PREFIX="WinK"
BACKUP_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/wink/backups"
STAMP="$(date +%Y%m%d-%H%M%S)"

need_cmd() {
    command -v "$1" >/dev/null 2>&1 || {
        echo "error: missing required command: $1" >&2
        exit 1
    }
}

need_cmd kwriteconfig6

mkdir -p "${BACKUP_DIR}"

backup_file() {
    local src="$1"
    if [[ -f "${src}" ]]; then
        cp -a "${src}" "${BACKUP_DIR}/$(basename "${src}").${STAMP}"
        echo "Backed up ${src} → ${BACKUP_DIR}/$(basename "${src}").${STAMP}"
    fi
}

backup_file "${XDG_CONFIG_HOME:-$HOME/.config}/kwinrc"
backup_file "${XDG_CONFIG_HOME:-$HOME/.config}/kglobalshortcutsrc"

kw() {
    kwriteconfig6 "$@"
}

echo "Enabling KWin script plugin: ${SCRIPT_ID}"
kw --file kwinrc --group Plugins --key "${SCRIPT_ID}Enabled" true

# KZones registers Meta+Arrow by default (Shortcuts.qml) and snaps into its
# zone layout (often 25/50/25) — that fights WinK and looks like
# left/center/right moves instead of maximize/quadrants. Disable it while
# WinK owns Meta+Arrow.
if [[ "$(kreadconfig6 --file kwinrc --group Plugins --key kzonesEnabled 2>/dev/null || true)" == "true" ]]; then
    echo "Disabling KZones (conflicts with Meta+Arrow WinK)…"
fi
kw --file kwinrc --group Plugins --key "kzonesEnabled" false

echo "Freeing Meta+Arrow from every non-${PREFIX} action…"

# Move Maximize / Minimize off Meta+Up/Down (common on Fedora Plasma).
# Use primary only (no alternate) so one keypress cannot double-fire.
kw --file kglobalshortcutsrc --group kwin --key "Window Maximize" \
    "Meta+PgUp,none,Maximize Window" --notify || true
kw --file kglobalshortcutsrc --group kwin --key "Window Minimize" \
    "Meta+PgDown,none,Minimize Window" --notify || true

clear_kwin_action() {
    local key="$1"
    local label="${2:-$1}"
    kw --file kglobalshortcutsrc --group kwin --key "${key}" \
        "none,none,${label}" --notify 2>/dev/null || true
}

clear_kwin_action "Window Quick Tile Top" "Quick Tile Window to the Top"
clear_kwin_action "Window Quick Tile Bottom" "Quick Tile Window to the Bottom"
clear_kwin_action "Window Quick Tile Left" "Quick Tile Window to the Left"
clear_kwin_action "Window Quick Tile Right" "Quick Tile Window to the Right"
clear_kwin_action "Window Quick Tile Top Left" "Quick Tile Window to the Top Left"
clear_kwin_action "Window Quick Tile Top Right" "Quick Tile Window to the Top Right"
clear_kwin_action "Window Quick Tile Bottom Left" "Quick Tile Window to the Bottom Left"
clear_kwin_action "Window Quick Tile Bottom Right" "Quick Tile Window to the Bottom Right"
clear_kwin_action "Quick Tile Window to the Top" "Quick Tile Window to the Top"
clear_kwin_action "Quick Tile Window to the Bottom" "Quick Tile Window to the Bottom"
clear_kwin_action "Quick Tile Window to the Left" "Quick Tile Window to the Left"
clear_kwin_action "Quick Tile Window to the Right" "Quick Tile Window to the Right"
clear_kwin_action "Quick Tile Window to the Top Left" "Quick Tile Window to the Top Left"
clear_kwin_action "Quick Tile Window to the Top Right" "Quick Tile Window to the Top Right"
clear_kwin_action "Quick Tile Window to the Bottom Left" "Quick Tile Window to the Bottom Left"
clear_kwin_action "Quick Tile Window to the Bottom Right" "Quick Tile Window to the Bottom Right"
clear_kwin_action "Window Custom Quick Tile Top" "Custom Quick Tile Window to the Top"
clear_kwin_action "Window Custom Quick Tile Bottom" "Custom Quick Tile Window to the Bottom"
clear_kwin_action "Window Custom Quick Tile Left" "Custom Quick Tile Window to the Left"
clear_kwin_action "Window Custom Quick Tile Right" "Custom Quick Tile Window to the Right"
clear_kwin_action "Window Maximize Horizontal" "Maximize Window Horizontally"
clear_kwin_action "Window Maximize Vertical" "Maximize Window Vertically"

# KZones often owns Meta+Arrow as well — free those so WinK receives them.
clear_kwin_action "KZones: Move active window up" "KZones: Move active window up"
clear_kwin_action "KZones: Move active window down" "KZones: Move active window down"
clear_kwin_action "KZones: Move active window left" "KZones: Move active window left"
clear_kwin_action "KZones: Move active window right" "KZones: Move active window right"

# Sweep: strip Meta+Arrow from any other [kwin] entry (unknown plugins, leftovers).
sweep_foreign_meta_arrows() {
    local conf="${XDG_CONFIG_HOME:-$HOME/.config}/kglobalshortcutsrc"
    [[ -f "${conf}" ]] || return 0
    python3 - "${conf}" "${PREFIX}" <<'PY'
import sys
path, prefix = sys.argv[1], sys.argv[2]
arrows = {"Meta+Up", "Meta+Down", "Meta+Left", "Meta+Right"}
section = None
out_lines = []
cleared = []

def scrub(field: str) -> str:
    toks = [t.strip() for t in field.replace(";", ",").split(",") if t.strip() and t.strip() != "none"]
    kept = [t for t in toks if t not in arrows]
    return kept[0] if len(kept) == 1 else (";".join(kept) if kept else "none")

with open(path, encoding="utf-8", errors="replace") as fh:
    for line in fh.read().splitlines():
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1]
            out_lines.append(line)
            continue
        if section == "kwin" and "=" in line and not line.strip().startswith("#"):
            name, val = line.split("=", 1)
            # Only rewrite real shortcut entries that currently claim Meta+Arrow.
            if (
                not name.startswith(prefix + ":")
                and name != "_k_friendly_name"
                and any(a in val for a in arrows)
            ):
                parts = val.split(",")
                while len(parts) < 3:
                    parts.append("")
                prim, alt, label = parts[0], parts[1], ",".join(parts[2:]) or name
                new_prim, new_alt = scrub(prim), scrub(alt)
                if (new_prim, new_alt) != (prim, alt):
                    cleared.append(name)
                    line = f"{name}={new_prim},{new_alt},{label}"
            out_lines.append(line)
            continue
        out_lines.append(line)

with open(path, "w", encoding="utf-8") as fh:
    fh.write("\n".join(out_lines) + "\n")

if cleared:
    print("Cleared Meta+Arrow from:")
    for name in cleared:
        print(f"  - {name}")
else:
    print(f"Meta+Arrow exclusive to {prefix}.")
PY
}

# Assign exclusive ownership: primary only, alternate empty (avoids double-fire).
echo "Assigning ${PREFIX} → Meta+Arrow (exclusive)…"
kw --file kglobalshortcutsrc --group kwin --key "${PREFIX}: Up" \
    "Meta+Up,none,${PREFIX}: Up" --notify || true
kw --file kglobalshortcutsrc --group kwin --key "${PREFIX}: Down" \
    "Meta+Down,none,${PREFIX}: Down" --notify || true
kw --file kglobalshortcutsrc --group kwin --key "${PREFIX}: Left" \
    "Meta+Left,none,${PREFIX}: Left" --notify || true
kw --file kglobalshortcutsrc --group kwin --key "${PREFIX}: Right" \
    "Meta+Right,none,${PREFIX}: Right" --notify || true

sweep_foreign_meta_arrows

# Re-assert after sweep.
kw --file kglobalshortcutsrc --group kwin --key "${PREFIX}: Up" \
    "Meta+Up,none,${PREFIX}: Up" --notify || true
kw --file kglobalshortcutsrc --group kwin --key "${PREFIX}: Down" \
    "Meta+Down,none,${PREFIX}: Down" --notify || true
kw --file kglobalshortcutsrc --group kwin --key "${PREFIX}: Left" \
    "Meta+Left,none,${PREFIX}: Left" --notify || true
kw --file kglobalshortcutsrc --group kwin --key "${PREFIX}: Right" \
    "Meta+Right,none,${PREFIX}: Right" --notify || true

# Force-load the script JS. After upgrades, KWin can keep dead ScriptN objects
# whose registerShortcut callbacks no longer run while Settings still shows binds.
restart_script() {
    local dbus_cmd=""
    if command -v qdbus >/dev/null 2>&1; then
        dbus_cmd=qdbus
    elif command -v qdbus6 >/dev/null 2>&1; then
        dbus_cmd=qdbus6
    else
        return 0
    fi

    local script_js="${XDG_DATA_HOME:-$HOME/.local/share}/kwin/scripts/${SCRIPT_ID}/contents/code/main.js"
    local i id
    for i in 0 1 2 3 4 5 6 7 8 9; do
        "${dbus_cmd}" org.kde.KWin "/Scripting/Script${i}" org.kde.kwin.Script.stop >/dev/null 2>&1 || true
    done
    "${dbus_cmd}" org.kde.KWin /Scripting org.kde.kwin.Scripting.unloadScript "${SCRIPT_ID}" >/dev/null 2>&1 || true

    # Start other enabled scripts WITHOUT loading us first. Loading via both
    # Scripting.start and loadScript registers Meta+Arrow handlers twice, so one
    # keypress advances the state machine two steps (breaks quadrant cycling).
    kw --file kwinrc --group Plugins --key "${SCRIPT_ID}Enabled" false
    "${dbus_cmd}" org.kde.KWin /KWin reconfigure >/dev/null 2>&1 || true
    "${dbus_cmd}" org.kde.KWin /Scripting org.kde.kwin.Scripting.start >/dev/null 2>&1 || true

    kw --file kwinrc --group Plugins --key "${SCRIPT_ID}Enabled" true
    "${dbus_cmd}" org.kde.KWin /KWin reconfigure >/dev/null 2>&1 || true
    "${dbus_cmd}" org.kde.KWin /Scripting org.kde.kwin.Scripting.unloadScript "${SCRIPT_ID}" >/dev/null 2>&1 || true
    if [[ -f "${script_js}" ]]; then
        id="$("${dbus_cmd}" org.kde.KWin /Scripting org.kde.kwin.Scripting.loadScript "${script_js}" "${SCRIPT_ID}" 2>/dev/null || true)"
        if [[ -n "${id}" && "${id}" != "-1" ]]; then
            "${dbus_cmd}" org.kde.KWin "/Scripting/Script${id}" org.kde.kwin.Script.run >/dev/null 2>&1 || true
        fi
    fi
}

reconfigure_kwin() {
    restart_script
    if command -v systemctl >/dev/null 2>&1; then
        systemctl --user try-reload-or-restart plasma-kglobalaccel.service >/dev/null 2>&1 || true
    fi
}

reconfigure_kwin

# KZones / Quick Tile may re-claim Meta+Arrow when scripts start — strip again
# and re-assert exclusive ownership last.
clear_kwin_action "KZones: Move active window up" "KZones: Move active window up"
clear_kwin_action "KZones: Move active window down" "KZones: Move active window down"
clear_kwin_action "KZones: Move active window left" "KZones: Move active window left"
clear_kwin_action "KZones: Move active window right" "KZones: Move active window right"
clear_kwin_action "Window Quick Tile Top" "Quick Tile Window to the Top"
clear_kwin_action "Window Quick Tile Bottom" "Quick Tile Window to the Bottom"
clear_kwin_action "Window Quick Tile Left" "Quick Tile Window to the Left"
clear_kwin_action "Window Quick Tile Right" "Quick Tile Window to the Right"
sweep_foreign_meta_arrows
kw --file kglobalshortcutsrc --group kwin --key "${PREFIX}: Up" \
    "Meta+Up,none,${PREFIX}: Up" --notify || true
kw --file kglobalshortcutsrc --group kwin --key "${PREFIX}: Down" \
    "Meta+Down,none,${PREFIX}: Down" --notify || true
kw --file kglobalshortcutsrc --group kwin --key "${PREFIX}: Left" \
    "Meta+Left,none,${PREFIX}: Left" --notify || true
kw --file kglobalshortcutsrc --group kwin --key "${PREFIX}: Right" \
    "Meta+Right,none,${PREFIX}: Right" --notify || true

echo
echo "Plasma config applied."
echo "  Maximize   → Meta+PgUp"
echo "  Minimize   → Meta+PgDown"
echo "  Snap chain → Meta+Up / Down / Left / Right  (${PREFIX})"
echo "  KZones     → disabled (Meta+Arrow conflict)"
echo "Backups: ${BACKUP_DIR}"
echo
echo "Sanity check: System Settings → Shortcuts → search '${PREFIX}'"
