"""Render one Loro reel: Radek's clip sped up under the hook, then the app demo
with one line of text per beat. Text is burned in and drawn to look like
Instagram's own text tool (the "Classic" font, white; the hook gets the black
outline Radek uses). Silent output: the sound is added in Instagram.

  ~/.venvs/reels/bin/python scripts/cut/render.py job.json

job.json (paths relative to the job file unless absolute):
  {
    "me": "me/01.mov",            Radek's clip (any length; sped up to fit the hook beat)
    "demo": "demo/01.mov",        the Loro demo, filmed on the phone or screen-recorded
    "hook": "How did you learn 1000 Spanish words after just ONE month??😭",
    "lines": ["ummm by scrolling Spanish reels", "The app makes me write the words i hear",
              "and i tap the words i dont know to see the translation"],
    "out": "out/01.mp4",
    optional:
    "beat": 3,                    seconds per text (hook and each line); "slot" is the reel's place in the batch (publish.mts)
    "me_from": 0, "me_to": null,  part of Radek's clip to use (seconds)
    "demo_from": 0,               where the demo starts in the source
    "demo_speed": 1,              >1 plays the demo faster
    "hook_top": 282, "line_top": 256,   y of the first text line on the 1080x1920 frame
    "hook_size": 86, "line_size": 70,
    "hook_style": "outline", "line_style": "plain",
    "demo_drop": 0                slide the demo down N px (black fades in above) when the phone sits too high
  }

Timeline: hook 0..beat, then line i at beat*(i+1)..beat*(i+2). A line can also
be {"text": "...", "dur": 2.5} to hold it for its own length.

Writes <out> (1080x1920, 30 fps, H.264, no audio), <out>.jpg (a poster frame)
and <out>.json (the timings, read by scripts/cut/publish.mts).
"""
import json, os, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
W, H, FPS = 1080, 1920, 30
# Instagram's text tool uses Instagram Sans, which Meta does not license for
# this. Figtree (OFL) at a heavy weight is the closest free match. If
# InstagramSans-Bold.ttf is ever dropped next to this file, it wins.
IG_FONT = os.path.join(HERE, 'InstagramSans-Bold.ttf')
FIGTREE = os.path.join(HERE, 'Figtree.ttf')
EMOJI = '/System/Library/Fonts/Apple Color Emoji.ttc'
EMO = ImageFont.truetype(EMOJI, 160)  # Apple Color Emoji only has bitmap strikes; 160 is the biggest


def text_font(size):
    if os.path.exists(IG_FONT):
        return ImageFont.truetype(IG_FONT, size)
    f = ImageFont.truetype(FIGTREE, size)
    f.set_variation_by_axes([800])
    return f


# ---------- text ----------

def is_emoji(ch):
    o = ord(ch)
    return o >= 0x1F000 or 0x2600 <= o <= 0x27BF or o in (0xFE0F, 0x200D) or 0x1F1E6 <= o <= 0x1F1FF


def runs(text):
    out = []
    for ch in text:
        e = is_emoji(ch)
        if out and out[-1][0] == e:
            out[-1] = (e, out[-1][1] + ch)
        else:
            out.append((e, ch))
    return out


def emoji_tiles(s, size):
    s = s.replace('️', '')
    tiles, i = [], 0
    while i < len(s):
        g = s[i]
        if 0x1F1E6 <= ord(g) <= 0x1F1FF and i + 1 < len(s):
            g, i = s[i:i + 2], i + 2
        elif i + 2 < len(s) and s[i + 1] == '‍':  # ZWJ sequence: take the run
            j = i
            while j + 2 < len(s) and s[j + 1] == '‍':
                j += 2
            g, i = s[i:j + 1], j + 1
        else:
            i += 1
        im = Image.new('RGBA', (400, 200), (0, 0, 0, 0))
        ImageDraw.Draw(im).text((0, 0), g, font=EMO, embedded_color=True)
        bb = im.getbbox()
        if not bb:
            continue
        im = im.crop(bb)
        k = size * 1.15 / 160
        tiles.append(im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))), Image.LANCZOS))
    return tiles


_d = ImageDraw.Draw(Image.new('RGBA', (1, 1)))


def measure(line, f, size):
    w = 0
    for e, s in runs(line):
        if e:
            w += sum(t.width + int(size * 0.06) for t in emoji_tiles(s, size))
        else:
            w += _d.textlength(s, font=f)
    return int(w)


def greedy(para, f, size, maxw):
    lines, cur = [], ''
    for word in para.split(' '):
        t = (cur + ' ' + word).strip()
        if measure(t, f, size) <= maxw or not cur:
            cur = t
        else:
            lines.append(cur)
            cur = word
    lines.append(cur)
    return lines


def wrap(text, f, size, maxw):
    """Balanced wrap: as few lines as fit, then the narrowest width that still
    needs no more lines, so a hook breaks 2+2 words rather than 3+1, the way a
    person breaks it by hand in Instagram. A hand-typed \\n is kept."""
    lines = []
    for para in text.split('\n'):
        n = len(greedy(para, f, size, maxw))
        lo, hi = 200, maxw
        while hi - lo > 4:
            mid = (lo + hi) // 2
            if len(greedy(para, f, size, mid)) <= n:
                hi = mid
            else:
                lo = mid
        lines += greedy(para, f, size, hi)
    return lines


def draw_text(img, text, top, size, style, maxw=940, max_lines=3):
    """Centred, wrapped, Instagram-looking text on a transparent frame. Text
    that would need more than max_lines shrinks (down to 75%), the way Radek
    pinches a long hook smaller in Instagram."""
    floor = int(size * 0.75)
    while True:
        f = text_font(size)
        lines = wrap(text, f, size, maxw)
        if len(lines) <= max_lines or size <= floor:
            break
        size -= 2
    lh = int(size * 1.08)
    stroke = max(2, round(size * 0.065)) if style == 'outline' else 0
    d = ImageDraw.Draw(img)
    if style == 'plain':
        # Instagram's plain text carries a very soft shadow; it is what keeps
        # white legible on a bright patch of the demo.
        sh = Image.new('RGBA', img.size, (0, 0, 0, 0))
        sd = ImageDraw.Draw(sh)
        y = top
        for ln in lines:
            x = (W - measure(ln, f, size)) / 2
            for e, s in runs(ln):
                if e:
                    x += sum(t.width + int(size * 0.06) for t in emoji_tiles(s, size))
                else:
                    sd.text((x, y + 2), s, font=f, fill=(0, 0, 0, 90))
                    x += _d.textlength(s, font=f)
            y += lh
        img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(4)))
    y = top
    for ln in lines:
        x = (W - measure(ln, f, size)) / 2
        for e, s in runs(ln):
            if e:
                for t in emoji_tiles(s, size):
                    img.alpha_composite(t, (int(x), int(y + size * 0.02)))
                    x += t.width + int(size * 0.06)
            else:
                d.text((x, y), s, font=f, fill=(255, 255, 255, 255),
                       stroke_width=stroke, stroke_fill=(0, 0, 0, 255))
                x += _d.textlength(s, font=f)
        y += lh
    return img


def card(text, top, size, style, out):
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw_text(img, text, top, size, style)
    img.save(out)


# ---------- video ----------

def probe(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                        'stream=color_transfer:format=duration', '-of', 'json', path],
                       capture_output=True, text=True, check=True)
    j = json.loads(r.stdout)
    return float(j['format']['duration']), (j.get('streams') or [{}])[0].get('color_transfer', '')


def sdr(transfer):
    # iPhone records HLG HDR by default; without this the reel comes out grey and flat.
    if transfer in ('arib-std-b67', 'smpte2084'):
        return 'colorspace=all=bt709:iall=bt2020:itrc=bt2020-10:fast=0,'
    return ''


FIT = f'scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1'


def render(job_path):
    base = os.path.dirname(os.path.abspath(job_path))
    job = json.load(open(job_path))
    p = lambda k: job[k] if os.path.isabs(job[k]) else os.path.join(base, job[k])
    me, demo, out = p('me'), p('demo'), p('out')
    os.makedirs(os.path.dirname(out), exist_ok=True)

    beat = float(job.get('beat', 3))
    lines = [l if isinstance(l, dict) else {'text': l} for l in job['lines']]
    durs = [float(l.get('dur', beat)) for l in lines]
    demo_len = sum(durs)
    total = beat + demo_len

    me_dur, me_tr = probe(me)
    me_from = float(job.get('me_from', 0))
    me_to = float(job['me_to']) if job.get('me_to') is not None else me_dur
    me_speed = (me_to - me_from) / beat  # the whole chosen part plays inside the hook beat

    demo_dur, demo_tr = probe(demo)
    demo_from = float(job.get('demo_from', 0))
    demo_speed = float(job.get('demo_speed', 1))
    if (demo_dur - demo_from) / demo_speed < demo_len:
        # not enough demo for the lines: slow it down rather than run out
        demo_speed = (demo_dur - demo_from) / demo_len
        print(f'note: demo is short, playing it at {demo_speed:.2f}x')

    texts = [(job['hook'], 0.0, beat, job.get('hook_top', 282), job.get('hook_size', 86), job.get('hook_style', 'outline'))]
    t = beat
    for l, dur in zip(lines, durs):
        texts.append((l['text'], t, t + dur, l.get('top', job.get('line_top', 256)),
                      l.get('size', job.get('line_size', 70)), l.get('style', job.get('line_style', 'plain'))))
        t += dur

    tmp = tempfile.mkdtemp(prefix='reelcards_')
    pngs = []
    for i, (text, a, b, top, size, style) in enumerate(texts):
        pth = os.path.join(tmp, f'c{i}.png')
        card(text, top, size, style, pth)
        pngs.append((pth, a, b))

    # demo_drop: slide the demo down N px so the lines sit in clear dark space
    # above the phone; a black band fades into the footage on top.
    drop = int(job.get('demo_drop', 0))
    demo_chain = f'[1:v]trim={demo_from}:duration={demo_len * demo_speed},setpts=(PTS-STARTPTS)/{demo_speed},{sdr(demo_tr)}{FIT},fps={FPS},trim=duration={demo_len}'
    fc = [f'[0:v]trim={me_from}:{me_to},setpts=(PTS-STARTPTS)/{me_speed},{sdr(me_tr)}{FIT},fps={FPS},trim=duration={beat}[m]']
    first_card = 2
    if drop:
        fade = os.path.join(tmp, 'fade.png')
        g = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        for y in range(drop + 160):
            g.paste((0, 0, 0, 255 if y < drop else int(255 * (1 - (y - drop) / 160))), (0, y, W, y + 1))
        g.save(fade)
        first_card = 3
        fc += [f'{demo_chain}[dr]', f'color=black:s={W}x{H}:r={FPS}:d={demo_len}[blk]',
               f'[blk][dr]overlay=0:{drop}:shortest=1[dd]', '[dd][2:v]overlay=0:0[dm]']
    else:
        fc.append(f'{demo_chain}[dm]')
    fc.append('[m][dm]concat=n=2:v=1:a=0[v0]')
    last = 'v0'
    for i, (_, a, b) in enumerate(pngs):
        fc.append(f"[{last}][{i + first_card}:v]overlay=0:0:enable='between(t,{a:.3f},{b - 0.001:.3f})'[v{i + 1}]")
        last = f'v{i + 1}'
    cmd = ['ffmpeg', '-v', 'error', '-y', '-i', me, '-i', demo]
    if drop:
        cmd += ['-loop', '1', '-t', f'{total}', '-i', fade]
    for pth, _, _ in pngs:
        cmd += ['-loop', '1', '-t', f'{total}', '-i', pth]
    cmd += ['-filter_complex', ';'.join(fc), '-map', f'[{last}]', '-t', f'{total}',
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
            '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
            '-movflags', '+faststart', '-an', out]
    subprocess.run(cmd, check=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{min(1.0, beat / 2)}', '-i', out,
                    '-frames:v', '1', '-vf', 'scale=540:-2', '-q:v', '4', out + '.jpg'], check=True)
    meta = {
        'duration': round(total, 3),
        'hook': job['hook'],
        'lines': [{'text': x[0], 'from': round(x[1], 3), 'to': round(x[2], 3)} for x in texts[1:]],
        'me': os.path.basename(me), 'demo': os.path.basename(demo),
        'me_speed': round(me_speed, 2), 'demo_speed': round(demo_speed, 2),
    }
    json.dump(meta, open(out + '.json', 'w'), ensure_ascii=False, indent=1)
    print('wrote', out, f'({total:.1f}s, me {me_speed:.1f}x)')


if __name__ == '__main__':
    if sys.argv[1] == 'card':
        # quick look at text alone: render.py card "text" top size style out.png [background.png]
        _, _, text, top, size, style, out, *bg = sys.argv
        img = Image.open(bg[0]).convert('RGBA').resize((W, H)) if bg else Image.new('RGBA', (W, H), (40, 40, 40, 255))
        draw_text(img, text.replace('\\n', '\n'), int(top), int(size), style)
        img.convert('RGB').save(out)
    else:
        for j in sys.argv[1:]:
            render(j)
