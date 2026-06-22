# beheld brand assets

Three surfaces, three techniques. The **terminal is primary** — a CLI lives there.

| Surface | Where it's implemented |
|---|---|
| Terminal (ANSI + Unicode) | `packages/cli/src/brand/` — `mark()`, `lockup()`, `banner()` |
| Artifact (inline SVG) | the `.svg` files here |
| Chat / markdown | a hosted image (see below) |

**Inviolable rule:** brackets in ink, cursor (`#`) in signal green `#58d36c`.
Green is used for nothing else. The wordmark is `beheld` with the `b` in green.

## Files

| File | Use |
|---|---|
| `beheld-mark.svg` | Neutral glyph, brackets in `currentColor`. Favicon/icon grade, static. |
| `beheld-mark-light.svg` | Glyph for **light** backgrounds (ink `#0a0b0b`), static green cursor. |
| `beheld-mark-dark.svg` | Glyph for **dark** backgrounds (tinta `#eef0ee`), static green cursor. |
| `beheld-mark-16.svg` | Chunky, pixel-aligned glyph for tiny sizes (≤32px) — source for the 16/32 PNGs so the brackets survive. Keeps a solid block cursor (a `#` is illegible at 16px). |
| `beheld-lockup.svg` | Glyph + `beheld` wordmark. JetBrains Mono baked to outlines — no webfont. |
| `png/beheld-mark-{16,32,180,512}.png` | Raster fallbacks, transparent background (16/32 from the chunky source, 180/512 from the detailed mark). |

The cursor is a solid, static green `#` — no animation on any surface.

## Chat / markdown

The chat renderer sanitizes inline SVG/`<style>`. The only path is a hosted
image:

```md
![beheld](https://cdn.beheld.dev/brand/beheld-mark.svg)
```

Serve `image/svg+xml` (or PNG) from a stable URL. The mark is static, so a
plain SVG/PNG is all that's needed.

## Regenerating

```sh
# Wordmark outlines (needs the opentype.js devDependency; fetches the OFL font
# into the OS temp dir, or set BEHELD_FONT to a local JetBrainsMono-Regular.ttf)
bun assets/brand/build-lockup.ts

# PNG fallbacks (needs rsvg-convert: `brew install librsvg`)
sh assets/brand/generate-png.sh
```

## Geometry (spec §3.1)

`viewBox 0 0 120 120` · brackets `M46 28 H30 V92 H46` / `M74 28 H90 V92 H74`
at `stroke-width 7` · cursor `#` (2 verticals + 2 horizontals, `stroke-width 6`)
in `#58d36c`. The terminal renders the same `#` (see `packages/cli/src/brand`).
