#!/usr/bin/env sh
# Fetch the production beheld-engine binary from the private beheldhq/engine
# repository's GitHub releases. Requires BEHELD_ENGINE_TOKEN, a PAT with
# `repo` read scope on beheldhq/engine.
#
# The version to fetch is taken from BEHELD_ENGINE_VERSION (e.g. "v0.5.0"),
# defaulting to "latest".
set -eu

if [ -z "${BEHELD_ENGINE_TOKEN:-}" ]; then
  echo "fetch-engine: BEHELD_ENGINE_TOKEN is required" >&2
  exit 1
fi

version="${BEHELD_ENGINE_VERSION:-latest}"
os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch_raw="$(uname -m)"
case "$arch_raw" in
  arm64|aarch64) arch="arm64" ;;
  x86_64|amd64)  arch="x64" ;;
  *) echo "fetch-engine: unsupported arch: $arch_raw" >&2; exit 1 ;;
esac

case "$os" in
  darwin|linux) ;;
  *) echo "fetch-engine: unsupported OS: $os" >&2; exit 1 ;;
esac

if [ "$os" = "darwin" ] && [ "$arch" = "x64" ]; then
  cat >&2 <<'EOF'
fetch-engine: macOS Intel (darwin-x64) is not yet available.

The beheldhq/engine release currently ships:
  - beheld-engine-linux-x64
  - beheld-engine-linux-arm64
  - beheld-engine-darwin-arm64 (Apple Silicon)

Track Intel macOS support: https://github.com/beheldhq/cli/issues
EOF
  exit 1
fi

asset_base="beheld-engine-${os}-${arch}"
asset_tarball="${asset_base}.tar.gz"
asset_checksum="${asset_tarball}.sha256"
repo="beheldhq/engine"
api_base="https://api.github.com/repos/${repo}"

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
dest="${repo_root}/packages/cli/assets/beheld-engine"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
mkdir -p "$(dirname "$dest")"

echo "fetch-engine: resolving ${repo}@${version}"
if [ "$version" = "latest" ]; then
  release_url="${api_base}/releases/latest"
else
  release_url="${api_base}/releases/tags/${version}"
fi

release_json="$(curl -fsSL \
  -H "Authorization: Bearer ${BEHELD_ENGINE_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  "${release_url}")"

# Extract asset IDs by name. python3 is available on all GitHub-hosted runners.
asset_id="$(printf '%s' "$release_json" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for a in data.get('assets', []):
    if a['name'] == '$asset_tarball':
        print(a['id']); break
")"

checksum_id="$(printf '%s' "$release_json" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for a in data.get('assets', []):
    if a['name'] == '$asset_checksum':
        print(a['id']); break
")"

if [ -z "${asset_id:-}" ]; then
  echo "fetch-engine: no asset named ${asset_tarball} in ${repo}@${version}" >&2
  exit 1
fi

echo "fetch-engine: downloading ${asset_tarball} (id ${asset_id})"
curl -fsSL \
  -H "Authorization: Bearer ${BEHELD_ENGINE_TOKEN}" \
  -H "Accept: application/octet-stream" \
  "${api_base}/releases/assets/${asset_id}" \
  -o "${tmpdir}/${asset_tarball}"

if [ -n "${checksum_id:-}" ]; then
  echo "fetch-engine: downloading ${asset_checksum}"
  curl -fsSL \
    -H "Authorization: Bearer ${BEHELD_ENGINE_TOKEN}" \
    -H "Accept: application/octet-stream" \
    "${api_base}/releases/assets/${checksum_id}" \
    -o "${tmpdir}/${asset_checksum}"

  echo "fetch-engine: verifying checksum"
  cd "$tmpdir"
  expected="$(awk '{print $1}' "$asset_checksum")"
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$asset_tarball" | awk '{print $1}')"
  else
    actual="$(shasum -a 256 "$asset_tarball" | awk '{print $1}')"
  fi
  if [ "$expected" != "$actual" ]; then
    echo "fetch-engine: checksum mismatch" >&2
    echo "  expected: $expected" >&2
    echo "  actual:   $actual" >&2
    exit 1
  fi
  cd - >/dev/null
else
  echo "fetch-engine: no checksum asset found — skipping verification"
fi

echo "fetch-engine: extracting"
tar -xzf "${tmpdir}/${asset_tarball}" -C "$tmpdir"

if [ ! -f "${tmpdir}/beheld-engine" ]; then
  echo "fetch-engine: extracted tarball missing 'beheld-engine' binary" >&2
  ls -la "$tmpdir" >&2
  exit 1
fi

mv "${tmpdir}/beheld-engine" "$dest"
chmod +x "$dest"
echo "fetch-engine: wrote $dest"
"$dest" --version 2>&1 || echo "fetch-engine: WARN binary did not respond to --version"
