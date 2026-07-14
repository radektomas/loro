#!/usr/bin/env python3
"""
Loro — transcription pipeline.

Drops raw Spanish videos in, spits Loro's videos.json out.

    raw/*.mp4  ->  data/videos.json
                   public/videos/*.mp4
                   public/posters/*.jpg

Usage:
    python transcribe.py                 # process everything in raw/
    python transcribe.py --no-translate  # skip the Claude call (cheap dry run)
    python transcribe.py --check         # print cues to the terminal, write nothing
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# ---------------------------------------------------------------- config

ROOT = Path(__file__).parent
RAW_DIR = ROOT / "raw"
DATA_DIR = ROOT / "data"
PUBLIC_VIDEOS = ROOT / "public" / "videos"
PUBLIC_POSTERS = ROOT / "public" / "posters"

TARGET_LANGS = {
    "en": "English",
    "cs": "Czech",
    "de": "German",
    "fr": "French",
}

# Cue shape. Short cues = readable subtitles on a phone.
MAX_WORDS_PER_CUE = 8
MAX_SECONDS_PER_CUE = 3.5

WHISPER_MODEL = "medium"   # switch to "medium" if your machine struggles
CLAUDE_MODEL = "claude-sonnet-5"

# Per-file metadata. Anything not listed here falls back to the defaults.
# Edit this as videos come in from the family.
META = {
    # "abuela_desayuno.mp4": {"creator": "Rosa",   "level": "A2"},
    # "hermano_trafico.mp4": {"creator": "Diego",  "level": "B1"},
}
DEFAULT_CREATOR = "Loro"
DEFAULT_LEVEL = "A2"


# ---------------------------------------------------------------- helpers

def die(msg: str) -> None:
    print(f"\n✗ {msg}\n", file=sys.stderr)
    sys.exit(1)


def require_ffmpeg() -> None:
    if shutil.which("ffmpeg") is None:
        die("ffmpeg not found. Install it:  brew install ffmpeg")


def extract_audio(video: Path, wav: Path) -> None:
    """16 kHz mono WAV — exactly what Whisper wants, nothing more."""
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(video),
         "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", str(wav)],
        check=True, capture_output=True,
    )


def extract_poster(video: Path, jpg: Path) -> None:
    """Grab a frame ~1s in, so the feed has something to show before play."""
    jpg.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-y", "-ss", "1", "-i", str(video),
         "-frames:v", "1", "-q:v", "3", str(jpg)],
        check=True, capture_output=True,
    )


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or "video"


# ---------------------------------------------------------------- transcribe

def transcribe(wav: Path):
    """Return a flat list of {text, start, end} words, in order."""
    from faster_whisper import WhisperModel

    model = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")

    segments, _info = model.transcribe(
        str(wav),
        language="es",
        word_timestamps=True,     # <- the whole point
        vad_filter=True,          # trims silence, keeps timings honest
        beam_size=5,
    )

    words = []
    for seg in segments:
        for w in (seg.words or []):
            text = w.word.strip()
            if not text:
                continue
            words.append({
                "text": text,
                "start": round(w.start, 3),
                "end": round(w.end, 3),
            })
    return words


def group_into_cues(words):
    """
    Chunk words into short cues. Break on sentence-ending punctuation,
    on word count, on duration, or on a noticeable pause.
    """
    cues, current = [], []

    def flush():
        if not current:
            return
        cues.append({
            "start": current[0]["start"],
            "end": current[-1]["end"],
            "words": list(current),
            "translations": {},
        })
        current.clear()

    for i, w in enumerate(words):
        current.append(w)

        ends_sentence = w["text"][-1] in ".?!…"
        too_many = len(current) >= MAX_WORDS_PER_CUE
        too_long = (w["end"] - current[0]["start"]) >= MAX_SECONDS_PER_CUE

        gap_next = False
        if i + 1 < len(words):
            gap_next = (words[i + 1]["start"] - w["end"]) > 0.6

        if ends_sentence or too_many or too_long or gap_next:
            flush()

    flush()
    return cues


# ---------------------------------------------------------------- translate

def translate_cues(cues, video_name: str):
    """One Claude call per video. Returns the cues with translations filled in."""
    from anthropic import Anthropic

    if not os.environ.get("ANTHROPIC_API_KEY"):
        die("ANTHROPIC_API_KEY is not set. export it, or run with --no-translate")

    client = Anthropic()

    lines = [
        {"i": i, "es": " ".join(w["text"] for w in c["words"])}
        for i, c in enumerate(cues)
    ]

    langs = ", ".join(f'"{k}" ({v})' for k, v in TARGET_LANGS.items())

    prompt = f"""These are consecutive subtitle lines from one short Spanish video ("{video_name}"). Read them together as a single continuous piece of speech — the context matters for getting each line right.

Translate every line into: {langs}.

Rules:
- Translate meaning, not words. This is casual spoken Spanish; make the translations sound like natural spoken language in the target language, not like a dictionary.
- Keep each translation roughly as short as the Spanish. These render as one line under a video on a phone.
- Preserve register: if the Spanish is slangy or blunt, the translation is slangy or blunt.
- Translate every line, including fragments.

Input:
{json.dumps(lines, ensure_ascii=False, indent=1)}

Respond with ONLY a JSON array, no preamble, no markdown fences. One object per input line, in the same order:
[{{"i": 0, "en": "...", "cs": "...", "de": "...", "fr": "..."}}]"""

    resp = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=8000,
        messages=[{"role": "user", "content": prompt}],
    )

    text = "".join(b.text for b in resp.content if b.type == "text").strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.MULTILINE).strip()

    try:
        rows = json.loads(text)
    except json.JSONDecodeError:
        die(f"Claude did not return valid JSON for {video_name}:\n{text[:400]}")

    by_index = {r["i"]: r for r in rows}
    for i, cue in enumerate(cues):
        row = by_index.get(i, {})
        cue["translations"] = {
            lang: row.get(lang, "") for lang in TARGET_LANGS
        }
    return cues


# ---------------------------------------------------------------- main

def process(video: Path, translate: bool, check: bool):
    print(f"\n▶ {video.name}")

    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "audio.wav"
        print("  · extracting audio")
        extract_audio(video, wav)

        print(f"  · transcribing ({WHISPER_MODEL}, this is the slow part)")
        words = transcribe(wav)

    if not words:
        print("  ! no speech detected — skipping")
        return None

    cues = group_into_cues(words)
    print(f"  · {len(words)} words → {len(cues)} cues")

    if check:
        for c in cues:
            line = " ".join(w["text"] for w in c["words"])
            print(f"    [{c['start']:6.2f} → {c['end']:6.2f}]  {line}")
        return None

    if translate:
        print("  · translating")
        cues = translate_cues(cues, video.stem)

    vid = slugify(video.stem)
    meta = META.get(video.name, {})

    PUBLIC_VIDEOS.mkdir(parents=True, exist_ok=True)
    shutil.copy2(video, PUBLIC_VIDEOS / f"{vid}.mp4")
    extract_poster(video, PUBLIC_POSTERS / f"{vid}.jpg")

    return {
        "id": vid,
        "src": f"/videos/{vid}.mp4",
        "poster": f"/posters/{vid}.jpg",
        "creator": meta.get("creator", DEFAULT_CREATOR),
        "level": meta.get("level", DEFAULT_LEVEL),
        "cues": cues,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-translate", action="store_true")
    ap.add_argument("--check", action="store_true",
                    help="print cues and exit, write nothing")
    args = ap.parse_args()

    require_ffmpeg()

    if not RAW_DIR.exists():
        RAW_DIR.mkdir(parents=True)
        die(f"Created {RAW_DIR}/ — drop your .mp4 files in there and rerun.")

    videos = sorted(
        p for p in RAW_DIR.iterdir()
        if p.suffix.lower() in {".mp4", ".mov", ".m4v"}
    )
    if not videos:
        die(f"No videos found in {RAW_DIR}/")

    out = []
    for v in videos:
        entry = process(v, translate=not args.no_translate, check=args.check)
        if entry:
            out.append(entry)

    if args.check:
        return

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    target = DATA_DIR / "videos.json"

    if target.exists():
        backup = DATA_DIR / "videos.backup.json"
        shutil.copy2(target, backup)
        print(f"\n  (previous videos.json backed up to {backup.name})")

    target.write_text(
        json.dumps(out, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"\n✓ {len(out)} video(s) → {target}")
    print("  Restart the dev server and swipe.\n")


if __name__ == "__main__":
    main()
