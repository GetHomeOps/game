"""Align the floor line across every room PNG in src/assets/new_backgrounds.

Each background was authored independently, so the painted floor (the line
where the wall meets the floor) sits at a different y in every image. When
the game tiles them edge-to-edge, those mismatched floor heights show as a
visible step at every seam.

This script:

  1.  Detects each PNG's floor y by scanning the bottom 45% of the image
      for the strongest horizontal edge that has a relatively low-detail
      region below it (i.e. a wall→floor transition rather than a
      counter/table edge that has more detail below).
  2.  Picks a target y that matches the in-game FLOOR_TOP ratio
      (FLOOR_TOP / WORLD_HEIGHT = 460 / 540 ≈ 0.852).
  3.  Vertically shifts each image so its detected floor lands on the
      target y. The image keeps the same dimensions; the area created by
      the shift is filled by extending the closest row (top row when
      padding the top, bottom row when padding the bottom).

If src/assets/new_backgrounds_orig/ does not exist yet, this script copies the
current PNGs from new_backgrounds there once (so you keep a stable source for
re-runs). The game never loads that folder — it is only for this tooling.
Delete new_backgrounds_orig anytime to reclaim disk; the next run will
re-seed it from whatever is in new_backgrounds.
A debug copy with a horizontal red line drawn at the detected floor is
written to scripts/_floor_debug/ so you can sanity-check the detection.

Usage:
    python3 scripts/align_background_floors.py             # dry run, prints + debug only
    python3 scripts/align_background_floors.py --apply     # also writes aligned PNGs
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BG_DIR = ROOT / "src" / "assets" / "new_backgrounds"
BACKUP_DIR = ROOT / "src" / "assets" / "new_backgrounds_orig"
DEBUG_DIR = ROOT / "scripts" / "_floor_debug"

# In-game floor sits at FLOOR_TOP=460 of WORLD_HEIGHT=540.
TARGET_FLOOR_RATIO = 460 / 540


def detect_floor_y(img: Image.Image) -> int:
    """Return the source-y coordinate of the wall→floor boundary.

    Heuristic: in the bottom 45% of the image, find the row whose horizontal
    edge strength is highest while the area immediately below it is
    relatively uniform. This biases toward true floor lines (a strong edge
    with smooth floor underneath) over countertop / table edges (a strong
    edge with more detail underneath).
    """
    gray = np.asarray(img.convert("L"), dtype=np.float32)
    h, _w = gray.shape

    dy = np.abs(np.diff(gray, axis=0))           # row-to-row difference
    row_edge = dy.sum(axis=1)                    # horizontal edge magnitude per row
    row_var = gray.var(axis=1)                   # row "busyness"

    # Smooth a bit so individual pixel rows don't dominate.
    k = 9
    kernel = np.ones(k) / k
    edge_s = np.convolve(row_edge, kernel, mode="same")
    var_s = np.convolve(row_var, kernel, mode="same")

    start = int(h * 0.55)
    end = int(h * 0.95)

    # For each candidate row, average the variance over the band of rows just below it.
    band = 60
    scores = np.zeros(h, dtype=np.float32)
    for y in range(start, end):
        below = var_s[y + 1 : min(h, y + 1 + band)]
        below_var = float(below.mean()) if below.size else 1.0
        scores[y] = edge_s[y] / (below_var + 50.0)

    return int(np.argmax(scores))


def shifted(img: Image.Image, current_y: int, target_y: int) -> Image.Image:
    """Return a new image of the same size with content shifted so current_y → target_y."""
    arr = np.asarray(img.convert("RGB"))
    h, _w, _c = arr.shape
    shift = target_y - current_y
    if shift == 0:
        return img.copy()

    out = np.empty_like(arr)
    if shift > 0:
        # Floor too high — push content down. Pad top by repeating the top row.
        top_row = arr[0:1]                       # shape (1, w, 3)
        out[:shift] = np.repeat(top_row, shift, axis=0)
        out[shift:] = arr[: h - shift]
    else:
        s = -shift
        # Floor too low — pull content up. Pad bottom by repeating the bottom row.
        bottom_row = arr[h - 1 : h]
        out[: h - s] = arr[s:]
        out[h - s :] = np.repeat(bottom_row, s, axis=0)

    return Image.fromarray(out)


def write_debug(img: Image.Image, floor_y: int, target_y: int, dest: Path) -> None:
    arr = np.asarray(img.convert("RGB")).copy()
    h, w, _ = arr.shape
    if 0 <= floor_y < h:
        arr[max(0, floor_y - 1) : min(h, floor_y + 2)] = [255, 0, 0]      # detected: red
    if 0 <= target_y < h:
        arr[max(0, target_y - 1) : min(h, target_y + 2)] = [0, 255, 255]  # target:   cyan
    Image.fromarray(arr).save(dest, "PNG", optimize=True)


def ensure_backup(files: list[Path]) -> None:
    if BACKUP_DIR.exists():
        return
    print(f"  → backing up originals to {BACKUP_DIR.relative_to(ROOT)}")
    BACKUP_DIR.mkdir(parents=True)
    for p in files:
        shutil.copy2(p, BACKUP_DIR / p.name)


def main(apply: bool) -> None:
    files = sorted(BG_DIR.glob("*.png"))
    if not files:
        print(f"No PNGs found in {BG_DIR}")
        sys.exit(1)

    ensure_backup(files)
    DEBUG_DIR.mkdir(parents=True, exist_ok=True)

    # Always detect from the original (un-shifted) backups so re-runs are stable.
    src_dir = BACKUP_DIR
    detected: dict[str, tuple[int, tuple[int, int]]] = {}
    for p in sorted(src_dir.glob("*.png")):
        with Image.open(p) as im:
            y = detect_floor_y(im)
            detected[p.name] = (y, im.size)

    heights = {size[1] for _, size in detected.values()}
    if len(heights) != 1:
        print(f"WARNING: backgrounds have mixed heights {heights}; using first.")
    h = next(iter(detected.values()))[1][1]
    target_y = int(round(TARGET_FLOOR_RATIO * h))

    print(f"\nTarget floor y = {target_y}  (= {TARGET_FLOOR_RATIO:.3f} × {h})\n")
    print(f"{'file':<50} detected   shift")
    print(f"{'-' * 50} --------   -----")
    for name, (y, _size) in detected.items():
        print(f"{name:<50} y={y:<6}  {target_y - y:+d}")

    print("\nWriting debug previews to", DEBUG_DIR.relative_to(ROOT))
    for p in sorted(src_dir.glob("*.png")):
        y, _ = detected[p.name]
        with Image.open(p) as im:
            write_debug(im, y, target_y, DEBUG_DIR / p.name)

    if not apply:
        print("\nDry run complete. Re-run with --apply to write aligned PNGs.")
        return

    print("\nWriting aligned PNGs back to", BG_DIR.relative_to(ROOT))
    for p in sorted(src_dir.glob("*.png")):
        y, _ = detected[p.name]
        with Image.open(p) as im:
            out = shifted(im, y, target_y)
        out.save(BG_DIR / p.name, "PNG", optimize=True)
        print(f"  ✓ {p.name}  shift {target_y - y:+d}")


if __name__ == "__main__":
    main(apply="--apply" in sys.argv[1:])
