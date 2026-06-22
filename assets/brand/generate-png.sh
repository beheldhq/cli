#!/bin/sh
# Rasterize the beheld mark to PNG fallbacks (spec §4): 16, 32, 180 (apple-touch),
# 512. Transparent background, light-ink for contrast on light/white surfaces.
# The blink animation is dropped — raster captures the first frame (solid cursor).
#
# Small sizes (<=32px) use the pixel-aligned chunky source (beheld-mark-16.svg)
# so the bracket form survives; larger sizes use the detailed mark.
#
#   sh assets/brand/generate-png.sh
#
# Requires rsvg-convert (librsvg): `brew install librsvg`.
set -e
cd "$(dirname "$0")"

SMALL="beheld-mark-16.svg"   # chunky, favicon-grade
LARGE="beheld-mark-light.svg" # detailed mark
mkdir -p png

for size in 16 32; do
  rsvg-convert -w "$size" -h "$size" -o "png/beheld-mark-$size.png" "$SMALL"
done
for size in 180 512; do
  rsvg-convert -w "$size" -h "$size" -o "png/beheld-mark-$size.png" "$LARGE"
done

echo "wrote png/beheld-mark-{16,32,180,512}.png"
