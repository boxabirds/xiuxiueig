"""Floor metrics over the lower 55% of the frame (where the floor is when looking down).

sparkle   mean |Laplacian| of luma (spatial high-frequency energy)
shimmer   mean |a - a2| (0.25 s apart; includes legitimate smooth motion)
flicker   mean |Laplacian(a - a2)|: high-frequency temporal change only, i.e.
          sparkle that twinkles; smooth motion (breath, drift) barely registers
evolution mean |a - b| over 120 s of world time (should be large)
Usage: uv run --with pillow --with numpy tests/browser/floor_metrics.py [--max-sparkle N] [--min-evolution-ratio R]
"""
import sys

import numpy as np
from PIL import Image

OUT = "tests/browser/out"
FLOOR_FRACTION = 0.55


def luma(path):
    a = np.asarray(Image.open(path).convert("RGB"), dtype=np.float64)
    y = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
    return y[int(y.shape[0] * (1 - FLOOR_FRACTION)):, :]


def laplacian_energy(y):
    lap = 4 * y[1:-1, 1:-1] - y[:-2, 1:-1] - y[2:, 1:-1] - y[1:-1, :-2] - y[1:-1, 2:]
    return float(np.abs(lap).mean())


def main(argv):
    max_sparkle = float(argv[argv.index("--max-sparkle") + 1]) if "--max-sparkle" in argv else None
    min_ratio = float(argv[argv.index("--min-evolution-ratio") + 1]) if "--min-evolution-ratio" in argv else None
    a, a2, b = (luma(f"{OUT}/floor-{n}.png") for n in ("a", "a2", "b"))
    sparkle = laplacian_energy(a)
    shimmer = float(np.abs(a - a2).mean())
    flicker = laplacian_energy(a - a2)
    evolution = float(np.abs(a - b).mean())
    ratio = evolution / max(shimmer, 1e-6)
    print(f"sparkle {sparkle:.2f}  flicker {flicker:.2f}  shimmer {shimmer:.2f}  evolution {evolution:.2f}  evolution/shimmer {ratio:.1f}")
    ok = (max_sparkle is None or sparkle <= max_sparkle) and (min_ratio is None or ratio >= min_ratio)
    if not ok:
        print(f"FAIL: want sparkle <= {max_sparkle}, evolution/shimmer >= {min_ratio}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
