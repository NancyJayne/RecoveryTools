import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

root = Path("qa-v7-all-sheets")
manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
font = ImageFont.load_default()
card_w, card_h = 420, 240
cols, per_page = 3, 15

for page_index in range(math.ceil(len(manifest) / per_page)):
    rows = math.ceil(min(per_page, len(manifest) - page_index * per_page) / cols)
    canvas = Image.new("RGB", (cols * card_w, rows * card_h), "white")
    draw = ImageDraw.Draw(canvas)
    for offset, entry in enumerate(manifest[page_index * per_page:(page_index + 1) * per_page]):
        col, row = offset % cols, offset // cols
        x, y = col * card_w, row * card_h
        image = Image.open(root / entry["fileName"]).convert("RGB")
        image.thumbnail((card_w - 16, card_h - 38))
        paste_x = x + (card_w - image.width) // 2
        paste_y = y + 28 + (card_h - 38 - image.height) // 2
        canvas.paste(image, (paste_x, paste_y))
        draw.rectangle((x, y, x + card_w - 1, y + card_h - 1), outline="#9CA3AF")
        draw.text((x + 8, y + 7), f'{entry["index"]:02d}. {entry["name"]}', fill="#111827", font=font)
    canvas.save(root / f"contact-{page_index + 1}.png")

print(f"Created {math.ceil(len(manifest) / per_page)} contact sheets.")
