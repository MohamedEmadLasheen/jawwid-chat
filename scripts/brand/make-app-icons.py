#!/usr/bin/env python3
"""PD-56 PR-G: the app icon and launch masters, composed from the owner's original logo.

Owner, 2026-11-03: "Please use our original logo and brand identity to create professional
app icons for both iOS and Android. Preserve the original logo design and brand colors. Do
not invent a new logo or alter the Arabic spelling."

Source: assets/brand/source/jawwid-logo-original.jpg (567x425, sha256 32907c53...0dd90cec),
byte-identical to apps/admin-web's brand/jawwid-logo.jpg.

Only what the department head allowed is done to it: trim the WHITE margin (never the mark),
scale with Lanczos (no sharpening), centre and pad on white (the logo's own background), and,
for the transparent layers, turn near-white pixels transparent by a threshold -- every logo
pixel keeps its exact colour. Nothing is redrawn, traced, recoloured or reshaped.

Writes the masters into assets/brand/ ; flutter_launcher_icons and flutter_native_splash
(pubspec dev dependencies) turn them into every platform size:

  app-icon-1024.png           opaque, the lockup at 78% width on white (iOS)
  play-store-icon-512.png     the same at 512 (Google Play's listing icon, uploaded by hand)
  adaptive-foreground-1024.png transparent, the lockup inside Android's 66% safe circle
  splash-logo.png             transparent lockup for the launch screen (4x density)
  splash-android12-1152.png   transparent, the lockup inside Android 12's splash circle

Run (Pillow required; nothing here is a network or shell call):
  python3 -m venv /tmp/v && /tmp/v/bin/pip install Pillow
  /tmp/v/bin/python scripts/brand/make-app-icons.py [--preview DIR]
"""
import argparse
import os

from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SOURCE = os.path.join(ROOT, "assets", "brand", "source", "jawwid-logo-original.jpg")
OUT = os.path.join(ROOT, "assets", "brand")
WHITE = (255, 255, 255)
# A pixel is the logo's when its darkest channel is under this; between it and white the
# alpha ramps down. Teal (#185060) and gold (#D8A850) are far below it, so they stay opaque.
INK = 200
PAPER = 248


def logo_box(im: Image.Image) -> tuple[int, int, int, int]:
    """The smallest box holding every non-white pixel: only white margin falls outside it."""
    px = im.load()
    w, h = im.size
    xs, ys = [], []
    for y in range(h):
        for x in range(w):
            if min(px[x, y]) < PAPER:
                xs.append(x)
                ys.append(y)
    return min(xs), min(ys), max(xs) + 1, max(ys) + 1


def scaled_logo(width: int) -> Image.Image:
    src = Image.open(SOURCE).convert("RGB")
    logo = src.crop(logo_box(src))
    height = round(logo.height * width / logo.width)
    return logo.resize((width, height), Image.LANCZOS)


def with_alpha(rgb: Image.Image) -> Image.Image:
    """White becomes transparent; logo pixels keep their colour and full opacity."""
    rgba = rgb.convert("RGBA")
    px = rgba.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            r, g, b, _ = px[x, y]
            darkest = min(r, g, b)
            if darkest <= INK:
                a = 255
            elif darkest >= PAPER:
                a = 0
            else:
                a = round(255 * (PAPER - darkest) / (PAPER - INK))
            px[x, y] = (r, g, b, a)
    return rgba


def centred(canvas: int, logo: Image.Image, background) -> Image.Image:
    mode = "RGB" if background is not None else "RGBA"
    out = Image.new(mode, (canvas, canvas), background if background is not None else (255, 255, 255, 0))
    at = ((canvas - logo.width) // 2, (canvas - logo.height) // 2)
    out.paste(logo, at, logo if logo.mode == "RGBA" else None)
    return out


def inscribed_width(diameter: float, aspect: float) -> int:
    """The widest box of this aspect that fits a circle of this diameter."""
    return int(diameter / (1 + 1 / aspect**2) ** 0.5)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", help="also write a contact sheet and Android mask previews here")
    args = ap.parse_args()

    src = Image.open(SOURCE).convert("RGB")
    x0, y0, x1, y1 = logo_box(src)
    aspect = (x1 - x0) / (y1 - y0)

    # iOS / Play Store: opaque, no alpha (Apple refuses an icon with an alpha channel).
    icon = centred(1024, scaled_logo(round(1024 * 0.78)), WHITE)
    icon.save(os.path.join(OUT, "app-icon-1024.png"), optimize=True)
    # Google Play's store listing icon: 512x512, 32-bit PNG.
    icon.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, "play-store-icon-512.png"), optimize=True)

    # Android adaptive foreground: 108dp canvas, safe zone a 66dp circle (61%); 0.95 of it
    # leaves a hair of room for the launcher's own inset.
    fg_width = inscribed_width(1024 * 66 / 108 * 0.95, aspect)
    foreground = centred(1024, with_alpha(scaled_logo(fg_width)), None)
    foreground.save(os.path.join(OUT, "adaptive-foreground-1024.png"), optimize=True)

    # Launch screen: shown at 1/4 of its pixel size (flutter_native_splash's 4x); ~210dp wide.
    with_alpha(scaled_logo(840)).save(os.path.join(OUT, "splash-logo.png"), optimize=True)

    # Android 12+: the splash icon sits in a circle of 2/3 of its 1152px canvas.
    a12 = centred(1152, with_alpha(scaled_logo(inscribed_width(1152 * 2 / 3 * 0.95, aspect))), None)
    a12.save(os.path.join(OUT, "splash-android12-1152.png"), optimize=True)

    if args.preview:
        preview(args.preview, icon, foreground)


def preview(folder: str, icon: Image.Image, foreground: Image.Image) -> None:
    os.makedirs(folder, exist_ok=True)
    sizes = [1024, 180, 120, 60, 48]
    pad = 24
    full_fg = Image.new("RGB", (1024, 1024), WHITE)
    full_fg.paste(foreground, (0, 0), foreground)
    rows = [("ios-option-1", icon), ("android-option-2", full_fg)]
    width = sum(sizes) + pad * (len(sizes) + 1)
    sheet = Image.new("RGB", (width, (1024 + pad) * len(rows) + pad), (230, 230, 230))
    y = pad
    for _, img in rows:
        x = pad
        for s in sizes:
            sheet.paste(img.resize((s, s), Image.LANCZOS), (x, y))
            x += s + pad
        y += 1024 + pad
    sheet.save(os.path.join(folder, "contact-sheet.png"))
    for s in sizes:
        icon.resize((s, s), Image.LANCZOS).save(os.path.join(folder, f"ios-{s}.png"))
    # Android launcher masks: a circle and a squircle (superellipse) over the adaptive icon.
    for name, draw_mask in (("circle", circle_mask), ("squircle", squircle_mask)):
        mask = draw_mask(1024)
        masked = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
        masked.paste(full_fg, (0, 0), mask)
        backdrop = Image.new("RGB", (1024, 1024), (90, 90, 90))
        backdrop.paste(masked, (0, 0), masked)
        backdrop.save(os.path.join(folder, f"android-{name}-1024.png"))
        backdrop.resize((48, 48), Image.LANCZOS).save(os.path.join(folder, f"android-{name}-48.png"))


def circle_mask(n: int) -> Image.Image:
    m = Image.new("L", (n, n), 0)
    ImageDraw.Draw(m).ellipse((0, 0, n - 1, n - 1), fill=255)
    return m


def squircle_mask(n: int, p: float = 4.0) -> Image.Image:
    m = Image.new("L", (n, n), 0)
    px = m.load()
    r = n / 2
    for y in range(n):
        for x in range(n):
            if abs((x - r) / r) ** p + abs((y - r) / r) ** p <= 1:
                px[x, y] = 255
    return m


if __name__ == "__main__":
    main()
