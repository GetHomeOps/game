"""Keep only the largest connected component of opaque pixels in an RGBA PNG,
then crop the result to its visible bounding box.

Usage: python3 scripts/keep_largest_blob.py <in.png> <out.png>
"""
from __future__ import annotations

import sys
from collections import deque

from PIL import Image


def run(in_path: str, out_path: str) -> None:
    im = Image.open(in_path).convert("RGBA")
    w, h = im.size
    px = im.load()

    visited = bytearray(w * h)
    component = bytearray(w * h)  # 1 in the largest component
    best_size = 0
    best_seed: tuple[int, int] | None = None

    for sy in range(h):
        for sx in range(w):
            idx = sy * w + sx
            if visited[idx] or px[sx, sy][3] < 8:
                continue
            queue = deque([(sx, sy)])
            visited[idx] = 1
            cells: list[int] = []
            while queue:
                x, y = queue.popleft()
                cells.append(y * w + x)
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h:
                        nidx = ny * w + nx
                        if not visited[nidx] and px[nx, ny][3] >= 8:
                            visited[nidx] = 1
                            queue.append((nx, ny))
            if len(cells) > best_size:
                best_size = len(cells)
                best_seed = (sx, sy)
                # store this component as the current best
                component = bytearray(w * h)
                for c in cells:
                    component[c] = 1

    if best_seed is None:
        print("no opaque pixels found")
        sys.exit(1)

    cleared = 0
    for y in range(h):
        for x in range(w):
            idx = y * w + x
            if not component[idx] and px[x, y][3] != 0:
                px[x, y] = (0, 0, 0, 0)
                cleared += 1

    bbox = im.getbbox()
    cropped = im.crop(bbox)
    cropped.save(out_path, "PNG", optimize=True)
    print(
        f"{in_path}: largest blob = {best_size} px, "
        f"removed {cleared} stray px, cropped to {cropped.size}"
    )


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    run(sys.argv[1], sys.argv[2])
