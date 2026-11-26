# Changelog

All notable changes to **`awesome-os/sectium-browser`**.

---

## `v0.7.0` — 2026-11-24

### Unified Holo `v11` CAS Launcher & Shared Electron v47 Runtime
- **Native C11 Lumi Splash Launcher (`launcher/sectium_browser_launcher.c`):**
  - Replaced legacy `AppData\Local\AwesomeOS\cas\` + bare `01-browser-split-shell.exe` flow with the unified **`~/.b8g/cas/v11/`** Holo `v11` CAS launcher matching `awesome-os/devtools` (`ide/code-oss`).
  - Instant `< 15 ms` **Lumi White Dragon Hydration Splash** (`lumi_hydration_splash.h`) + embedded Lumi White Dragon PE icon (`lumi.res`).
  - Shares the **exact same `electron-win64.tar.zst` (`v47.0.0-nightly.20261123` — Chromium 158+ / V8 15.8+ / Node 26+)** as `awesome-os/devtools` (`ide/code-oss`) (**`0 B` extra Chromium duplication**).
  - Self-hydrates via OS-native `curl` + `tar` (`zstd`) with zero Node bootstrap dependency; supports `--version`, `--help`, `--no-splash`, `--dry-run`, and URL arguments.
- **Sectium Browser App (`app/` → `sectium-browser-app.tar.zst` in Holo `v11` CAS):**
  - Multi-tab Chromium 158+ browser using Electron `WebContentsView`, sleek dark tab/omnibar chrome bar, live Chromium/V8 version badge, and built-in DevTools toggle.
  - Pure-art **Sectium Canvas** New Tab (`newtab/newtab.html`, Aurora canvas, Lumi emblem, clock, omnibar, and bottom-left Host Device switcher).
- **Ecosystem Alignment:** Aligned with `awesome-os/chromium-baseline` (`V8 16.0.88+`, `runtimes/node`), `awesome-os/devtools` (`ide/code-oss` `1.147.0`), and `awesome-os/holo-v11`.

## `v0.6.1-baseline` — 2026-11-23
- Unified Modular Baseline (`V8 16.0.88` + Display ABI + 8 Win32 GUI Shells + `RollingReleaseManifest.json`).
