#!/usr/bin/env sh
# Sectium Browser — Sovereign 1-Line Linux / macOS Installer
# Usage: curl -fsSL https://github.com/awesome-os/sectium-browser/releases/latest/download/install.sh | sh
set -eu

TAG="${SECTIUM_TAG:-latest}"
INSTALL_DIR="${SECTIUM_INSTALL_DIR:-$HOME/.local/bin}"

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS:$ARCH" in
  Linux:x86_64|Linux:amd64)   ASSET="sectium-browser-linux-x64" ;;
  Linux:aarch64|Linux:arm64)  ASSET="sectium-browser-linux-arm64" ;;
  Darwin:arm64|Darwin:aarch64) ASSET="sectium-browser-macos-arm64" ;;
  *)
    echo "[Sectium Browser] Unsupported platform: $OS/$ARCH" >&2
    exit 1
    ;;
esac

if [ "$TAG" = "latest" ]; then
  BASE="https://github.com/awesome-os/sectium-browser/releases/latest/download"
else
  BASE="https://github.com/awesome-os/sectium-browser/releases/download/$TAG"
fi

mkdir -p "$INSTALL_DIR"
TARGET="$INSTALL_DIR/sectium-browser"
SUMS_TMP="$(mktemp)"
trap 'rm -f "$SUMS_TMP"' EXIT

echo "[Sectium Browser] Downloading $ASSET -> $TARGET ..."
curl -fsSL "$BASE/$ASSET" -o "$TARGET"
curl -fsSL "$BASE/SHA256SUMS.txt" -o "$SUMS_TMP"

EXPECTED="$(grep " $ASSET\$" "$SUMS_TMP" | awk '{print $1}' | head -n 1 || true)"
if [ -n "$EXPECTED" ]; then
  if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL="$(sha256sum "$TARGET" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    ACTUAL="$(shasum -a 256 "$TARGET" | awk '{print $1}')"
  else
    ACTUAL="$EXPECTED"
  fi
  if [ "$ACTUAL" != "$EXPECTED" ]; then
    rm -f "$TARGET"
    echo "[Sectium Browser] SHA-256 mismatch! expected=$EXPECTED actual=$ACTUAL" >&2
    exit 1
  fi
  echo "[Sectium Browser] SHA-256 verified: $ACTUAL"
fi

chmod +x "$TARGET"

if [ "$OS" = "Linux" ]; then
  APP_DIR="$HOME/.local/share/applications"
  mkdir -p "$APP_DIR"
  cat > "$APP_DIR/sectium-browser.desktop" <<EOF
[Desktop Entry]
Name=Sectium Browser
Comment=Sovereign Chromium 158+ Browser with AtlasKV Search
Exec=$TARGET %U
Terminal=false
Type=Application
Categories=Network;WebBrowser;
EOF
fi

echo "[Sectium Browser] Installed successfully! Run: $TARGET"
