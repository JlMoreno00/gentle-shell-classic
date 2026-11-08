"""Render the README images in docs/.

Run: python3 scripts/docs-images.py <shots-dir>
Needs Pillow, Inter and JetBrains Mono Nerd Font in ~/Library/Fonts. <shots-dir> holds the
real VHS captures (1600x900): 46-before, 46-rail-float, 46-rail-neon, 46-top-neon, 46-panel,
main-before, main-experimental.
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

S = 2  # render at 2x for crisp text on HiDPI screens
FONTS = Path.home() / "Library/Fonts"
DOCS = Path(__file__).resolve().parent.parent / "docs"

BG = (11, 13, 18)
FG = (232, 234, 240)
MUTED = (139, 146, 163)
ACCENT = (138, 180, 248)
PINK = (236, 72, 153)
BORDER = (40, 45, 58)


def font(name: str, size: int, weight: int | None = None) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(str(FONTS / name), size * S)
    if weight is not None:
        try:
            f.set_variation_by_axes([14, weight])
        except Exception:
            pass
    return f


def px(v: float) -> int:
    return int(v * S)


SANS = "Inter-VariableFont_opsz,wght.ttf"
MONO = "JetBrainsMonoNerdFont-Regular.ttf"


def banner(shot: Image.Image) -> Image.Image:
    w, h = 1280, 400
    img = Image.new("RGB", (px(w), px(h)), BG)
    d = ImageDraw.Draw(img)
    for y in range(0, px(h), px(24)):
        for x in range(0, px(w), px(24)):
            d.point((x, y), fill=(26, 29, 38))
    d.text((px(56), px(96)), "gentle-shell-classic", font=font(SANS, 52, 800), fill=FG)
    d.text((px(58), px(176)), "The classic Gentle Shell look,", font=font(SANS, 24, 400), fill=MUTED)
    d.text((px(58), px(208)), "back on the new interface.", font=font(SANS, 24, 400), fill=MUTED)
    x = px(58)
    for label in ("Classic prompt frame", "float / neon cards", "/gentle-classic panel"):
        f = font(SANS, 15, 500)
        tw = d.textlength(label, font=f)
        d.rounded_rectangle((x, px(268), x + tw + px(28), px(302)), radius=px(17), fill=(20, 23, 31), outline=BORDER, width=S)
        d.text((x + px(14), px(276)), label, font=f, fill=FG)
        x += int(tw) + px(40)
    # Real capture of the classic prompt frame (neon), cropped to the conversation and prompt.
    crop = shot.crop((0, 560, 1060, 900))
    crop = crop.resize((px(560), int(px(560) * crop.height / crop.width)), Image.LANCZOS)
    cx, cy = px(w - 600), px(56)
    d.rounded_rectangle((cx - px(12), cy - px(40), cx + crop.width + px(12), cy + crop.height + px(12)), radius=px(14), fill=(17, 19, 26), outline=BORDER, width=S)
    for i, color in enumerate(((255, 95, 87), (254, 188, 46), (40, 200, 64))):
        d.ellipse((cx + px(6 + 20 * i), cy - px(26), cx + px(18 + 20 * i), cy - px(14)), fill=color)
    d.text((cx + crop.width // 2, cy - px(20)), "Gentle Shell · classic", font=font(SANS, 14, 500), fill=MUTED, anchor="mm")
    img.paste(crop, (cx, cy))
    return img


def labelled(rows: list[tuple[str, tuple[int, int, int], Image.Image]], width: int = 1200) -> Image.Image:
    """Stack captures under coloured labels, like the pi-orca-images before/after."""
    pad, label_h, gap = 24, 44, 20
    scaled = [(t, c, im.resize((width, int(width * im.height / im.width)), Image.LANCZOS)) for t, c, im in rows]
    height = pad + sum(label_h + im.height + gap for _, _, im in scaled) + pad - gap
    img = Image.new("RGB", (width + 2 * pad, height), (13, 15, 20))
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(str(FONTS / SANS), 22)
    try:
        f.set_variation_by_axes([14, 650])
    except Exception:
        pass
    y = pad
    for title, color, im in scaled:
        d.text((pad + 2, y + 8), title, font=f, fill=color)
        y += label_h
        d.rectangle((pad - 1, y - 1, pad + im.width, y + im.height), outline=BORDER)
        img.paste(im, (pad, y))
        y += im.height + gap
    return img


def main() -> None:
    shots = Path(sys.argv[1])
    load = lambda name: Image.open(shots / f"{name}.png").convert("RGB")
    DOCS.mkdir(exist_ok=True)
    banner(load("46-rail-neon")).save(DOCS / "banner.png", optimize=True)
    labelled([
        ("Gentle Shell 4.6", MUTED, load("46-before")),
        ("With gentle-shell-classic (rail layout, neon)", ACCENT, load("46-rail-neon")),
    ]).save(DOCS / "before-after.png", optimize=True)
    labelled([
        ("rail layout · float cards: Status rail kept, header below the prompt", ACCENT, load("46-rail-float")),
        ("top layout · neon cards: header on top, no Status rail", ACCENT, load("46-top-neon")),
    ]).save(DOCS / "layouts.png", optimize=True)
    labelled([("/gentle-classic", ACCENT, load("46-panel"))]).save(DOCS / "panel.png", optimize=True)
    labelled([
        ("Gentle Shell main (unified editor)", MUTED, load("main-before")),
        ("With the experimental editor patch (header on top, rail, classic prompt)", PINK, load("main-experimental")),
    ]).save(DOCS / "experimental.png", optimize=True)


if __name__ == "__main__":
    main()
