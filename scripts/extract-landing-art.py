"""
חילוץ שבעת האיורים של מסך הפתיחה מתוך הקולאז' (רקע לבן) לקובצי WebP שקופים.
הרצה: python3 scripts/extract-landing-art.py <collage.png> [out_dir] [qc_dir]
דורש Pillow ו-numpy בלבד. הקולאז' עצמו לא נשמר בריפו.
"""
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else 'public/landing'
QC = sys.argv[3] if len(sys.argv) > 3 else None

# אזורי האיורים בקולאז' (1536x1024). כל רכיב משויך לאזור שמכיל את מרכז הכובד שלו.
REGIONS = {
    'pickles': (30, 10, 410, 460),
    'coffee': (490, 0, 840, 390),
    'fish': (865, 5, 1480, 445),
    'marhaba': (440, 420, 800, 610),
    'kiddush': (5, 470, 290, 910),
    'swimmer': (210, 570, 1065, 1015),
    'medic': (1095, 410, 1515, 1005),
}
LONG_SIDE = 360  # מספיק לתצוגה ברוחב ~110px במחשב בצפיפות 3x
STEAM = 'coffee'

im = Image.open(SRC).convert('RGB')
W, H = im.size
sx, sy = W / 1536, H / 1024
rgb = np.asarray(im).astype(np.float32)
mn = rgb.min(axis=2)
spread = rgb.max(axis=2) - mn

# 1. רקע: פיקסלים כמעט לבנים ואפורים, המחוברים לשולי התמונה
cand = (mn >= 232) & (spread <= 16)
mask = Image.fromarray(np.where(cand, 255, 0).astype(np.uint8))
for x in range(0, W, 8):
    for y in (0, H - 1):
        if mask.getpixel((x, y)) == 255:
            ImageDraw.floodfill(mask, (x, y), 128)
for y in range(0, H, 8):
    for x in (0, W - 1):
        if mask.getpixel((x, y)) == 255:
            ImageDraw.floodfill(mask, (x, y), 128)
m = np.asarray(mask)
bg = m == 128

# 2. ״חורים״ לבנים טהורים וגדולים בתוך איור (רווחים בין יד לגוף וכו') — גם הם רקע
hole = (m == 255) & (mn >= 246) & (spread <= 8)
fg = ~bg


def label(binary):
    """תיוג רכיבים קשירים (8-שכנות) — BFS פשוט על מערך מוקטן."""
    h, w = binary.shape
    lab = np.zeros((h, w), np.int32)
    n = 0
    for y0, x0 in zip(*np.nonzero(binary)):
        if lab[y0, x0]:
            continue
        n += 1
        lab[y0, x0] = n
        q = deque([(y0, x0)])
        while q:
            y, x = q.popleft()
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < h and 0 <= xx < w and binary[yy, xx] and not lab[yy, xx]:
                        lab[yy, xx] = n
                        q.append((yy, xx))
    return lab, n


hl, hn = label(hole[::2, ::2])
for i in range(1, hn + 1):
    ys, xs = np.nonzero(hl == i)
    if len(ys) >= 120:  # ~480px בגודל מלא
        sub = np.zeros_like(hole)
        sub[::2, ::2] = hl == i
        sub = np.asarray(Image.fromarray(sub.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(3))) > 0
        bg |= sub & hole
fg = ~bg

# 3. שיוך רכיבים לאיורים
small = fg[::2, ::2]
lab, n = label(small)
owner = np.full(n + 1, -1)
names = list(REGIONS)
for i in range(1, n + 1):
    ys, xs = np.nonzero(lab == i)
    cy, cx = ys.mean() * 2 / sy, xs.mean() * 2 / sx
    for k, (x0, y0, x1, y1) in enumerate(REGIONS.values()):
        if x0 <= cx <= x1 and y0 <= cy <= y1:
            owner[i] = k
            break
# רכיבים קטנים (טיפות, אדים) — לאיור שהרכיב הראשי שלו הכי קרוב, ולא לפי מלבן האזור
areas = np.bincount(lab.ravel(), minlength=n + 1)
mains = {}
for k in range(len(names)):
    ids = np.nonzero(owner == k)[0]
    if len(ids):
        mi = ids[np.argmax(areas[ids])]
        pys, pxs = np.nonzero(lab == mi)
        step = max(1, len(pys) // 4000)
        mains[k] = (mi, np.stack([pys[::step], pxs[::step]], 1).astype(np.float32))
main_ids = {mi for mi, _ in mains.values()}
for i in range(1, n + 1):
    if i in main_ids or areas[i] > 4000:
        continue
    ys, xs = np.nonzero(lab == i)
    p = np.array([ys.mean(), xs.mean()], np.float32)
    owner[i] = min(mains, key=lambda k: np.min(np.sum((mains[k][1] - p) ** 2, axis=1)))
full_lab = np.repeat(np.repeat(lab, 2, axis=0), 2, axis=1)[:H, :W]
# פיקסלים בחזית שלא קיבלו תווית (בגלל ההקטנה) — לפי השכן
full_lab = np.where(fg, full_lab, 0)
own = owner[full_lab]
own[~fg] = -1

# מרחק מהרקע (בפיקסלים) — לשוליים רכים
dist = np.zeros((H, W), np.float32)
cur = Image.fromarray((bg * 255).astype(np.uint8))
for d in range(1, 4):
    cur = cur.filter(ImageFilter.MaxFilter(3))
    reach = (np.asarray(cur) > 0) & (dist == 0) & fg
    dist[reach] = d
dist[(dist == 0) & fg] = 9

os_ = __import__('os')
os_.makedirs(OUT, exist_ok=True)
sheet = []
for k, name in enumerate(names):
    x0, y0, x1, y1 = [int(v * (sx if i % 2 == 0 else sy)) for i, v in enumerate(REGIONS[name])]
    sel = own == k
    ys, xs = np.nonzero(sel)
    bx0, bx1 = max(xs.min() - 4, 0), min(xs.max() + 5, W)
    by0, by1 = max(ys.min() - 4, 0), min(ys.max() + 5, H)
    c = rgb[by0:by1, bx0:bx1]
    s = sel[by0:by1, bx0:bx1]
    dd = dist[by0:by1, bx0:bx1]
    cmin = c.min(axis=2)
    # alpha: פנים האיור אטום; בשוליים — לפי המרחק מלבן
    edge_alpha = np.clip((255 - cmin) / 48, 0, 1)
    alpha = np.where(dd >= 3, 1.0, np.where(dd == 2, np.maximum(edge_alpha, 0.85), edge_alpha))
    alpha = np.where(s, alpha, 0.0)
    if name == STEAM:
        # האדים: לבן-אפור חצי שקוף על לבן — שקיפות לפי הכהות, מעל הכוס בלבד
        top = int((150 - 0) * sy) - by0
        reg = np.zeros_like(s)
        reg[: max(top, 0), :] = True
        steam = reg & (cmin < 250) & (cmin > 150)
        sa = np.clip((252 - cmin) / 70, 0, 1) * 0.95
        alpha = np.where(reg, np.where(steam, np.maximum(alpha * 0, sa), 0), alpha)
    # הסרת הילה לבנה: c = (c - (1-a)*255) / a
    a3 = np.maximum(alpha, 1e-3)[..., None]
    col = np.clip((c - (1 - a3) * 255) / a3, 0, 255)
    if name == STEAM:
        col = np.where((np.arange(c.shape[0])[:, None, None] < top) & (alpha[..., None] > 0), np.full_like(col, 238), col)
    out = np.dstack([col, alpha * 255]).astype(np.uint8)
    img = Image.fromarray(out, 'RGBA')
    # חיתוך הדוק לפי alpha
    bbox = img.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    img = img.crop(bbox)
    scale = LONG_SIDE / max(img.size)
    if scale < 1:
        img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    img.save(f'{OUT}/{name}.webp', 'WEBP', quality=84, method=6)
    sheet.append((name, img))
    print(name, img.size, os_.path.getsize(f'{OUT}/{name}.webp') // 1024, 'KB')

if QC:
    os_.makedirs(QC, exist_ok=True)
    for bgname, colr in (('dark', (40, 30, 24)), ('cream', (246, 239, 226)), ('check', None)):
        sw = sum(i.width for _, i in sheet) + 20 * (len(sheet) + 1)
        sh = max(i.height for _, i in sheet) + 40
        canvas = Image.new('RGB', (sw, sh), colr or (255, 255, 255))
        if colr is None:
            d = ImageDraw.Draw(canvas)
            for yy in range(0, sh, 12):
                for xx in range(0, sw, 12):
                    if (xx // 12 + yy // 12) % 2:
                        d.rectangle([xx, yy, xx + 11, yy + 11], fill=(200, 60, 160))
        x = 20
        for _, i in sheet:
            canvas.paste(i, (x, 20), i)
            x += i.width + 20
        canvas.save(f'{QC}/qc-{bgname}.png')
