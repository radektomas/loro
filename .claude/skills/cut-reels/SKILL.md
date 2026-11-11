---
name: cut-reels
description: Cut Radek's raw clips into finished Instagram reels for @radek.spanish, @radek.explains.spanish and @loro.app (sped-up clip of him + hook, then the Loro demo with 3 lines, text burned in Instagram-style), publish them to getloro.app/cut, and recut from the notes he leaves there. Use when Radek says "cut the reels", "cut my videos", "new batch", "check the cut notes", "recut", or drops clips into the REELS folders on his Desktop.
---

# Cut reels

Radek records. You cut. He reviews on **getloro.app/cut**, where each reel plays inside an
Instagram Reels frame, and he leaves notes pinned to exact seconds. You read the notes and recut.
The text you burn in is FINAL: he posts the file as is, with music added in Instagram.

Run everything from the loro checkout that has `scripts/cut/` (branch `cut-tool`, worktree
`~/loro-cut`, until it is merged). Python: `~/.venvs/reels/bin/python` (Pillow). If it is
missing, run `python3 -m venv ~/.venvs/reels && ~/.venvs/reels/bin/pip install pillow`.

## The format (all three accounts)

| time | picture | text |
|---|---|---|
| 0–3 s | Radek's clip, the WHOLE clip sped up to fit 3 s (a 30 s clip plays at 10x) | the hook, white with a black outline |
| 3–6 s | the demo | line 1: how he learns |
| 6–9 s | the demo | line 2: the app makes him write the words he hears |
| 9–12 s | the demo | line 3: he taps words he doesn't know to see the translation |

Base lines (Radek, 2026-11-10). Adapt them to what the demo actually shows:
- line 1: "I learn by literally scrolling Spanish reels" / "I learn by literally watching Spanish Peppa Pig" /
  after a QUESTION hook, answer it: "ummm by scrolling Spanish reels", "mmm i started watching Spanish Peppa Pig"
- line 2: "The app makes me write the words i hear"
- line 3: "and i tap the words i dont know to see the translation"

Voice per account: @radek.spanish and @radek.explains.spanish speak as Radek ("I", "me").
@loro.app speaks to the viewer ("You learn by literally doomscrolling", "The app makes you write the words you hear").
A QUESTION hook is a viewer asking him, so it goes in straight double quotes with the emoji AFTER the closing
quote: `"How did you learn 1000 Spanish words after just ONE month??"😭` (Radek's note, 2026-11-11).
Keep his casual style: lowercase "i", no full stops, CAPS on one word for stress, one emoji at the end of the
hook with NO space before it (😭 💀 😳 🤯 😩). Lines carry no emoji, or at most one.

## New batch

0. **Plan first with the scaler** (`.claude/skills/scaler/SKILL.md`, Radek 2026-11-11): it reads what's winning,
   proposes a channel, hook and line 1 for every clip pair, and Radek approves on getloro.app/marketing#plan.
   Cut only approved items, with their hooks, and put `"plan_item_id"` in each job. Steps 1–3 below are still
   how you look at the clips; step 4 is replaced by the approved plan.
1. **Look at the inbox.** Three green folders sit straight on Radek's Desktop (he has ~100 files there, and a folder
   inside a folder was "super hidden"): `~/Desktop/REELS radek.spanish/`, `~/Desktop/REELS radek.explains.spanish/`,
   `~/Desktop/REELS loro app/` (= @loro.app; a folder ending in `.app` shows as a broken app in Finder, never name one
   that). Each has `me/` (clips of Radek) and `demo/` (demo clips). Pair them in filename order (1st me with 1st demo…). If the counts differ, cut the pairs
   you have and tell him which files were left over. Probe each: `ffprobe -v error -show_entries format=duration -of csv=p=0 <file>`.
2. **Watch every demo** before writing its lines. Make a contact sheet and read it:
   `ffmpeg -v error -y -i <demo> -vf "fps=1,scale=240:-2,tile=6x3" -frames:v 1 /tmp/x.png`.
   Note what is on the phone (reels? Peppa Pig? which word does he type, when does he tap a word?), and where
   the action is. The demo ALWAYS plays at 1.5x (render.py default, Radek 2026-11-11), so source second s lands
   at reel time 3 + (s − demo_from) / 1.5. Pick `demo_from` so writing lands under the writing line and tapping
   under the tapping line; if the clip's order doesn't allow that, reorder the lines to match the footage rather
   than slowing the demo down. If the phone's top edge is high in the frame, set
   `demo_drop` (100–200) so the lines sit on dark space above it.
3. **Watch every clip of Radek** the same way. If the start or end is junk (him walking to the camera,
   reaching for the phone), trim with `me_from` / `me_to`.
4. **Pick hooks** (only when Radek skips the scaler for a batch). `node scripts/cut/hooks.mts <account>`: take from the top (least used here, best score),
   never the same hook twice in one batch, and prefer hooks not used on the OTHER accounts in the last batch
   (Instagram demotes identical content across accounts). Match line 1 to the hook's kind (question → "ummm by…").
   New hooks Radek gives you go into `scripts/cut/hooks.json`.
   Hooks under `banned` in hooks.json are OUT for good (Radek: "never use this hook again"): never pick one, and
   when he bans another, move it there with the reason. Before publishing a batch, check no two reels share a hook.
5. **Write one job per reel** in `~/Desktop/REELS <account>/cut/<YYYY-MM-DD>/NN.json`. Absolute source paths. Example:
   ```json
   {"account": "radek.spanish", "batch": "2026-11-10", "slot": 1,
    "me": "/Users/macbook/Desktop/REELS radek.spanish/cut/2026-11-10/me/IMG_1.MOV",
    "demo": "/Users/macbook/Desktop/REELS radek.spanish/cut/2026-11-10/demo/IMG_2.MOV",
    "hook": "How did you learn 1000 Spanish words after just ONE month??😭",
    "lines": ["ummm by scrolling Spanish reels", "The app makes me write the words i hear",
              "and i tap the words i dont know to see the translation"],
    "demo_from": 1.2, "out": "01.mp4"}
   ```
   Move the sources into `cut/<date>/me|demo/` FIRST (so the inbox is empty for the next batch and recuts find them).
   Other keys (see `scripts/cut/render.py`): seconds per text `"beat": 3`, per-line `{"text", "dur"}`, `hook_top`/`line_top`,
   `hook_size`/`line_size`. Defaults match his reference cuts; don't change them without a reason.
6. **Render**: `~/.venvs/reels/bin/python scripts/cut/render.py <job.json> …` (≈20 s each).
7. **Check every reel yourself before publishing.** Read a sheet of the output:
   `ffmpeg -v error -y -i 01.mp4 -vf "fps=2,scale=200:-2,tile=8x3" -frames:v 1 /tmp/s.png`.
   Fail it and fix it if: text covers his face or the phone's key UI (the word being typed, the tapped
   translation), the hook breaks badly, the demo shows nothing happening during a line, colours look
   grey/washed (HDR source), or a line describes something the demo doesn't show.
8. **Publish**: `node scripts/cut/publish.mts <job.json> …`. Then tell Radek how many reels are up on
   getloro.app/cut, which hooks you used, and anything you were unsure about.

## Notes → recut

Every Claude chat in the loro repo waits for notes in the background (`node scripts/cut/wait-notes.mts`,
started because of the SessionStart hook `scripts/cut/session-start.sh`). It exits with `CLAIMED …` once Radek
has been quiet for 20 s after a note, and only one open chat wins each claim. Then do the steps below, run
`node scripts/cut/wait-notes.mts --release`, and start the waiter again. If a note is unclear and Radek isn't
answering in the chat, ask on the page: `node scripts/cut/ask.mts <note id> "question"`.

1. `node scripts/cut/notes.mts`: open notes grouped by reel, each with its second, what was on screen then, and
   the reel's job (the recipe with absolute paths).
2. For each note, change the job (text, timing, `demo_from`, sizes…). A note means something at THAT second,
   so read "on screen: …" before you guess. If a note is ambiguous, ask Radek rather than guess twice.
3. Add `"replies": {"<note id>": "what you changed, in one short line"}` to the job, re-render, check it (step 7),
   then publish. The reel goes to v+1, back to "To review", and the notes show as answered with your reply.
4. A note that asks for something general ("always put the hook lower") is a rule: apply it to every reel still
   in review and record it in this skill's format section.

## Hook tracking

When Radek posts a reel he marks it "Posted" on /cut and pastes its link (+ views until the account is connected
on getloro.app/marketing; then views fill in by themselves from the link). The Hooks tab ranks hooks by views
compared with that account's usual reel. Use that ranking when picking hooks (step 4).

## Facts that cost time to learn

- iPhone clips are often HLG HDR (`color_transfer=arib-std-b67`). render.py tone-maps them with Apple's own pipeline
  (`scripts/cut/sdr.swift`, cached in ~/.cache/loro-cut/sdr). NEVER go back to ffmpeg's colorspace filter for HDR: it
  read HLG as plain gamma and blew out the bright areas (Radek, 2026-11-11: "kinda light up, something happened with
  the quality"). When checking a reel, compare an HDR clip's frame against `sdr.swift`'s output, not by eye alone.
- Radek films with HDR Video OFF since 2026-11-11 (Settings → Camera → Record Video). The SDR test reel looked "much
  better" to him than the Apple-tone-mapped HLG one. If a clip arrives as HLG anyway, still cut it, but remind him of
  the setting.
- "The demo looks dark" (Radek, 2026-11-11): measured, render.py does NOT darken SDR demos. Average luma was 35.15 in
  the source and 35.17 in the reel over the same 270 frames. The iPad demo was filmed at night (YAVG ~35/255), so it IS
  dark. Encoding is now x264 `-crf 15 -preset slow -tune film` + lanczos scaling (PSNR 46 dB vs the source, was 43 at
  crf 20). Check a "darker/worse" complaint by measuring source vs reel YAVG on the aligned region (shift by
  `demo_drop`) before changing anything. A dark demo is fixed by filming with the lights on, not by grading it.
- This Mac's ffmpeg has no `drawtext` and no `zscale`; text is drawn with Pillow (Figtree at weight 800, the closest
  free match to Instagram's text font; an `InstagramSans-Bold.ttf` next to render.py is used instead if present).
- The Mac is Intel: no CapCut/Edits desktop. Everything goes through ffmpeg.
- Videos live in the private `loro-cuts` bucket; the page gets 6-hour signed URLs (Refresh renews them).
