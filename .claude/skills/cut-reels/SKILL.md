---
name: cut-reels
description: Cut Radek's raw clips into finished, TEXT-FREE Instagram reels for @radek.spanish, @radek.explains.spanish and @loro.app (his clip sped up into the first 3 s, then the Loro demo at 1.5x) and drop them into the green "REELS <account> DONE" folders on his Desktop. He adds the hook in Instagram himself and reads the hook leaderboard on getloro.app/marketing. Use when Radek says "cut the reels", "cut my videos", "new batch", or drops clips into the REELS folders on his Desktop.
---

# Cut reels

Radek records. You cut. **No text** (Radek, 2026-11-13: views were low with our burned-in text, and "I know the
best which hooks work"). He types the hook in Instagram himself, adds music there, and posts. You don't pick hooks,
don't write lines, and don't plan with the scaler unless he asks for a plan.

What he needs from you, and nothing more:
1. the cut videos, in one DONE folder per channel next to the inbox folders;
2. the **hook leaderboard**: getloro.app/marketing (first tab, `#leaderboard`). It ranks the hooks read off the
   covers of what he actually posted, so it fills in by itself once `node scripts/scale/report.mts` (sync + enrich)
   has run. Run it at the end of every batch so the board is fresh.

Run everything from the loro checkout that has `scripts/cut/` (`~/loro-cut`). Python: `~/.venvs/reels/bin/python`
(Pillow). If it is missing: `python3 -m venv ~/.venvs/reels && ~/.venvs/reels/bin/pip install pillow`.

## Folders (all straight on the Desktop, tagged green)

| inbox (Radek drops clips) | done (you put finished reels) |
|---|---|
| `~/Desktop/REELS radek.spanish/` `me/` + `demo/` | `~/Desktop/REELS radek.spanish DONE/` |
| `~/Desktop/REELS radek.explains.spanish/` `me/` + `demo/` | `~/Desktop/REELS radek.explains.spanish DONE/` |
| `~/Desktop/REELS loro app/` `me/` + `demo/` (= @loro.app) | `~/Desktop/REELS loro app DONE/` |

Sorted by name, each DONE folder sits right under its inbox. A folder inside a folder was "super hidden" to him, and a
folder ending in `.app` shows as a broken app in Finder: never name one that. If a DONE folder is missing, recreate it
and copy the green label: `xattr -wx com.apple.FinderInfo "$(xattr -px com.apple.FinderInfo "<inbox>")" "<done>"`.
A DONE folder holds ONLY the finished videos, named `<YYYY-MM-DD> NN.mp4` (e.g. `2026-11-13 01.mp4`). The raw clips,
jobs, posters and meta go to the archive `<inbox>/cut/<YYYY-MM-DD>/`.

## The format (all three accounts)

| time | picture |
|---|---|
| 0–3 s | Radek's clip, the WHOLE clip sped up to fit 3 s (a 30 s clip plays at 10x) |
| 3–12 s | the demo, ALWAYS at 1.5x (render.py default, Radek 2026-11-11) |

Same timing as the text reels, so his hook fits the first 3 s and the demo shows the app doing its thing
(writing the words he hears, tapping a word for the translation).

## New batch

1. **Look at the inbox.** Pair `me/` and `demo/` in filename order (1st me with 1st demo…). If the counts differ, cut
   the pairs you have and tell him which files were left over. If he dropped clips loose in the folder, tell them apart
   by their frames (POV writing / him on camera = me, phone in the dark = demo). Probe each:
   `ffprobe -v error -show_entries format=duration,stream=color_transfer -of csv=p=0 <file>`.
2. **Watch every demo**: `ffmpeg -v error -y -i <demo> -vf "fps=1,scale=240:-2,tile=6x3" -frames:v 1 /tmp/x.png`.
   Pick `demo_from` so the 9 s that play (13.5 s of source at 1.5x) hold the action (him typing a word, tapping a word
   and its translation popping up), not the phone being picked up or set down.
3. **Watch every clip of Radek** the same way. Trim junk at the start/end (walking to the camera, reaching for the
   phone) with `me_from` / `me_to`.
4. **Archive the sources FIRST**: move them into `<inbox>/cut/<date>/me|demo/`, so the inbox is empty for the next
   batch and a recut finds them.
5. **Write one job per reel** in `<inbox>/cut/<YYYY-MM-DD>/NN.json`, absolute paths, NO `hook` and NO `lines`:
   ```json
   {"account": "radek.spanish", "batch": "2026-11-13", "slot": 1,
    "me": "/Users/macbook/Desktop/REELS radek.spanish/cut/2026-11-13/me/IMG_1.MOV",
    "demo": "/Users/macbook/Desktop/REELS radek.spanish/cut/2026-11-13/demo/IMG_2.MOV",
    "demo_from": 1.2,
    "out": "/Users/macbook/Desktop/REELS radek.spanish DONE/2026-11-13 01.mp4"}
   ```
   Optional: `"beat"` (his clip's seconds, 3), `"demo_len"` (demo seconds, 9), `me_from`/`me_to`, `demo_speed`.
   `demo_drop` is ignored without text. If a name is taken in DONE (a second batch the same day), keep counting up.
6. **Render**: `~/.venvs/reels/bin/python scripts/cut/render.py <job.json> …` (≈20 s each). The poster and meta land
   next to the job, so the DONE folder stays videos only.
7. **Check every reel yourself**: `ffmpeg -v error -y -i <out> -vf "fps=2,scale=200:-2,tile=8x3" -frames:v 1 /tmp/s.png`.
   Fail and fix it if the demo shows nothing happening for long stretches, the first 3 s are junk, colours look
   grey/washed (HDR source), or the reel isn't 12 s.
8. **Refresh the leaderboard**: `node scripts/scale/report.mts` (reads new covers of what he posted).
9. **Tell Radek** in a few lines: how many reels are in which DONE folder, any leftover clips, anything odd
   (an HLG clip, a dark demo).

Do NOT publish to getloro.app/cut any more (`publish.mts` is only for the old text reels).

## Hooks

He picks them. The leaderboard (`components/admin/scale/Leaderboard.tsx`) ranks hook families by median views vs
that channel's usual reel at the time: "Proven" = 3+ reels, then "Tried once or twice". If the cover reader garbles a
hook ("5000 FAST" for "SO FAST"), he fixes it on the Reels tab and that edit is kept. If he asks which hook to use,
answer from `node scripts/scale/report.mts --no-enrich`, winners in their proven wording.

## Old text reels (before 2026-11-13)

Text reels on /cut still get notes. Every Claude chat in loro waits for them in the background
(`node scripts/cut/wait-notes.mts`, started by the SessionStart hook `scripts/cut/session-start.sh`). On `CLAIMED`:
`node scripts/cut/notes.mts`, change the job, re-render, check, `node scripts/cut/publish.mts <job>` with
`"replies": {"<note id>": "what you changed"}`, then `wait-notes.mts --release` and start the waiter again. The text
style, for the record: hook 86px white with a black outline at top 282 (1120 when it would cover his face), lines 70px
at 256, Figtree 800; question hooks in straight double quotes with the emoji after the closing quote.

## Facts that cost time to learn

- iPhone clips are often HLG HDR (`color_transfer=arib-std-b67`). render.py tone-maps them with Apple's own pipeline
  (`scripts/cut/sdr.swift`, cached in ~/.cache/loro-cut/sdr). NEVER go back to ffmpeg's colorspace filter for HDR: it
  read HLG as plain gamma and blew out the bright areas (Radek, 2026-11-11: "kinda light up, something happened with
  the quality"). When checking a reel, compare an HDR clip's frame against `sdr.swift`'s output, not by eye alone.
- Radek films with HDR Video OFF since 2026-11-11 (Settings → Camera → Record Video). The SDR test reel looked "much
  better" to him than the Apple-tone-mapped HLG one. If a clip arrives as HLG anyway, still cut it, but remind him of
  the setting.
- **When the hook would cover his face** (2026-11-12: he stood close to the camera and his head sat behind the hook at
  top 282), set `"hook_top": 1120` so the hook sits over his legs, still above Instagram's caption area. Check the
  full-size hook frame of every reel, not only the contact sheet.
- "The demo looks dark" (Radek, 2026-11-11): measured, render.py does NOT darken SDR demos. Average luma was 35.15 in
  the source and 35.17 in the reel over the same 270 frames. The iPad demo was filmed at night (YAVG ~35/255), so it IS
  dark. Encoding is now x264 `-crf 15 -preset slow -tune film` + lanczos scaling (PSNR 46 dB vs the source, was 43 at
  crf 20). Check a "darker/worse" complaint by measuring source vs reel YAVG on the aligned region (shift by
  `demo_drop`) before changing anything. A dark demo is fixed by filming with the lights on, not by grading it.
- This Mac's ffmpeg has no `drawtext` and no `zscale`; text is drawn with Pillow (Figtree at weight 800, the closest
  free match to Instagram's text font; an `InstagramSans-Bold.ttf` next to render.py is used instead if present).
- The Mac is Intel: no CapCut/Edits desktop. Everything goes through ffmpeg.
- Videos live in the private `loro-cuts` bucket; the page gets 6-hour signed URLs (Refresh renews them).
