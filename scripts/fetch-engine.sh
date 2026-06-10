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

asset="beheld-engine-${os}-${arch}"
repo="beheldhq/engine"
api_base="https://api.github.com/repos/${repo}"

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
dest="${repo_root}/packages/cli/assets/beheld-engine"
mkdir -p "$(dirname "$dest")"

echo "fetch-engine: resolving ${repo}@${version}"
if [ "$version" = "latest" ]; then
  release_url="${api_base}/releases/latest"
else
  release_url="${api_base}/releases/tags/${version}"
fi

asset_id="$(curl -sSL \
  -H "Authorization: Bearer ${BEHELD_ENGINE_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  "${release_url}" \
  | grep -oE "\"id\":[[:space:]]*[0-9]+,[[:space:]]*\"node_id\":[^,]+,[[:space:]]*\"name\":[[:space:]]*\"${asset}\"" \
  | head -n1 \
  | grep -oE '"id":[[:space:]]*[0-9]+' \
  | grep -oE '[0-9]+' \
  | head -n1)"

if [ -z "${asset_id:-}" ]; then
  echo "fetch-engine: no asset named ${asset} in ${repo}@${version}" >&2
  exit 1
fi

echo "fetch-engine: downloading ${asset} (id ${asset_id})"
curl -sSL \
  -H "Authorization: Bearer ${BEHELD_ENGINE_TOKEN}" \
  -H "Accept: application/octet-stream" \
  "${api_base}/releases/assets/${asset_id}" \
  -o "$dest"

chmod +x "$dest"
echo "fetch-engine: wrote $dest"
