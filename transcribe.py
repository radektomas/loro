#!/usr/bin/env python3
"""
Loro — transcription pipeline.

Drops raw Spanish videos in, spits Loro's videos.json out.

    raw/*.mp4  ->  data/videos.json
                   public/videos/*.mp4
                   public/posters/*.jpg

Incremental by default: files whose id is already in data/videos.json are
skipped, and newly processed videos are appended to the existing list.

Usage:
    python transcribe.py                 # process only NEW files in raw/
    python transcribe.py --force         # reprocess everything (regenerate)
    python transcribe.py --only clip.mov # process just one file in raw/
    python transcribe.py --no-translate  # skip the OpenAI call (cheap dry run)
    python transcribe.py --check         # print cues to the terminal, write nothing

OPENAI_API_KEY is read from .env automatically (python-dotenv).
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

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:
    load_dotenv = None

# ---------------------------------------------------------------- config

ROOT = Path(__file__).parent
RAW_DIR = ROOT / "raw"
DATA_DIR = ROOT / "data"
PUBLIC_VIDEOS = ROOT / "public" / "videos"
PUBLIC_POSTERS = ROOT / "public" / "posters"

# Read OPENAI_API_KEY (and anything else) from .env next to this script, so it
# doesn't have to be exported every session. No-op if python-dotenv isn't
# installed or there's no .env file — a shell-exported key still works.
if load_dotenv is not None:
    load_dotenv(ROOT / ".env")

TARGET_LANGS = {
    "en": "English",
    "cs": "Czech",
    "de": "German",
    "fr": "French",
}

# Cue shape. Short cues = readable subtitles on a phone. The chunker treats
# these as caps to break UNDER at a linguistic boundary, not marks to hit.
MAX_WORDS_PER_CUE = 9
MAX_SECONDS_PER_CUE = 4.2
MIN_WORDS_PER_CUE = 3

WHISPER_MODEL = "medium"   # switch to "medium" if your machine struggles
OPENAI_MODEL = "gpt-4o"

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


def normalize_word(text: str) -> str:
    """
    Normalised surface form used as the dictionary key: lowercase, strip
    surrounding punctuation, KEEP accents and ñ ("Costa" and "costa," -> "costa").
    Must stay byte-for-byte identical in behaviour to normalizeSurface()
    in lib/dictionary.ts — the app looks words up by this key.
    """
    return re.sub(r"^[^a-z0-9áéíóúüñ]+|[^a-z0-9áéíóúüñ]+$", "", text.lower())


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
        # The chunker splits on punctuation and casing; without these two,
        # Whisper hands back lowercase, punctuation-free text and starves it.
        condition_on_previous_text=True,
        initial_prompt=(
            "Transcripción en español con puntuación y mayúsculas correctas. "
            "Hola, ¿cómo estás? Hoy me levanté temprano, hice café y salí a "
            "trabajar."
        ),
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


def _is_sentence_end(text: str) -> bool:
    return bool(text) and text[-1] in ".?!…"


def _boundary_score(words, i: int) -> float:
    """
    How good a place is it to split AFTER words[i]? Higher = cleaner break.
    Sentence enders beat clause punctuation beats a pause beats nothing.
    """
    text = words[i]["text"]
    if _is_sentence_end(text):
        return 100.0
    if text and text[-1] in ",;:":
        return 50.0
    if i + 1 < len(words):
        gap = words[i + 1]["start"] - words[i]["end"]
        if gap > 0.5:
            return 40.0 + gap * 20.0
    return 0.0


def group_into_cues(words):
    """
    Chunk words into short cues by scoring linguistic boundaries instead of
    flushing blindly at a cap. When the next word would overflow a cue, we
    split at the highest-scoring boundary already inside the buffer — a comma
    or a pause — rather than mid-phrase, and return the tail to the next cue.
    Sentence-ending punctuation always closes a cue on the spot. Orphan cues
    are merged into a neighbour afterwards.
    """
    if not words:
        return []

    cues = []

    def emit(indices):
        cue_words = [words[k] for k in indices]
        cues.append({
            "start": cue_words[0]["start"],
            "end": cue_words[-1]["end"],
            "words": cue_words,
            "translations": {},
        })

    buffer = []  # indices into `words`
    for i in range(len(words)):
        buffer.append(i)

        # End of sentence — always break right here.
        if _is_sentence_end(words[i]["text"]):
            emit(buffer)
            buffer = []
            continue

        nxt = i + 1
        if nxt >= len(words):
            continue

        would_overflow = (
            len(buffer) + 1 > MAX_WORDS_PER_CUE
            or (words[nxt]["end"] - words[buffer[0]]["start"]) > MAX_SECONDS_PER_CUE
        )
        if not would_overflow:
            continue

        # Adding the next word overflows. Look back for the best boundary in
        # the buffer; on ties prefer the latest, so cues pack fuller. Splitting
        # after the last buffer word is the plain cap fallback.
        best_pos, best_score = len(buffer) - 1, 0.0
        for pos, gidx in enumerate(buffer):
            score = _boundary_score(words, gidx)
            if score >= best_score:
                best_pos, best_score = pos, score

        if best_score > 0:
            emit(buffer[:best_pos + 1])
            buffer = buffer[best_pos + 1:]
        else:
            emit(buffer)
            buffer = []

    if buffer:
        emit(buffer)

    return merge_orphans(cues)


def merge_orphans(cues):
    """
    Post-pass: fold stubby cues (too few words, or under 0.8s) into a
    neighbour, choosing whichever is closer in time. A merge is skipped only
    when it would push the result past MAX_WORDS_PER_CUE + 3 words, so a lone
    "plata" joins its neighbour instead of standing as its own cue.
    """
    HARD_CAP = MAX_WORDS_PER_CUE + 3
    MIN_SECONDS = 0.8

    def is_orphan(c) -> bool:
        return (
            len(c["words"]) < MIN_WORDS_PER_CUE
            or (c["end"] - c["start"]) < MIN_SECONDS
        )

    def merged(a, b):
        ws = a["words"] + b["words"]
        return {
            "start": ws[0]["start"],
            "end": ws[-1]["end"],
            "words": ws,
            "translations": {},
        }

    # Each pass merges the first mergeable orphan and restarts; the cue count
    # strictly drops, so this terminates. A merged cue that is still an orphan
    # gets another shot on the next scan.
    while len(cues) > 1:
        target = None
        for idx, cue in enumerate(cues):
            if not is_orphan(cue):
                continue

            options = []  # (time gap, neighbour index)
            if idx > 0:
                prev_c = cues[idx - 1]
                if len(prev_c["words"]) + len(cue["words"]) <= HARD_CAP:
                    options.append((cue["start"] - prev_c["end"], idx - 1))
            if idx + 1 < len(cues):
                next_c = cues[idx + 1]
                if len(cue["words"]) + len(next_c["words"]) <= HARD_CAP:
                    options.append((next_c["start"] - cue["end"], idx + 1))
            if not options:
                continue  # can't merge without blowing the cap — leave it

            options.sort(key=lambda o: o[0])
            neighbour = options[0][1]
            target = tuple(sorted((idx, neighbour)))
            break

        if target is None:
            break

        lo, hi = target
        cues[lo:hi + 1] = [merged(cues[lo], cues[hi])]

    return cues


# ---------------------------------------------------------------- translate

def translate_cues(cues, video_name: str):
    """One OpenAI call per video. Returns the cues with translations filled in."""
    from openai import OpenAI

    if not os.environ.get("OPENAI_API_KEY"):
        die("OPENAI_API_KEY is not set. export OPENAI_API_KEY, or run with --no-translate")

    client = OpenAI()

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

Respond with ONLY a JSON object, no preamble, no markdown fences. One object per input line, in the same order:
{{"lines": [{{"i": 0, "en": "...", "cs": "...", "de": "...", "fr": "..."}}]}}"""

    resp = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
    )

    text = resp.choices[0].message.content.strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.MULTILINE).strip()

    try:
        rows = json.loads(text)["lines"]
    except (json.JSONDecodeError, KeyError, TypeError):
        die(f"OpenAI did not return valid JSON for {video_name}:\n{text[:400]}")

    by_index = {r["i"]: r for r in rows}
    for i, cue in enumerate(cues):
        row = by_index.get(i, {})
        cue["translations"] = {
            lang: row.get(lang, "") for lang in TARGET_LANGS
        }
    return cues


def gloss_words(cues, video_name: str):
    """
    One extra OpenAI call per video: a per-word gloss for every unique word
    across all cues. Returns the dictionary keyed by normalised surface form:
    { "novia": {"lemma": ..., "pos": ..., "note": ..., "glosses": {en,cs,de,fr}} }
    """
    from openai import OpenAI

    if not os.environ.get("OPENAI_API_KEY"):
        die("OPENAI_API_KEY is not set. export OPENAI_API_KEY, or run with --no-translate")

    client = OpenAI()

    unique, seen = [], set()
    for c in cues:
        for w in c["words"]:
            n = normalize_word(w["text"])
            if n and n not in seen:
                seen.add(n)
                unique.append(n)
    if not unique:
        return {}

    context_lines = [
        {
            "es": " ".join(w["text"] for w in c["words"]),
            "en": c["translations"].get("en", ""),
        }
        for c in cues
    ]

    langs = ", ".join(f'"{k}" ({v})' for k, v in TARGET_LANGS.items())

    prompt = f"""These are the subtitle lines of one short Spanish video ("{video_name}"), with English translations for context:

{json.dumps(context_lines, ensure_ascii=False, indent=1)}

Produce a dictionary entry for EVERY word in this list (these are the normalised words of those lines):
{json.dumps(unique, ensure_ascii=False)}

For each word return an object with:
- "w": the word exactly as it appears in the list above
- "lemma": its dictionary form ("es" -> "ser", "novia" -> "novia")
- "pos": one of: noun, verb, adj, adv, prep, pron, conj, det, other
- one SHORT gloss per language — {langs} — translating THIS word AS USED in these sentences. 1-3 words. A translation, not a definition. Context matters: "como" is "like" in one sentence and "I eat" in another.
- "note": max 8 words, ONLY when genuinely useful (irregular verb, false friend, gendered form, common idiom). Otherwise null.

Gloss every single word, including function words — a beginner needs "de" and "que" as much as any noun. Do not skip any word from the list.

Respond with ONLY a JSON object, no preamble, no markdown fences:
{{"words": [{{"w": "novia", "lemma": "novia", "pos": "noun", "en": "girlfriend", "cs": "přítelkyně", "de": "Freundin", "fr": "copine", "note": null}}]}}"""

    resp = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
    )

    text = resp.choices[0].message.content.strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.MULTILINE).strip()

    try:
        rows = json.loads(text)["words"]
    except (json.JSONDecodeError, KeyError, TypeError):
        die(f"OpenAI did not return valid gloss JSON for {video_name}:\n{text[:400]}")

    dictionary = {}
    for row in rows:
        key = normalize_word(str(row.get("w", "")))
        if not key:
            continue
        dictionary[key] = {
            "lemma": row.get("lemma") or key,
            "pos": row.get("pos") or "other",
            "note": row.get("note") or None,
            "glosses": {lang: row.get(lang, "") for lang in TARGET_LANGS},
        }

    missing = [w for w in unique if w not in dictionary]
    if missing:
        print(f"  ! {len(missing)} word(s) missing from gloss response: {missing[:8]}")
    return dictionary


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

    dictionary = {}
    if translate:
        print("  · translating")
        cues = translate_cues(cues, video.stem)
        print("  · glossing words")
        dictionary = gloss_words(cues, video.stem)

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
        "dictionary": dictionary,
    }


def load_existing(target: Path):
    """Return the existing videos list, or [] if there's none yet."""
    if not target.exists():
        return []
    try:
        data = json.loads(target.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        die(f"{target} exists but isn't valid JSON ({e}). "
            f"Fix or remove it before rerunning.")
    if not isinstance(data, list):
        die(f"{target} isn't a JSON array — refusing to overwrite it.")
    return data


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-translate", action="store_true")
    ap.add_argument("--check", action="store_true",
                    help="print cues and exit, write nothing")
    ap.add_argument("--force", action="store_true",
                    help="reprocess every file, ignoring the already-done skip")
    ap.add_argument("--only", metavar="FILENAME",
                    help="process just this one file in raw/ (e.g. clip.mov)")
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

    if args.only:
        videos = [p for p in videos if p.name == args.only]
        if not videos:
            die(f"--only {args.only!r} not found in {RAW_DIR}/")

    target = DATA_DIR / "videos.json"
    existing = load_existing(target)
    existing_ids = {e.get("id") for e in existing}

    # Incremental: skip anything already in videos.json unless --force.
    processed = []
    for v in videos:
        vid = slugify(v.stem)
        if vid in existing_ids and not args.force:
            print(f"· skipping {v.name} (already processed)")
            continue
        entry = process(v, translate=not args.no_translate, check=args.check)
        if entry:
            processed.append(entry)

    if args.check:
        return

    if not processed:
        print("\n✓ nothing new to do — videos.json is up to date.\n")
        return

    # Merge: reprocessed ids replace their slot in place; genuinely new videos
    # are appended, preserving the existing order.
    index_by_id = {e.get("id"): i for i, e in enumerate(existing)}
    merged = list(existing)
    added = 0
    for entry in processed:
        if entry["id"] in index_by_id:
            merged[index_by_id[entry["id"]]] = entry
        else:
            index_by_id[entry["id"]] = len(merged)
            merged.append(entry)
            added += 1

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    if target.exists():
        backup = DATA_DIR / "videos.backup.json"
        shutil.copy2(target, backup)
        print(f"\n  (previous videos.json backed up to {backup.name})")

    target.write_text(
        json.dumps(merged, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    updated = len(processed) - added
    detail = f"{added} new"
    if updated:
        detail += f", {updated} updated"
    print(f"\n✓ {detail} → {len(merged)} video(s) total in {target}")
    print("  Restart the dev server and swipe.\n")


if __name__ == "__main__":
    main()
