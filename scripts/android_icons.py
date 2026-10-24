"""Writes R&M launcher icons and splash screens into the Capacitor Android project.
Run after `npx cap add android` (npm run icons first if public/icons is missing)."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "android" / "app" / "src" / "main" / "res"
CHARCOAL = (20, 20, 22, 255)
mark = Image.open(ROOT.parent / "interview-1014" / "assets" / "rm_icon.png").convert("RGBA")
mark = mark.crop(mark.getbbox())


def place(size, fill, bg=CHARCOAL, w=None, h=None):
    w, h = w or size, h or size
    canvas = Image.new("RGBA", (w, h), bg)
    m = mark.copy()
    m.thumbnail((int(size * fill), int(size * fill)), Image.LANCZOS)
    canvas.alpha_composite(m, ((w - m.width) // 2, (h - m.height) // 2))
    return canvas


DENSITY = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
for name, k in DENSITY.items():
    d = RES / f"mipmap-{name}"
    legacy = int(48 * k)
    place(legacy, 0.70).save(d / "ic_launcher.png")
    rnd = place(legacy, 0.62)
    mask = Image.new("L", rnd.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, legacy - 1, legacy - 1), fill=255)
    rnd.putalpha(mask)
    rnd.save(d / "ic_launcher_round.png")
    fg = int(108 * k)  # adaptive icon: 108dp canvas, 66dp safe zone
    place(fg, 0.50, bg=(0, 0, 0, 0)).save(d / "ic_launcher_foreground.png")

(RES / "values" / "ic_launcher_background.xml").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#141416</color>\n</resources>\n',
    encoding="utf-8",
)

for splash in RES.glob("drawable*/splash.png"):
    w, h = Image.open(splash).size
    place(min(w, h), 0.28, w=w, h=h).convert("RGB").save(splash)
print("android icons + splash written")
