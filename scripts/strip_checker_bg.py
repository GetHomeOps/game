"""Strip the baked-in transparency-preview checkerboard from a generated PNG.

The image generator returned RGB PNGs in which the alpha channel was rasterised
as a light/dark gray 8x8 checkerboard. We restore real transparency by flood
filling from the image corners through any pixel that is "near-neutral-gray"
(roughly R==G==B with luminance between ~70 and ~225). The flood is bounded
by the cartoon's black ink outlines and any saturated colour, so the wall
silhouette and interior detail are preserved exactly.

Usage:
    python3 scripts/strip_checker_bg.py <in.png> <out.png>
"""
from __future__ import annotations

import sys
from collections import deque

from PIL import Image


def is_checker_pixel(r: int, g: int, b: int) -> bool:
    """A "background" pixel: near-neutral gray (R≈G≈B) and not deep black.

    Covers both the gray transparency-preview checkerboard (≈94 / ≈204 grays)
    and plain white backgrounds. Pure black (cartoon ink outlines, lum < 70)
    is preserved so the flood fill can't escape through outlines."""
    if abs(r - g) > 12 or abs(g - b) > 12 or abs(r - b) > 12:
        return False
    lum = (r + g + b) / 3
    return lum >= 70


def strip(in_path: str, out_path: str) -> None:
    src = Image.open(in_path).convert("RGBA")
    w, h = src.size
    px = src.load()

    visited = bytearray(w * h)
    queue: deque[tuple[int, int]] = deque()

    def seed(x: int, y: int) -> None:
        if 0 <= x < w and 0 <= y < h and not visited[y * w + x]:
            r, g, b, _a = px[x, y]
            if is_checker_pixel(r, g, b):
                visited[y * w + x] = 1
                queue.append((x, y))

    for x in range(w):
        seed(x, 0)
        seed(x, h - 1)
    for y in range(h):
        seed(0, y)
        seed(w - 1, y)

    cleared = 0
    while queue:
        x, y = queue.popleft()
        px[x, y] = (0, 0, 0, 0)
        cleared += 1
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not visited[ny * w + nx]:
                r, g, b, _a = px[nx, ny]
                if is_checker_pixel(r, g, b):
                    visited[ny * w + nx] = 1
                    queue.append((nx, ny))

    # Soften any anti-aliased gray fringe that borders the now-transparent area
    # by reducing alpha proportionally to how "gray" the pixel is.
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            # only consider pixels touching transparency
            touches_alpha = False
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and px[nx, ny][3] == 0:
                    touches_alpha = True
                    break
            if not touches_alpha:
                continue
            chroma = max(abs(r - g), abs(g - b), abs(r - b))
            lum = (r + g + b) / 3
            if chroma <= 14 and 80 <= lum <= 220:
                # Scale alpha based on how saturated the pixel is.
                # Pure gray (chroma=0) -> 0, chroma>=14 -> keep.
                px[x, y] = (r, g, b, int(a * (chroma / 14)))

    src.save(out_path, "PNG", optimize=True)
    print(f"{in_path} -> {out_path}  cleared {cleared} px ({100 * cleared / (w * h):.1f}%)")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    strip(sys.argv[1], sys.argv[2])
