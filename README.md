# WinK

**Windows-style sequential Meta+Arrow window snapping for KDE Plasma 6.**

Plasma’s stock shortcuts treat each Meta+Arrow press as a single absolute action. On many Fedora installs, `Meta+Up` is just **Maximize**. WinK turns the arrows into a **key chain**, matching Windows 11:

| Sequence | Result |
| --- | --- |
| `Meta+Up` | Maximize |
| `Meta+Up` again | Top half |
| `Meta+Right` → `Meta+Up` | Right half → **top-right quadrant** |
| `Meta+Left` → `Meta+Up` / `Down` | Top-left / bottom-left |
| `Meta+Down` | Restore (from max/top) or minimize (from floating) |
| `Meta+Left` / `Right` repeatedly | Cycle **left ↔ right ↔ restored** (continues across monitors when enabled) |

Works on Plasma 6 / KWin 6 (including Fedora Plasma 6.8.x).

## Install

### From this repository

```bash
git clone https://github.com/markrai/WinK.git
cd WinK
make install
```

Requires `kpackagetool6` and `kwriteconfig6` (Plasma 6).

### One-file installer

```bash
bash install-wink.sh
```

### What install does

1. Installs the KWin script package (`wink`)
2. Enables it in `~/.config/kwinrc`
3. Backs up and updates `~/.config/kglobalshortcutsrc`:
   - **Maximize** → `Meta+PgUp`
   - **Minimize** → `Meta+PgDown`
   - Clears conflicting Quick Tile Meta+Arrow bindings
   - Binds **WinK** to `Meta+Up/Down/Left/Right`
4. Reconfigures KWin

Backups: `~/.local/state/wink/backups/`

Config only (script already installed):

```bash
make apply-config
```

## Uninstall

```bash
make uninstall
```

Restore a shortcut backup from `~/.local/state/wink/backups/` if you want stock Meta+Arrow behavior back.

## Configure

**System Settings → Window Management → KWin Scripts → WinK → Configure**

- Maximized + Meta+Up → top half (default: on)
- Continue Meta+Left/Right cycle onto adjacent screens (default: on)

## Package for “Install from File…”

```bash
make package
```

Install `wink.kwinscript` via **KWin Scripts → Install from File…**, then run `make apply-config` so Meta+Arrow ownership is correct.

## Development

```bash
make test            # every region × arrow in tests/permutations.mjs, run against main.js
make test-provenance
make test-branding
make live            # same matrix on a real Dolphin window (needs a Plasma session)
make standalone      # regenerate install-wink.sh
```

Debug script output:

```bash
journalctl -f QT_CATEGORY=js QT_CATEGORY=kwin_scripting
```

## Layout

```
WinK/                       # this repository
  wink/                     # KWin script package (plugin Id: wink)
    metadata.json
    contents/code/main.js
  scripts/install.sh
  scripts/apply-plasma-config.sh
  scripts/uninstall.sh
  scripts/build-standalone.py
  tests/
  install-wink.sh           # standalone (no clone needed)
```

## License

MIT — see [LICENSE](LICENSE).

## Support

[Buy me a coffee](https://buymeacoffee.com/markrai)
