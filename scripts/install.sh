#!/usr/bin/env sh
set -e

INSTALL_DIR="${HOME}/.local/bin"
BINARY="beheld"
REPO="beheldhq/cli"

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$ARCH" in
  x86_64)        ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *)
    echo "Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

case "$OS" in
  linux|darwin) ;;
  *)
    echo "Unsupported OS: $OS"
    exit 1
    ;;
esac

if [ "$OS" = "darwin" ] && [ "$ARCH" = "x64" ]; then
  cat >&2 <<'EOF'
Beheld for macOS Intel (x86_64) is not yet available.

Beheld currently ships for:
  - Linux x86_64 and aarch64
  - macOS Apple Silicon (arm64 — M1/M2/M3/M4)

If you have an Apple Silicon Mac, please run this installer from there.
Track Intel macOS support: https://github.com/beheldhq/cli/issues
EOF
  exit 1
fi

BINARY_NAME="${BINARY}-${OS}-${ARCH}"

echo "Fetching latest release..."
VERSION="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
  | grep '"tag_name"' \
  | head -1 \
  | cut -d'"' -f4)"

if [ -z "$VERSION" ]; then
  cat >&2 <<EOF
No Beheld CLI release is published at https://github.com/${REPO} yet.

If you're seeing this for more than a day, please open an issue:
  https://github.com/${REPO}/issues

(If you have no internet access, that could also explain this error.)
EOF
  exit 1
fi

BASE_URL="https://github.com/${REPO}/releases/download/${VERSION}"
DOWNLOAD_URL="${BASE_URL}/${BINARY_NAME}"
CHECKSUM_URL="${BASE_URL}/${BINARY_NAME}.sha256"

TMP_BIN="$(mktemp)"
TMP_SUM="$(mktemp)"

cleanup() {
  rm -f "$TMP_BIN" "$TMP_SUM"
}
trap cleanup EXIT

echo "Downloading Beheld ${VERSION} for ${OS}-${ARCH}..."
curl -fsSL "$DOWNLOAD_URL" -o "$TMP_BIN"
curl -fsSL "$CHECKSUM_URL" -o "$TMP_SUM"

echo "Verifying checksum..."
EXPECTED="$(cat "$TMP_SUM" | awk '{print $1}')"
if command -v sha256sum > /dev/null 2>&1; then
  ACTUAL="$(sha256sum "$TMP_BIN" | awk '{print $1}')"
elif command -v shasum > /dev/null 2>&1; then
  ACTUAL="$(shasum -a 256 "$TMP_BIN" | awk '{print $1}')"
else
  echo "sha256sum or shasum not found — cannot verify checksum."
  exit 1
fi

if [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "Checksum mismatch! Download may be corrupted."
  echo "Expected: $EXPECTED"
  echo "Got:      $ACTUAL"
  exit 1
fi

echo "Checksum verified."

mkdir -p "$INSTALL_DIR"
mv "$TMP_BIN" "${INSTALL_DIR}/${BINARY}"
chmod +x "${INSTALL_DIR}/${BINARY}"

# Ad-hoc sign on macOS (required for binaries copied via curl)
if [ "$(uname -s)" = "Darwin" ]; then
  xattr -d com.apple.quarantine "${INSTALL_DIR}/${BINARY}" 2>/dev/null || true
  codesign --sign - --force "${INSTALL_DIR}/${BINARY}" 2>/dev/null || true
  echo "  ✓ Ad-hoc signature applied (macOS)"
fi

echo ""
echo "Beheld ${VERSION} installed to ${INSTALL_DIR}/${BINARY}"
echo ""

# L1-first onboarding: bootstrap migrates legacy ~/.devprofile/ (if present)
# and prepares ~/.beheld/ with mode 0700 BEFORE the harness wizard runs.
# The wizard (`init`) then wires Claude Code + Continue.dev hooks. The two
# steps stay separate so a dev can rerun either independently.
echo "Running L1-first bootstrap..."
echo ""
"${INSTALL_DIR}/${BINARY}" bootstrap

# `beheld init` is an interactive wizard and `curl | sh` is non-interactive
# (stdin is bound to the curl pipe, not the user's terminal). Bun's readline
# can't register keystrokes on /dev/tty in that context. Decision: bootstrap
# (non-interactive) runs here; user runs `beheld init` themselves. Same
# pattern as nvm, rustup (without -y), uv, etc.

echo ""
if ! echo ":${PATH}:" | grep -q ":${INSTALL_DIR}:"; then
  cat <<EOF
──────────────────────────────────────────────────────────────
⚠️  ${INSTALL_DIR} is not in PATH for the current shell.

This is expected on a fresh install — most distros add it only at
next login. Activate it now with one of these:

    source ~/.profile                      # Ubuntu / Debian / Fedora
    export PATH="\$HOME/.local/bin:\$PATH"   # any shell

(New terminal sessions will pick it up automatically.)

Then finish setup:

    beheld init
──────────────────────────────────────────────────────────────
EOF
else
  cat <<'EOF'
──────────────────────────────────────────────────────────────
Almost there. Finish setup from your own shell:

    beheld init

The wizard is interactive and won't work piped through curl.
──────────────────────────────────────────────────────────────
EOF
fi
