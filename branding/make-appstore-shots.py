"""App Store screenshots as ONE panorama: 7 panels of 1320x2868, cut from a
9240x2868 canvas, so they read as one picture side by side in the store.
Realistic iPhone frame (titanium band, bezel, Dynamic Island, buttons),
a flight route running through every panel, and Loro sitting on the seams."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops
import os, math

SRC = '/Users/macbook/loro'; OUT = '/Users/macbook/loro/branding/appstore'
PW, H, N = 1320, 2868, 7
W = PW * N
BG = (11, 15, 13); INK = (238, 242, 239); MUTED = (120, 140, 130)
GREEN = (94, 230, 168); BLUE = (87, 179, 242)
ROUNDED = '/System/Library/Fonts/SFNSRounded.ttf'; SFNS = '/System/Library/Fonts/SFNS.ttf'

def font(path, size, weight):
    f = ImageFont.truetype(path, size)
    try: f.set_variation_by_axes(weight if isinstance(weight, list) else [weight])
    except Exception: pass
    return f

SHOTS = [
    ('IMG_5165.PNG', ['Learn Spanish', 'from ', ('real people', GREEN)]),
    ('IMG_5164.PNG', ['Fill the gaps', ('while you watch', BLUE)]),
    ('IMG_5172.PNG', ['Tap any word,', ('save it for later', GREEN)]),
    ('IMG_5167.PNG', ['Every few words,', ('a new city', GREEN)]),
    ('IMG_5168.PNG', ['Travel the', ('Spanish-speaking', GREEN), 'world']),
    ('IMG_5171.PNG', ['A parrot that', ('cheers you on', GREEN)]),
    ('IMG_5169.PNG', ['Cartoons', ('in Spanish too', GREEN)]),
]

def lines_of(spec):
    out, cur = [], []
    for it in spec:
        if isinstance(it, str):
            if it.endswith(' '): cur.append((it, INK)); continue
            if cur: out.append(cur); cur = []
            out.append([(it, INK)])
        else:
            cur.append(it); out.append(cur); cur = []
    if cur: out.append(cur)
    return out


# ---------------------------------------------------------------- background
can = Image.new('RGB', (W, H), BG)
q = 8
glow = Image.new('RGBA', (W // q, H // q), (0, 0, 0, 0)); g = ImageDraw.Draw(glow)
for k in range(N):      # a quiet bloom behind each phone
    cx = (k + .5) * PW / q
    g.ellipse((cx - 600 / q, 1000 / q, cx + 600 / q, 2700 / q), fill=(52, 211, 153, 30))
glow = glow.filter(ImageFilter.GaussianBlur(26)).resize((W, H), Image.BICUBIC)
can.paste(glow, (0, 0), glow)

# ---------------------------------------------------------------- the route
# One unbroken flight path. It crosses EVERY seam in the gap between two
# phones, at alternating heights, with a node cut in half by the seam, so
# each pair of neighbours visibly shares a piece of it.
def catmull(pts, steps=60):
    out = []
    p = [pts[0]] + pts + [pts[-1]]
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
        for s in range(steps):
            t = s / steps
            out.append(tuple(.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t * t
                                   + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t ** 3) for j in (0, 1)))
    out.append(pts[-1]); return out

SEAM_Y = [2150, 640, 2200, 640, 2150, 640]
START, END = (78, 1500), (W - 78, 1900)
pts = [START, (PW * .5, 1900)]
for k, y in enumerate(SEAM_Y, 1):
    pts.append((PW * k, y))
    nxt = SEAM_Y[k] if k < len(SEAM_Y) else END[1]
    pts.append((PW * (k + .5), (y + nxt) / 2))
pts[-1] = (PW * (N - .5), 1650); pts.append(END)
route = catmull(pts, 120)

def stroke(width, rgba, blur=0, scale=1):
    l = Image.new('RGBA', (W // scale, H // scale), (0, 0, 0, 0))
    ImageDraw.Draw(l).line([(x / scale, y / scale) for x, y in route], fill=rgba, width=max(1, round(width / scale)), joint='curve')
    if blur: l = l.filter(ImageFilter.GaussianBlur(blur / scale))
    if scale > 1: l = l.resize((W, H), Image.BICUBIC)
    can.paste(l, (0, 0), l)

stroke(420, (52, 211, 153, 55), blur=120, scale=4)   # wide soft ribbon
stroke(44, GREEN + (90,), blur=20, scale=2)          # soft glow
lay = Image.new('RGBA', (W, H), (0, 0, 0, 0)); ld = ImageDraw.Draw(lay)
acc, on = 0.0, True                                  # a dashed map trail, not a neon tube
for a_, b_ in zip(route, route[1:]):
    if on: ld.line([a_, b_], fill=GREEN + (255,), width=14)
    acc += math.dist(a_, b_)
    if acc > (46 if on else 30): acc, on = 0.0, not on
can.paste(lay, (0, 0), lay)

# Flags as the stops: one planted on the trail at every seam, just inside the
# right-hand screenshot, so no flag is ever cut in half.
def y_on_route(x):
    best = min(route, key=lambda p: abs(p[0] - x)); return best[1]

def draw_flag(code, w, h):
    f = Image.new('RGB', (w, h), (255, 255, 255)); d_ = ImageDraw.Draw(f)
    if code == 'MX':
        d_.rectangle((0, 0, w / 3, h), fill=(0, 104, 71)); d_.rectangle((2 * w / 3, 0, w, h), fill=(206, 17, 38))
        d_.ellipse((w / 2 - h * .16, h / 2 - h * .16, w / 2 + h * .16, h / 2 + h * .16), fill=(140, 90, 40))
    elif code == 'CO':
        d_.rectangle((0, 0, w, h / 2), fill=(252, 209, 22)); d_.rectangle((0, h / 2, w, h * .75), fill=(0, 56, 147))
        d_.rectangle((0, h * .75, w, h), fill=(206, 17, 38))
    elif code == 'PE':
        d_.rectangle((0, 0, w / 3, h), fill=(217, 16, 35)); d_.rectangle((2 * w / 3, 0, w, h), fill=(217, 16, 35))
    elif code == 'AR':
        d_.rectangle((0, 0, w, h / 3), fill=(116, 172, 223)); d_.rectangle((0, 2 * h / 3, w, h), fill=(116, 172, 223))
        d_.ellipse((w / 2 - h * .11, h / 2 - h * .11, w / 2 + h * .11, h / 2 + h * .11), fill=(246, 180, 14))
    elif code == 'CU':
        for k in range(5): d_.rectangle((0, h * k / 5, w, h * (k + 1) / 5), fill=(0, 42, 143) if k % 2 == 0 else (255, 255, 255))
        d_.polygon([(0, 0), (w * .45, h / 2), (0, h)], fill=(207, 20, 43))
        cx, cy, r = w * .15, h / 2, h * .14
        d_.polygon([(cx + r * math.cos(math.radians(-90 + 72 * i * 2)) * (1 if True else 0), cy + r * math.sin(math.radians(-90 + 144 * i))) for i in range(5)], fill=(255, 255, 255))
    elif code == 'ES':
        d_.rectangle((0, 0, w, h), fill=(170, 21, 27)); d_.rectangle((0, h / 4, w, h * .75), fill=(241, 191, 0))
    return f

def plant(code, px, py):
    PH_, FW2, FH2 = 140, 118, 80
    pole_top = py - PH_
    # pole + a little base on the trail
    ld2 = ImageDraw.Draw(can)
    ld2.ellipse((px - 24, py - 24, px + 24, py + 24), fill=GREEN)
    ld2.ellipse((px - 11, py - 11, px + 11, py + 11), fill=BG)
    ld2.rounded_rectangle((px - 5, pole_top - 8, px + 5, py), 5, fill=(225, 230, 226))
    ld2.ellipse((px - 11, pole_top - 18, px + 11, pole_top + 4), fill=(255, 208, 84))
    # the flag, with a gentle wave and rounded corners
    fl = draw_flag(code, FW2, FH2).resize((FW2 * 2, FH2 * 2), Image.LANCZOS)
    waved = Image.new('RGBA', (FW2 * 2, FH2 * 2 + 40), (0, 0, 0, 0))
    shade = Image.new('RGBA', (1, 1))
    for x in range(fl.width):
        dy = round(14 * math.sin(x / fl.width * math.pi * 1.6))
        col = fl.crop((x, 0, x + 1, fl.height))
        lum = 1 + .12 * math.cos(x / fl.width * math.pi * 1.6)
        col = col.point(lambda v: min(255, round(v * lum)))
        waved.paste(col, (x, 20 + dy))
    m = Image.new('L', fl.size, 0); ImageDraw.Draw(m).rounded_rectangle((0, 0, fl.width - 1, fl.height - 1), 14, fill=255)
    mask = Image.new('L', waved.size, 0)
    for x in range(fl.width):
        dy = round(14 * math.sin(x / fl.width * math.pi * 1.6))
        mask.paste(m.crop((x, 0, x + 1, m.height)), (x, 20 + dy))
    waved.putalpha(mask)
    waved = waved.resize((FW2, FH2 + 20), Image.LANCZOS)
    sh = Image.new('RGBA', waved.size, (0, 0, 0, 0)); sh.putalpha(waved.getchannel('A').point(lambda a: a * 110 // 255))
    sh = sh.filter(ImageFilter.GaussianBlur(10))
    can.paste(sh, (px + 10, pole_top + 6), sh)
    can.paste(waved, (px + 4, pole_top - 10), waved)

FLAG_STOPS = ['MX', 'CO', 'PE', 'AR', 'CU', 'ES']
for k, code in enumerate(FLAG_STOPS, 1):
    x = PW * k + 22
    plant(code, x, round(y_on_route(x)))

lay = Image.new('RGBA', (W, H), (0, 0, 0, 0)); ld = ImageDraw.Draw(lay)
# a plane setting off at the start …
def plane(cx, cy, s, ang):
    shape = [(1, 0), (.25, .12), (-.15, .62), (-.32, .62), (-.1, .12), (-.62, .1), (-.78, .32), (-.9, .32),
             (-.8, 0), (-.9, -.32), (-.78, -.32), (-.62, -.1), (-.1, -.12), (-.32, -.62), (-.15, -.62), (.25, -.12)]
    c, sn = math.cos(ang), math.sin(ang)
    ld.polygon([(cx + s * (x * c - y * sn), cy + s * (x * sn + y * c)) for x, y in shape], fill=INK + (255,))
a = math.atan2(route[40][1] - route[0][1], route[40][0] - route[0][0])
ld.ellipse((START[0] - 70, START[1] - 70, START[0] + 70, START[1] + 70), fill=GREEN + (255,))
plane(START[0], START[1], 52, a)
# … and a pin where it lands
px_, py_ = END
ld.ellipse((px_ - 46, py_ - 150, px_ + 46, py_ - 58), fill=GREEN + (255,))
ld.polygon([(px_ - 40, py_ - 92), (px_ + 40, py_ - 92), (px_, py_ - 4)], fill=GREEN + (255,))
ld.ellipse((px_ - 18, py_ - 122, px_ + 18, py_ - 86), fill=BG + (255,))
can.paste(lay, (0, 0), lay)


# ---------------------------------------------------------------- the phone
SW = 930                         # screen width at 1x
SH = round(SW * 2532 / 1170)
S = 2                            # supersample the frame
RS, BZ, TI = round(SW * .14), 24, 13   # screen radius, black bezel, titanium band
FW, FH = SW + 2 * (BZ + TI), SH + 2 * (BZ + TI)
BTN = 8                          # how far buttons stick out

def iphone(shot_path):
    m = BTN + 4
    w, h = (FW + 2 * m) * S, (FH + 2 * m) * S
    ph = Image.new('RGBA', (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(ph)
    ox, oy = m * S, m * S
    def rr(x0, y0, x1, y1, r, **kw): d.rounded_rectangle((ox + x0 * S, oy + y0 * S, ox + x1 * S, oy + y1 * S), r * S, **kw)
    # side buttons, drawn first so the band overlaps their roots
    metal = (118, 121, 127)
    for y0, ln in ((.165, .04), (.235, .075), (.33, .075)):          # action, vol+, vol-
        rr(-BTN, FH * y0, 6, FH * (y0 + ln), 4, fill=metal)
    rr(FW - 6, FH * .265, FW + BTN, FH * .265 + FH * .115, 4, fill=metal)  # side button
    # titanium band: dark rim, bright brushed middle, dark inner edge
    R0 = RS + BZ + TI
    rr(0, 0, FW, FH, R0, fill=(70, 72, 77))
    rr(2, 2, FW - 2, FH - 2, R0 - 2, fill=(160, 163, 169))
    rr(5, 5, FW - 5, FH - 5, R0 - 5, fill=(108, 111, 117))
    rr(TI - 3, TI - 3, FW - TI + 3, FH - TI + 3, RS + BZ + 3, fill=(38, 39, 42))
    rr(TI, TI, FW - TI, FH - TI, RS + BZ, fill=(4, 4, 5))          # bezel
    # screen
    shot = Image.open(shot_path).convert('RGB')
    ImageDraw.Draw(shot).rectangle((0, 0, shot.width, 150), fill=shot.getpixel((30, 30)))  # old status bar out
    shot = shot.resize((SW * S, SH * S), Image.LANCZOS)
    sd = ImageDraw.Draw(shot)
    # Dynamic Island
    iw, ih, it = SW * .32, SW * .094, SW * .03
    cx = SW / 2; cy = it + ih / 2
    sd.rounded_rectangle(((cx - iw / 2) * S, it * S, (cx + iw / 2) * S, (it + ih) * S), ih / 2 * S, fill=(0, 0, 0))
    # status bar: 9:41, signal, wifi, battery — centred on the island
    tf = font(SFNS, round(SW * .047 * S), [100, 28, 400, 620])
    t = '9:41'; tw = sd.textlength(t, font=tf)
    bb = sd.textbbox((0, 0), t, font=tf)
    sd.text((SW * .165 * S - tw / 2, cy * S - (bb[1] + bb[3]) / 2), t, font=tf, fill=(255, 255, 255))
    u = SW * .0105 * S  # icon unit
    rx = SW * .9 * S; base = cy * S + 3.4 * u
    # battery
    bw, bh = 9.6 * u, 4.6 * u
    sd.rounded_rectangle((rx - bw, cy * S - bh / 2, rx, cy * S + bh / 2), 1.4 * u, outline=(255, 255, 255, ), width=max(2, round(.42 * u)))
    sd.rounded_rectangle((rx - bw + .9 * u, cy * S - bh / 2 + .9 * u, rx - bw + .9 * u + (bw - 1.8 * u) * .8, cy * S + bh / 2 - .9 * u), .7 * u, fill=(255, 255, 255))
    sd.rounded_rectangle((rx + .5 * u, cy * S - 1.1 * u, rx + 1.2 * u, cy * S + 1.1 * u), .4 * u, fill=(255, 255, 255))
    # wifi
    wx = rx - bw - 5.2 * u; wy = cy * S + 2.2 * u
    for k, r in enumerate((4.6, 3.1, 1.6)):
        rr_ = r * u
        if k < 2:
            sd.arc((wx - rr_, wy - rr_, wx + rr_, wy + rr_), 225, 315, fill=(255, 255, 255), width=round(1.05 * u))
        else:
            sd.pieslice((wx - rr_, wy - rr_, wx + rr_, wy + rr_), 225, 315, fill=(255, 255, 255))
    # signal
    sx = wx - 6.2 * u - 7 * u
    for k in range(4):
        bh_ = (1.6 + k * 1.05) * u
        sd.rounded_rectangle((sx + k * 1.85 * u, base - bh_ - 1.2 * u, sx + k * 1.85 * u + 1.3 * u, base - 1.2 * u), .35 * u, fill=(255, 255, 255))
    mask = Image.new('L', shot.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, shot.width - 1, shot.height - 1), RS * S, fill=255)
    ph.paste(shot, (ox + (TI + BZ) * S, oy + (TI + BZ) * S), mask)
    return ph.resize((w // S, h // S), Image.LANCZOS)

# ---------------------------------------------------------------- Loro
def cutout(path):
    im = Image.open(path).convert('RGB')
    fill = im.copy()
    for xy in ((0, 0), (im.width - 1, 0), (0, im.height - 1), (im.width - 1, im.height - 1)):
        ImageDraw.floodfill(fill, xy, (255, 0, 255), thresh=46)
    r, g, b = fill.split()
    bgm = ImageChops.multiply(r.point(lambda v: 255 if v == 255 else 0),
                              ImageChops.multiply(g.point(lambda v: 255 if v == 0 else 0), b.point(lambda v: 255 if v == 255 else 0)))
    alpha = ImageChops.invert(bgm).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    im.putalpha(alpha)
    return im.crop(im.getbbox())

def place_loro(img, cx, bottom, height, flip=False, shadow=True):
    m = img.transpose(Image.FLIP_LEFT_RIGHT) if flip else img
    m = m.resize((round(m.width * height / m.height), height), Image.LANCZOS)
    x, y = round(cx - m.width / 2), round(bottom - height)
    if shadow:
        sh = Image.new('RGBA', can.size, (0, 0, 0, 0))
        ImageDraw.Draw(sh).ellipse((cx - m.width * .38, bottom - 26, cx + m.width * .38, bottom + 26), fill=(0, 0, 0, 150))
        sh = sh.crop((x - 100, bottom - 140, x + m.width + 100, bottom + 140)).filter(ImageFilter.GaussianBlur(22))
        can.paste(sh, (x - 100, bottom - 140), sh)
    can.paste(m, (x, y), m)

waving = cutout(os.path.join(SRC, 'branding/loro-mascot-waving-source.png'))
standing = cutout(os.path.join(SRC, 'branding/loro-mascot-art-source.png'))

# ---------------------------------------------------------------- panels
cap = font(ROUNDED, 112, 720); TRACK = 5
d = ImageDraw.Draw(can)
PHONE_TOP = 690
phone_boxes = []
for i, (fn, spec) in enumerate(SHOTS):
    x0 = i * PW
    y = 170
    def tw(t): return sum(d.textlength(ch, font=cap) + TRACK for ch in t)
    for ln in lines_of(spec):
        widths = [tw(t) for t, _ in ln]; x = x0 + (PW - sum(widths) + TRACK) / 2
        for (t, c), w_ in zip(ln, widths):
            for ch in t:
                d.text((x, y), ch, font=cap, fill=c); x += d.textlength(ch, font=cap) + TRACK
        y += 138
    ph = iphone(os.path.join(SRC, fn))
    px = x0 + (PW - ph.width) // 2; py = PHONE_TOP if len(lines_of(spec)) < 3 else PHONE_TOP + 40
    sh = Image.new('RGBA', (ph.width + 240, ph.height + 240), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((120, 150, ph.width + 120, ph.height + 120), 190, fill=(0, 0, 0, 170))
    sh = sh.filter(ImageFilter.GaussianBlur(45))
    can.paste(sh, (px - 120, py - 120), sh)
    can.paste(ph, (px, py), ph)
    phone_boxes.append((px, py, ph.width, ph.height))
# Loro: inside single panels only, never across a seam
def loro_in(img, panel, side, height, flip=False, bottom=H - 36, pad=24):
    m = img.transpose(Image.FLIP_LEFT_RIGHT) if flip else img
    w_ = m.width * height / m.height
    cx = panel * PW + (PW - pad - w_ / 2 if side == 'right' else pad + w_ / 2)
    place_loro(img, cx, bottom, height, flip=flip)

loro_in(waving, 0, 'right', 560)               # 1: hello
loro_in(standing, 3, 'left', 440, flip=True)   # 4: arrived in Cusco, looking at the phone
loro_in(standing, 5, 'right', 560)             # 6: the parrot that cheers you on

OUT63 = OUT + '-6.3'
for d_ in (OUT, OUT63):
    os.makedirs(d_, exist_ok=True)
    for f in os.listdir(d_):
        if f.endswith('.png'): os.remove(os.path.join(d_, f))
for i, (fn, _) in enumerate(SHOTS):
    name = f'{i + 1:02d}-{fn.split(".")[0]}.png'
    panel = can.crop((i * PW, 0, (i + 1) * PW, H))
    panel.save(os.path.join(OUT, name), optimize=True)
    panel.resize((1206, 2622), Image.LANCZOS).save(os.path.join(OUT63, name), optimize=True)
    print(name)
prev = Image.new('RGB', (W // 5 + 12 * (N - 1), H // 5), (255, 255, 255))   # store-like gaps
for i in range(N):
    prev.paste(can.crop((i * PW, 0, (i + 1) * PW, H)).resize((PW // 5, H // 5), Image.LANCZOS), (i * (PW // 5 + 12), 0))
prev.save('/Users/macbook/loro/branding/appstore-panorama-preview.png')
