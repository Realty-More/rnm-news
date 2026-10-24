"""App icons and header logos from the RealtyNMore brand files in ../interview-1014."""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT.parent / "interview-1014"
OUT = ROOT / "public"
CHARCOAL = (20, 20, 22, 255)  # #141416

icon = Image.open(SRC / "assets" / "rm_icon.png").convert("RGBA")
icon = icon.crop(icon.getbbox())


def square(size: int, fill: float) -> Image.Image:
    """r&m mark centred on charcoal; `fill` = share of the canvas the mark may use."""
    canvas = Image.new("RGBA", (size, size), CHARCOAL)
    box = int(size * fill)
    mark = icon.copy()
    mark.thumbnail((box, box), Image.LANCZOS)
    canvas.alpha_composite(mark, ((size - mark.width) // 2, (size - mark.height) // 2))
    return canvas


(OUT / "icons").mkdir(parents=True, exist_ok=True)
square(192, 0.72).save(OUT / "icons" / "icon-192.png", optimize=True)
square(512, 0.72).save(OUT / "icons" / "icon-512.png", optimize=True)
square(512, 0.56).save(OUT / "icons" / "maskable-512.png", optimize=True)  # inside the 80% safe zone
square(180, 0.70).convert("RGB").save(OUT / "icons" / "apple-touch-icon.png", optimize=True)
square(48, 0.80).save(OUT / "icons" / "favicon-48.png", optimize=True)
square(1024, 0.56).save(ROOT / "scripts" / "icon-1024.png")  # source for Android launcher icons

(OUT / "brand").mkdir(exist_ok=True)
for name in ("logo.png", "logo_white.png"):
    logo = Image.open(SRC / "brand" / "assets" / name).convert("RGBA")
    logo = logo.crop(logo.getbbox())
    logo.thumbnail((420, 240), Image.LANCZOS)
    logo.save(OUT / "brand" / name, optimize=True)
print("icons written")

# Monochrome status-bar badge for notifications (Android shows only the alpha shape).
badge = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
shape = icon.copy()
shape.thumbnail((76, 76), Image.LANCZOS)
badge.paste(Image.new("RGBA", shape.size, (255, 255, 255, 255)), ((96 - shape.width) // 2, (96 - shape.height) // 2), shape.split()[3])
badge.save(OUT / "icons" / "badge-96.png", optimize=True)
