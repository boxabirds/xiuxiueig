"""Colourfulness of rendered frames (owner feedback: "kinda boring beige").

Hasler & Suesstrunk (2003) colourfulness M: ~15 "slightly colourful",
~33 "moderately", ~45 "averagely", ~59 "quite", ~82 "highly colourful".
Beige fraction: bright, low-chroma pixels (luma > 150, max-min chroma < 40).
Mud fraction: dark, low-chroma pixels (luma < 110, chroma < 40).
Contrast: value (max channel) spread p95 - p5 (0..255) and RMS contrast (luma std).
(Owner feedback: "make it high contrast".)

Usage: uv run --with pillow --with numpy tests/browser/colourfulness.py [--min-m N] [--max-beige F] images...
"""
import sys

import numpy as np
from PIL import Image

BEIGE_LUMA = 150
BEIGE_CHROMA = 40
MUD_LUMA = 110      # dull, dark, low-chroma: the opposite failure to beige
MEAN_WEIGHT = 0.3


def measure(path):
    a = np.asarray(Image.open(path).convert("RGB"), dtype=np.float64)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    rg = r - g
    yb = 0.5 * (r + g) - b
    m = np.hypot(rg.std(), yb.std()) + MEAN_WEIGHT * np.hypot(rg.mean(), yb.mean())
    luma = 0.299 * r + 0.587 * g + 0.114 * b
    chroma = a.max(axis=2) - a.min(axis=2)
    beige = np.mean((luma > BEIGE_LUMA) & (chroma < BEIGE_CHROMA))
    mud = np.mean((luma < MUD_LUMA) & (chroma < BEIGE_CHROMA))
    # Value (max channel), not luma: saturated blue has luma ~29 and would
    # otherwise read as 'dark', penalising exactly the colours we want.
    p5, p95 = np.percentile(a.max(axis=2), [5, 95])
    return m, beige, mud, luma.mean(), p95 - p5, luma.std()


def main(argv):
    min_m, max_beige, min_spread, paths = None, None, None, []
    it = iter(argv)
    for arg in it:
        if arg == "--min-m":
            min_m = float(next(it))
        elif arg == "--min-spread":
            min_spread = float(next(it))
        elif arg == "--max-beige":
            max_beige = float(next(it))
        else:
            paths.append(arg)
    ms, beiges, spreads = [], [], []
    for p in paths:
        m, beige, mud, mean_luma, spread, rms_c = measure(p)
        ms.append(m)
        beiges.append(beige)
        spreads.append(spread)
        print(f"{p}: colourfulness {m:5.1f}  beige {beige:5.1%}  mud {mud:5.1%}  mean luma {mean_luma:5.1f}  value spread {spread:5.1f}  rms contrast {rms_c:4.1f}")
    mean_m, mean_beige = float(np.mean(ms)), float(np.mean(beiges))
    mean_spread = float(np.mean(spreads))
    print(f"MEAN: colourfulness {mean_m:.1f}  beige {mean_beige:.1%}  spread {mean_spread:.1f}")
    ok = ((min_m is None or mean_m >= min_m) and (max_beige is None or mean_beige <= max_beige)
          and (min_spread is None or mean_spread >= min_spread))
    if not ok:
        print(f"FAIL: want colourfulness >= {min_m}, beige <= {max_beige}, spread >= {min_spread}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
