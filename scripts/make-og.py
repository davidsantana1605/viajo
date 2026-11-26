"""Genera public/og.png (1200x630) para Open Graph. Uso: python scripts/make-og.py (requiere Pillow)."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

W, H = 1200, 630
FB = next((p for p in ('C:/Windows/Fonts/segoeuib.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf') if os.path.exists(p)), None)
FR = next((p for p in ('C:/Windows/Fonts/segoeui.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf') if os.path.exists(p)), None)
f = lambda p, s: ImageFont.truetype(p, s)

# fondo tipo mapa claro (crema) con calles
img = Image.new('RGB', (W, H), (243, 240, 233))
d = ImageDraw.Draw(img)
for x in range(-200, W + 200, 150):
    d.line([(x, 0), (x + 260, H)], fill=(228, 224, 214), width=14)
for y in range(40, H, 130):
    d.line([(0, y), (W, y - 60)], fill=(228, 224, 214), width=14)
d.line([(560, 700), (760, 420), (960, 360), (1300, 120)], fill=(0, 122, 255), width=22, joint='curve')
for p in ((760, 420), (960, 360)):
    d.ellipse([p[0] - 16, p[1] - 16, p[0] + 16, p[1] + 16], fill='white', outline=(0, 122, 255), width=7)

# tarjeta de vidrio
card = Image.new('RGBA', (W, H), (0, 0, 0, 0))
sh = Image.new('RGBA', (W, H), (0, 0, 0, 0))
ImageDraw.Draw(sh).rounded_rectangle([70, 90, 720, 560], 44, fill=(0, 0, 0, 70))
img.paste(sh.filter(ImageFilter.GaussianBlur(26)), (0, 14), sh.filter(ImageFilter.GaussianBlur(26)))
ImageDraw.Draw(card).rounded_rectangle([70, 80, 720, 550], 44, fill=(255, 255, 255, 220))
img = Image.alpha_composite(img.convert('RGBA'), card)
d = ImageDraw.Draw(img)

# ícono de la app
d.rounded_rectangle([120, 125, 250, 255], 34, fill=(0, 122, 255))
d.rounded_rectangle([150, 153, 220, 225], 12, fill='white')
d.rounded_rectangle([158, 161, 212, 189], 6, fill=(0, 122, 255))
d.ellipse([162, 199, 174, 211], fill=(0, 122, 255)); d.ellipse([196, 199, 208, 211], fill=(0, 122, 255))

d.text((116, 262), 'Viajo', font=f(FB, 112), fill=(28, 28, 30))
d.text((124, 420), 'Colectivos de Rosario en vivo', font=f(FR, 40), fill=(60, 60, 67))
d.text((124, 478), 'Planificá, seguí y compartí tu viaje', font=f(FR, 28), fill=(110, 110, 115))

# chips de líneas
x = 790
for t, c in (('101', (0, 0, 0)), ('K', (236, 28, 36)), ('129', (0, 122, 255)), ('35/9', (48, 197, 82))):
    w = d.textlength(t, font=f(FB, 40)) + 44
    d.rounded_rectangle([x, 150 + (0 if len(t) < 5 else 0), x + w, 210], 18, fill=c)
    d.text((x + 22, 154), t, font=f(FB, 40), fill='white')
    x += w + 14
    if x > 1100:
        break

img.convert('RGB').save(os.path.join(os.path.dirname(__file__), '..', 'public', 'og.png'), optimize=True)
print('ok')
