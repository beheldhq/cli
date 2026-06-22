#!/usr/bin/env sh
# Build pipeline for the Beheld CLI.
#
# If BEHELD_ENGINE_TOKEN is set (release builds), fetch and embed the
# production engine binary. Otherwise build with a placeholder so local
# development works against the stub HTTP server on :7338.
set -eu

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

mkdir -p dist

engine_asset="packages/cli/assets/beheld-engine"
# The assets/ dir isn't checked in, so on a clean checkout (CI) it must be
# created before either branch writes the engine binary into it.
mkdir -p "$(dirname "$engine_asset")"

if [ -n "${BEHELD_ENGINE_TOKEN:-}" ]; then
  # Pin the embedded engine to its own latest release (override by exporting
  # BEHELD_ENGINE_VERSION). The engine versions independently of the CLI — e.g.
  # CLI 0.5.2 ships engine v0.5.1 because that's the latest engine release.
  # Keep this in sync with release.yml's BEHELD_ENGINE_VERSION.
  : "${BEHELD_ENGINE_VERSION:=v0.5.1}"
  export BEHELD_ENGINE_VERSION
  echo "[build] BEHELD_ENGINE_TOKEN detected — fetching production engine ${BEHELD_ENGINE_VERSION}"
  sh scripts/fetch-engine.sh
else
  if [ ! -f "$engine_asset" ]; then
    echo "[build] no BEHELD_ENGINE_TOKEN and no $engine_asset — writing placeholder"
    cat > "$engine_asset" <<'PLACEHOLDER'
#!/usr/bin/env sh
# This placeholder ships with development builds when the proprietary engine
# binary is not available. Start the dev stub HTTP server instead:
#   bun run stub:engine
echo "beheld-engine placeholder — run 'bun run stub:engine' for local dev" >&2
exit 64
PLACEHOLDER
    chmod +x "$engine_asset"
  fi
fi

echo "[build] compiling beheld CLI"
bun build packages/cli/src/index.ts --compile --outfile dist/beheld
echo "[build] done → dist/beheld"
