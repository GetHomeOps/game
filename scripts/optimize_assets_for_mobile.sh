#!/usr/bin/env bash
# Resize game art so it fits in iOS Safari / iOS Chrome's per-page image
# memory budget (~80–100 MB of decoded RGBA). The original ChatGPT exports
# are 1254×1254 (player / hazards) or 1672×941 (backgrounds), which decode
# to roughly 185 MB total — far over the budget — and make the loader hang
# at 0% on iPhone.
#
# Targets (all square / aspect-preserving):
#   - opsy_running_new : 1254×1254 → 512×512   (~6.3 MB → ~1.0 MB decoded each)
#   - hazards_new      : 1254×1254 → 512×512
#   - new_backgrounds  : 1672×941  → 1280×720  (~6.3 MB → ~3.7 MB decoded each)
#   - opsy_end         : 1672×941  → 1280×720
#
# Idempotent: skips files that are already at-or-below the target longest side.
# Uses macOS `sips` (built-in). Run from the repo root.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ASSETS_DIR="$ROOT_DIR/src/assets"

if ! command -v sips >/dev/null 2>&1; then
  echo "error: 'sips' not found. Run this on macOS, or port to ImageMagick / pillow." >&2
  exit 1
fi

resize_dir() {
  local dir="$1"
  local target="$2"
  shopt -s nullglob
  for f in "$dir"/*.png; do
    local cur
    cur=$(sips -g pixelWidth -g pixelHeight "$f" 2>/dev/null \
      | awk '/pixelWidth/ {w=$2} /pixelHeight/ {h=$2} END {print (w>h?w:h)}')
    if [ -z "$cur" ]; then
      echo "  skip (could not read dims): $(basename "$f")"
      continue
    fi
    if [ "$cur" -le "$target" ]; then
      echo "  already small ($cur ≤ $target): $(basename "$f")"
      continue
    fi
    sips -Z "$target" "$f" --out "$f" >/dev/null
    echo "  resized $cur → $target: $(basename "$f")"
  done
}

echo "Optimizing player run / idle frames…"
resize_dir "$ASSETS_DIR/opsy_running_new" 512

echo "Optimizing hazards…"
resize_dir "$ASSETS_DIR/hazards_new" 512

echo "Optimizing backgrounds…"
resize_dir "$ASSETS_DIR/new_backgrounds" 1280

echo "Optimizing end-screen art…"
resize_dir "$ASSETS_DIR/opsy_end" 1280

echo "Done. Remember to bump asset cache-busters (e.g. ?v= in BootScene.js)."
