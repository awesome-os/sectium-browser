# Sectium Browser

> **The Sovereign BSD-3 Browser & Compositor Shell of AwesomeOS (`~110 MB` RAM live) — featuring `< 5 ms` AtlasKV local search, Chrome-nudge-free web search, built-in Sectium IDE DevTools, and zero-duplication `Holo v11` CAS (`SHA-512 + Ed25519`) hydration.**

---

## Quick Install

### Windows (PowerShell)
```powershell
irm https://github.com/awesome-os/sectium-browser/releases/latest/download/install.ps1 | iex
```
Installs `sectium-browser.exe` into `%LOCALAPPDATA%\AwesomeOS\SectiumBrowser`, verifies checksums, and creates a Start Menu shortcut.

### Linux (x64 / ARM64) & macOS (Apple Silicon)
```sh
curl -fsSL https://github.com/awesome-os/sectium-browser/releases/latest/download/install.sh | sh
```
Installs `sectium-browser` into `~/.local/bin/sectium-browser`, verifies checksums, and creates a `.desktop` entry on Linux.

---

## Key Features (The Browser-as-Shell Pillar of AwesomeOS)
- **ChromeOS-Model Shell Integration:** Acts as the native display compositor and app runtime of [`awesome-os/awesome-os`](https://github.com/awesome-os/awesome-os) (`0` closed Google/Microsoft telemetry or Widevine DLLs).
- **AtlasKV Sovereign Omnibox + Nudge-Free Search:** Instant `< 5 ms` local KG2KV search across browsing history, workspaces, and the `Holo v11` index.
- **Zero Duplication (`~118 KB` Native Launcher):** Shares ONE immutable `v11` CAS store (`B8G_CAS_DIR` / `~/.b8g/cas`) via 0-byte hardlinks with `code-oss` and `holo-compiler`.
- **Sectium IDE MV3 Extension (`extensions/sectium-ide-devtools/`):** Built-in `HoloCompiler.*`, `HoloDebug.*`, and `HoloVerify.*` DevTools feedback loop with automatic secret redaction.
- **Hardened OS Sandboxing:** AppContainer (`S-1-15-2-1`) on Windows, Seatbelt on macOS, and Landlock + `seccomp` on Holo-Linux `7.3.6`.

## Quick Verification
```bash
node --test app/search/atlaskv-search.test.mts installer/release-profile.test.mts installer/security-hardening.test.mts shell/virtual-frame-shell.test.mts baseline-manifest.test.mts
```

## License
BSD-3-Clause
