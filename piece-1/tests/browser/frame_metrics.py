"""Image-quality metrics for a frame (owner: "stepped / low res ... Amiga demo").

speckle  fraction of pixels whose luma differs from their 3x3 median by > 40:
         isolated salt-and-pepper pixels (march noise), not edges or texture
Usage: uv run --with pillow --with numpy tests/browser/frame_metrics.py [--max-speckle F] images...
"""
import sys

import numpy as np
from PIL import Image

SPECKLE_DELTA = 40
DOWNSAMPLE = 2  # screenshots are DPR 2 over a scene rendered near 1 CSS px: judge at scene-pixel scale


def speckle(path):
    im = Image.open(path).convert("L")
    im = im.resize((im.width // DOWNSAMPLE, im.height // DOWNSAMPLE), Image.BOX)
    a = np.asarray(im, dtype=np.float64)
    h, w = a.shape
    stack = np.stack([a[1 + dy:h - 1 + dy, 1 + dx:w - 1 + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1)])
    med = np.median(stack, axis=0)
    return float(np.mean(np.abs(a[1:-1, 1:-1] - med) > SPECKLE_DELTA))


def main(argv):
    limit = float(argv[argv.index("--max-speckle") + 1]) if "--max-speckle" in argv else None
    paths = [p for i, p in enumerate(argv) if not p.startswith("--") and (i == 0 or argv[i - 1] != "--max-speckle")]
    worst = 0.0
    for p in paths:
        s = speckle(p)
        worst = max(worst, s)
        print(f"{p}: speckle {s:.3%}")
    if limit is not None and worst > limit:
        print(f"FAIL: speckle {worst:.3%} > {limit:.3%}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
