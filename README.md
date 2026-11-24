# Sectium Browser

> **A fast, sovereign BSD-3 desktop browser (`~110 MB` RAM live) with AtlasKV local search, Chrome-nudge-free Google web search (zero DuckDuckGo), pure-art Sectium Canvas New Tab, and zero-duplication `b8g-ghost @ cas-v1` hydration.**

---

## Quick Install

### Windows (PowerShell)
```powershell
irm https://github.com/awesome-os/sectium-browser/releases/latest/download/install.ps1 | iex
```
Installs `sectium-browser.exe` into `%LOCALAPPDATA%\AwesomeOS\SectiumBrowser`, verifies `SHA256SUMS.txt`, and creates a Start Menu shortcut.

### Linux (x64 / ARM64) & macOS (Apple Silicon)
```sh
curl -fsSL https://github.com/awesome-os/sectium-browser/releases/latest/download/install.sh | sh
```
Installs `sectium-browser` into `~/.local/bin/sectium-browser`, verifies `SHA256SUMS.txt`, and creates a `.desktop` entry on Linux.

---

## Key Features
- **AtlasKV Sovereign Search + Nudge-Free Google Web Search:** Instant `< 5 ms` local KG2KV vector search over your browsing history, Awesome-OS ecosystem, and `b8g-ghost @ cas-v1` index, with 3-layer Chrome-nudge-free Google Search fallback (clean Chrome UA, callout network block, CSS promo hide — zero DuckDuckGo).
- **Zero Duplication (`~118 KB` Native Launcher):** Shares ONE `b8g-ghost` CAS runtime (`B8G_GHOST_CACHE_DIR` / `~/.b8g/cas`) with `awesome-os/code-oss` and `awesome-os/theia`.
- **Zero Ad-Bidding Models & Zero Telemetry:** `build_with_tflite_lib = false` across all static release targets and `--disable-component-update` + `OptimizationGuideModelDownloading,BrowsingTopics` disabled by default.
- **Vertical Tab Groups & Horizontal Split View:** Lay out two or more tabs side-by-side with draggable dividers (`shell/virtual-frame-shell.mts`) and automatic idle-tab freezing.
- **Hardened Sandboxing & Installer Integrity:** Strict OS-native sandboxing (AppContainer / Seatbelt / Landlock+seccomp), `<= 250` char shortcut gate, and SHA-256 tamper verification.

## Quick Verification
```bash
node --test app/search/atlaskv-search.test.mts installer/release-profile.test.mts installer/security-hardening.test.mts shell/virtual-frame-shell.test.mts baseline-manifest.test.mts
```

## License
BSD-3-Clause
