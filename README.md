# Sectium Browser

A fast, clean, de-Googled **BSD-3** desktop browser built for daily work.

## Key Features
- **Zero Ad-Bidding Models & Zero Telemetry:** `build_with_tflite_lib = false` across all 6 static release targets and `--disable-component-update` + `OptimizationGuideModelDownloading,BrowsingTopics` disabled by default.
- **Vertical Tab Groups & Horizontal Split View:** Lay out two or more tabs side-by-side with draggable dividers (`shell/virtual-frame-shell.mts`).
- **Automatic Idle-Tab Freezing:** Silent background tabs freeze cleanly while active audio or split-visible tabs stay responsive.
- **Hardened Sandboxing & Installer Integrity:** Strict OS-native sandboxing (AppContainer / Seatbelt / Landlock+seccomp), `<= 250` char shortcut gate, and SHA-256 tamper verification.

## Quick Verification
```bash
node --test installer/release-profile.test.mts installer/security-hardening.test.mts shell/virtual-frame-shell.test.mts
```

## License
BSD-3-Clause
