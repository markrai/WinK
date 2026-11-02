# Contributing

## Development

- KWin package sources live in `wink/`
- After changing `main.js` or metadata, run `make standalone` so `install-wink.sh` stays in sync
- Run `make test`, `make test-provenance`, and `make test-branding` before opening a PR

## Testing on Plasma

1. `make install` on a Plasma 6 session
2. Confirm shortcuts under **System Settings → Shortcuts → WinK**
3. Exercise the chains in the README table
4. Check `journalctl -f QT_CATEGORY=js QT_CATEGORY=kwin_scripting` if something misbehaves

## Scope

Keep this focused on Windows-style Meta+Arrow chaining. Fancy zone editors and full tiling WMs belong in other projects.
