"""Perceptual hash (dHash, 64 bits) of images, for matching an Instagram cover
to the /cut reel it came from. Resized to 9x8 grayscale; each bit says whether
a pixel is brighter than its right neighbour, so the hash survives Instagram's
recompression and resizing.

  ~/.venvs/reels/bin/python scripts/scale/dhash.py img1.jpg img2.png …

Prints one JSON line per image: {"path": "...", "hash": "16 hex chars"} (hash null if unreadable).
"""
import json, sys
from PIL import Image


def dhash(path):
    im = Image.open(path).convert('L').resize((9, 8), Image.LANCZOS)
    px = list(im.tobytes())
    bits = 0
    for row in range(8):
        for col in range(8):
            left, right = px[row * 9 + col], px[row * 9 + col + 1]
            bits = (bits << 1) | (1 if left > right else 0)
    return f'{bits:016x}'


for p in sys.argv[1:]:
    try:
        h = dhash(p)
    except Exception:
        h = None
    print(json.dumps({'path': p, 'hash': h}))
