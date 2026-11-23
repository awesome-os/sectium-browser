# V8 `lo` & `bun-neon-v8` Fast-Call Patch Directory

Any `*.patch` file placed in this directory is automatically applied (`git apply`) to fresh upstream `v8/v8` during `v8-gravity-compile.yml` (`build_flavor: lo-monolith`).

## Included Profile (`lo-args.gn`)
- `v8_monolithic = true` + `is_component_build = false` -> emits `libv8_monolith.a`
- `v8_expose_public_symbols = true` + `v8_use_external_startup_data = false`
- `v8_enable_sandbox = false` + `v8_enable_pointer_compression = false` (direct raw `lo.ptr()` / `B8G_ARENA_V1` zero-copy FFI + `v8::CFunction` Fast API calls)
- Supports cross-compilation for both `linux-x64` and `linux-arm64` on free `ubuntu-latest` via Damped Gravity drops.
