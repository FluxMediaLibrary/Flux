"""Generate the Roku channel's UI bitmaps (gradients, 9-patches, icons).

Run: python apps/roku/tools/gen-assets.py
Requires Pillow. Everything here is deterministic so the images can be
regenerated after a palette change instead of being hand-edited.
"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "src" / "images"
OUT.mkdir(parents=True, exist_ok=True)

CANVAS = (13, 15, 18)          # #0d0f12
ACCENT = (59, 130, 246)        # #3b82f6
FOCUS = (96, 165, 250)         # #60a5fa
WHITE = (255, 255, 255)


def nine_patch(name, size, draw_fn, stretch, padding=None):
    """Write a Roku 9-patch: 1px black markers on top/left (stretch) and
    right/bottom (padding). `stretch` = (x0, x1, y0, y1) inside the content."""
    w, h = size
    img = Image.new("RGBA", (w + 2, h + 2), (0, 0, 0, 0))
    content = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(content), w, h)
    img.paste(content, (1, 1))
    px = img.load()
    x0, x1, y0, y1 = stretch
    for x in range(x0 + 1, x1 + 1):
        px[x, 0] = (0, 0, 0, 255)
    for y in range(y0 + 1, y1 + 1):
        px[0, y] = (0, 0, 0, 255)
    px0, px1, py0, py1 = padding or stretch
    for x in range(px0 + 1, px1 + 1):
        px[x, h + 1] = (0, 0, 0, 255)
    for y in range(py0 + 1, py1 + 1):
        px[w + 1, y] = (0, 0, 0, 255)
    img.save(OUT / name)


def rounded(draw, w, h, radius, fill=None, outline=None, width=0):
    draw.rounded_rectangle((0, 0, w - 1, h - 1), radius=radius, fill=fill, outline=outline, width=width)


# Rounded white fills, tinted at runtime with Poster.blendColor.
nine_patch("pill.9.png", (64, 64), lambda d, w, h: rounded(d, w, h, 31, fill=WHITE + (255,)), (31, 33, 31, 33))
nine_patch("card.9.png", (48, 48), lambda d, w, h: rounded(d, w, h, 12, fill=WHITE + (255,)), (20, 28, 20, 28))
nine_patch("card-lg.9.png", (64, 64), lambda d, w, h: rounded(d, w, h, 20, fill=WHITE + (255,)), (28, 36, 28, 36))
# Focus ring: transparent inside, 5px stroke.
nine_patch("focus-ring.9.png", (64, 64), lambda d, w, h: rounded(d, w, h, 16, outline=FOCUS + (255,), width=5), (28, 36, 28, 36))
nine_patch("focus-ring-pill.9.png", (64, 64), lambda d, w, h: rounded(d, w, h, 31, outline=FOCUS + (255,), width=4), (31, 33, 31, 33))

# Vertical scrim: transparent at top → canvas at bottom (hero fade).
def vgrad(name, height, start_alpha=0, end_alpha=255, ease=2.2):
    img = Image.new("RGBA", (4, height))
    px = img.load()
    for y in range(height):
        t = (y / (height - 1)) ** ease
        a = int(start_alpha + (end_alpha - start_alpha) * t)
        for x in range(4):
            px[x, y] = CANVAS + (a,)
    img.save(OUT / name)

vgrad("scrim-bottom.png", 600)
vgrad("scrim-player.png", 320, 0, 235, 1.4)

# Horizontal scrim: canvas at left → transparent at right (hero text legibility).
img = Image.new("RGBA", (1200, 4))
px = img.load()
for x in range(1200):
    t = 1 - (x / 1199)
    a = int(255 * (t ** 1.6))
    for y in range(4):
        px[x, y] = CANVAS + (a,)
img.save(OUT / "scrim-left.png")

# Soft ambient glow for empty/static screens (radial accent haze).
glow = Image.new("RGBA", (1920, 1080), CANVAS + (255,))
gp = glow.load()
cx, cy, r = 380, 160, 1150
for y in range(1080):
    for x in range(0, 1920, 1):
        d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
        t = max(0.0, 1 - d / r)
        a = int(48 * t * t)
        gp[x, y] = (
            CANVAS[0] + (ACCENT[0] - CANVAS[0]) * a // 255,
            CANVAS[1] + (ACCENT[1] - CANVAS[1]) * a // 255,
            CANVAS[2] + (ACCENT[2] - CANVAS[2]) * a // 255,
            255,
        )
glow = glow.resize((960, 540), Image.LANCZOS)
glow.save(OUT / "canvas-glow.png")

# Icons (white, tinted at runtime).
def icon(name, draw_fn, size=64):
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(im), size)
    im.save(OUT / name)

icon("icon-play.png", lambda d, s: d.polygon([(20, 12), (52, 32), (20, 52)], fill=WHITE + (255,)))
icon("icon-check.png", lambda d, s: d.line([(14, 34), (27, 47), (50, 18)], fill=WHITE + (255,), width=7, joint="curve"))
icon("icon-search.png", lambda d, s: (d.ellipse((12, 12, 40, 40), outline=WHITE + (255,), width=6), d.line([(36, 36), (52, 52)], fill=WHITE + (255,), width=7)))
icon("icon-settings.png", lambda d, s: (d.ellipse((12, 12, 52, 52), outline=WHITE + (255,), width=6), d.ellipse((26, 26, 38, 38), fill=WHITE + (255,))))
icon("icon-chevron.png", lambda d, s: d.line([(24, 14), (42, 32), (24, 50)], fill=WHITE + (255,), width=6, joint="curve"))
icon("icon-pause.png", lambda d, s: (d.rectangle((16, 12, 27, 52), fill=WHITE + (255,)), d.rectangle((37, 12, 48, 52), fill=WHITE + (255,))))
icon("icon-tv.png", lambda d, s: (d.rounded_rectangle((8, 12, 56, 44), radius=6, outline=WHITE + (255,), width=5), d.line([(22, 54), (42, 54)], fill=WHITE + (255,), width=5)))

# Placeholders in the new palette.
ph = Image.new("RGBA", (342, 513), (33, 38, 45, 255))
d = ImageDraw.Draw(ph)
d.rounded_rectangle((121, 206, 221, 306), radius=50, outline=(80, 88, 100, 255), width=6)
d.polygon([(160, 236), (192, 256), (160, 276)], fill=(80, 88, 100, 255))
ph.save(OUT / "placeholder-poster.png")
pb = Image.new("RGBA", (1280, 720), (23, 26, 31, 255))
pb.save(OUT / "placeholder-backdrop.png")

print("assets written to", OUT)
