# Sectium Browser Security Policy & Threat Model

> **Repository:** `awesome-os/sectium-browser` (`intersections/sectium-browser/`)
> **Release Baseline:** Sectium `160.0.8177.0` (Chromium 160 / BSD-3 sovereign display appliance)

---

## 1. Security Architecture & Threat Model

Sectium Browser is engineered as a decoupled, zero-telemetry BSD-3 display appliance with defense-in-depth controls across OS permissions, launch-surface hardening, binary integrity verification, and supply-chain signing.

### 1.1 Windows AppContainer Sandbox (`S-1-15-2-1`)

- Every renderer, GPU, and network process executes inside the Windows AppContainer sandbox with restricted tokens.
- During installation ([`install-sectium.mts`](installer/install-sectium.mts)), the installer grants strictly **Read + Execute (`RX`)** ACLs on the installation directory to `ALL APPLICATION PACKAGES` (`*S-1-15-2-1`) and `Users` (`*S-1-5-32-545`) — never write access.
- For multi-user or hardened workstation deployments, the `--system` flag installs Sectium to `C:\Program Files\Sectium`, restricting binary modification to elevated Administrators and mitigating standard-user DLL/binary planting.

### 1.2 Hardened Zero-`--load-extension` Default

- **Threat mitigated:** Malware and adware routinely abuse Chromium's `--load-extension` and `--disable-features=DisableLoadExtensionCommandLineSwitch` flags in `.lnk` shortcuts or registry command handlers to achieve persistent unpacked-extension injection.
- **Control:** `installSectium()` defaults to `hardened: true` and `devUnpackedExt: false`. `buildSafeShortcutArgs()` **never** emits `--disable-features=DisableLoadExtensionCommandLineSwitch` or `--load-extension=...` in Desktop shortcuts, Start Menu shortcuts, `HKCU` browser command handlers, or `sectium-open.cmd` unless the operator explicitly opts in with `--dev-unpacked-ext` for local development.
- **Preflight Gate:** Shortcut argument strings are strictly bounded to `<= 250` characters so Windows Shell `.lnk` truncation (`> 260` chars) cannot silently drop security flags.

### 1.3 Post-Stamp Binary & Extension Integrity (`sectium-integrity.json`)

- **Threat mitigated:** Post-install tampering of `sectium.exe`, `chrome.dll`, or bundled extension assets under `resources/new-tab-extension/`.
- **Control:** Immediately after resource stamping, `writeInstallIntegrityManifest(installDir)` computes SHA-256 digests of `sectium.exe`, `chrome.dll`, and every file under `resources/new-tab-extension/` into `<installDir>/sectium-integrity.json` (`schema: "sectium-integrity-v1"`).
- **Verification:** `verifyInstallIntegrity(installDir)` recomputes SHA-256 digests for every manifest entry and returns `{ ok, checked, tampered, missing }`, failing closed on any single-byte modification, missing file, or path traversal.

### 1.4 Pre-Sign Icon Stamping Pipeline

- **Threat mitigated:** Invalidating PE Authenticode signatures or corrupting signed binaries by modifying PE resources (`RT_GROUP_ICON #101`) after code signing.
- **Control:** Multi-resolution Lumi icon stamping (`pe-icon-stamp.exe` on `sectium.exe` and `chrome.dll`) executes strictly **before** Authenticode signing in release builds and **before** `sectium-integrity.json` hash generation, ensuring signed binaries and integrity manifests remain cryptographically consistent.

### 1.5 Zero-Telemetry & Host Pipe IPC Boundary

- Launch wrappers explicitly disable Google API key / OAuth fallback (`GOOGLE_API_KEY=no`, `GOOGLE_DEFAULT_CLIENT_ID=no`, `GOOGLE_DEFAULT_CLIENT_SECRET=no`) and ship zero closed Google/Microsoft DLLs.
- Local control-plane and DevTools automation communicate strictly over OS named pipes / Unix sockets (`\\.\pipe\sectium-dev`, `/tmp/sectium-dev.sock`) rather than `127.0.0.1` HTTP listeners, eliminating DNS-rebinding and local-port hijacking surfaces.

### 1.6 Multi-OS / Multi-Arch Sandbox & Code Signing Matrix

Sectium Browser and its `< 1 s` **`holo-compiler`** companion runtimes (`sectium-es`, `sectium-jvm`, `sectium_cp`) enforce 5-OS multi-arch sandbox and cryptographic verification parity across all supported targets (configured in [`release-profile.mts`](installer/release-profile.mts) and documented in [`DEVOPS-BUILD-DISTRIBUTION-AND-SIGNING-GUIDE.md`](../../docs/architecture/DEVOPS-BUILD-DISTRIBUTION-AND-SIGNING-GUIDE.md)):

| Target | `target_os` / `target_cpu` | Sandbox Model | Sovereign Verification & Code Signing |
| :--- | :--- | :--- | :--- |
| **`win-x64`** | `win` / `x64` | `AppContainer S-1-15-2-1` (`RX` ACLs, zero write) | SHA-256 + Ed25519 manifest (`sectium-integrity.json`); optional EV Authenticode for browser `.exe` downloads |
| **`linux-x64`** | `linux` / `x64` | `userns + seccomp-BPF` (Ozone Wayland/X11) | SHA-256 + Ed25519 `.b8p` manifest; 0% external CA required |
| **`linux-arm64`** | `linux` / `arm64` | `userns + seccomp-BPF` (Ozone Wayland/X11) | SHA-256 + Ed25519 `.b8p` manifest; 0% external CA required |
| **`macos-arm64`** | `mac` / `arm64` | `macOS Seatbelt` (Hardened Runtime) | SHA-256 + Ed25519 + free ad-hoc `codesign -s -` via `holo-compiler`; optional Apple Developer ID + Notarization for `.dmg` |
| **`android-arm64`** | `android` / `arm64` | `Android isolatedProcess + SELinux` | SHA-256 + Ed25519 + APK Signature Scheme v2/v3 (self-signed sovereign key or OEM release key) |
| **`fuchsia-x64`** | `fuchsia` / `x64` | `Fuchsia Zircon capabilities + Scenic/Flatland` | SHA-256 + Ed25519 + Fuchsia `.far` Merkle-root / TUF package verification |
| **`wasm32-wasi`** | `wasi` / `wasm32` | WASI capability-based linear memory sandbox | SHA-256 + Ed25519 `.b8p` manifest; 0% external CA required (`holo-compiler` companion target) |

### 1.7 Out-of-Band Permission Broker (`xdg-desktop-portal` / Qubes `qrexec` Model)

- **Threat mitigated:** In-browser permission prompts drawn inside or adjacent to web content are vulnerable to clickjacking, UI redressing, fake DOM overlays, and compromised-renderer spoofing.
- **Trusted Out-of-Band Boundary:** Inspired by `xdg-desktop-portal` and Qubes OS `qrexec`, `SectiumPermissionBroker` (`sections/sectium-cloud-control-plane/permission-broker.mts`) runs strictly **outside** the untrusted browser renderer in the sovereign control plane. Because `channel: 'display'` remains pure visual art, permission prompts (`PermissionRequest`) are routed exclusively over `channel: 'command'` (`\\.\pipe\sectium-dev` / `/tmp/sectium-dev.sock`) to a trusted host surface:
  - Native OS dialog or declarative `<b8g-sectium-permission data-request-id="..." data-peer-id="..." data-scope="..." data-resource="..."></b8g-sectium-permission>` host shell element (`formatB8gPermissionElement()`).
  - Kitty-Ink TUI or UEFI/serial console (`<= 78`-column box-drawing prompt via `renderPermissionPromptAnsi()`).
- **Ed25519-Signed, Scoped, Revocable Grants:** Approved requests issue an Ed25519-signed `PermissionGrant` bound to `(grantId, peerId, scope, resource, decision, issuedAt, expiresAt)` with four decision modes: `allow-once` (`remainingUses: 1`, consumed on first use), `allow-session`, `allow-persistent`, and `deny`. `verifyGrant()` rejects any mutated or forged grant, and `revokeGrant(grantId)` immediately invalidates active grants.
- **Headless Fail-Closed (`ERR_PERMISSION_DENIED`):** If no valid cached grant exists and no out-of-band `prompter` is attached (e.g., headless CI or unattended daemon), `requestPermission()` fails closed with `ERR_PERMISSION_DENIED` — never auto-approving.
- **Append-Only Audit Logging:** Every permission outcome (`granted`, `denied`, `revoked`, `expired`, `tampered`) is recorded as a `PermissionAuditEntry` and appended to `.b8g-cas/permissions.jsonl` (`auditLogPath`) for forensic review.

---

## 2. Chromium / V8 CVE Rolling-Release SLA

Sectium tracks upstream Chromium, V8, Skia, and BoringSSL security advisories on a continuous rolling-release cadence with $O(1)$ rollback support via `RollingReleaseManifest`:

| Severity Tier | Scope Examples | Target Patch & Release SLA |
| :--- | :--- | :--- |
| **Critical** (CVSS >= 9.0 or Active KEV) | V8 JIT/type confusion RCE, sandbox escape, memory corruption exploited in the wild | **24 hours** from upstream fix availability |
| **High** (CVSS 7.0–8.9) | Renderer use-after-free, Mojo IPC privilege escalation, site-isolation bypass | **72 hours** from upstream fix availability |
| **Medium / Low** (CVSS < 7.0) | UI spoofing, non-exploitable DoS, minor policy bypass | Next scheduled weekly security rollup |

---

## 3. Reporting a Vulnerability

Please report suspected vulnerabilities in Sectium Browser, the installer, or `sectium-integrity.json` verification via private coordinated disclosure:

1. **Do not** open a public issue or publish a proof-of-concept exploit prior to a coordinated release.
2. Include the affected Sectium version, OS version, minimal reproduction steps, and impact assessment.
3. Maintainers acknowledge security reports within **24 hours** and coordinate remediation under the Rolling-Release SLA above.
