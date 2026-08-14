/**
 * "Is a real person actually talking on camera?" — a vision gate.
 *
 * WHY THIS EXISTS. curation.mts says it plainly: there is no metadata field
 * for "is a person on camera talking", so the curation stack is a pile of weak
 * text proxies (category tier, listicle patterns, channel blocklist). It leaks
 * in both directions. The proof is already in the published feed — the entry
 * for Irdlrwr5NPU is a pair of hands arranging cardboard tubes in a bowl with a
 * voiceover: category 22, plausible title, zero people on screen.
 *
 * The signal the text proxies lack has been sitting in front of us the whole
 * time: the pixels. YouTube auto-generates three frames per video at roughly
 * 25% / 50% / 75% of its duration, at i.ytimg.com/vi/<id>/hq{1,2,3}.jpg. They
 * are free, need no API key and cost no quota. Three frames spread across the
 * clip is a much better witness than the cover thumbnail alone, which is often
 * a designed graphic and says nothing about what the video contains.
 *
 * WHAT THIS IS AND IS NOT. It is a *sampling* test: three frames of a 20-75s
 * clip. A video that cuts to B-roll for exactly those three moments will be
 * wrongly dropped, and a video with one on-camera intro over 60s of stock
 * footage can slip through. It is dramatically better than the title regexes
 * and it is still not a transcript-level guarantee.
 *
 * Cost is deliberately tiny relative to the gloss it protects: one small-model
 * call with three low-detail images (~$0.001) in front of a gloss that runs
 * ~40x that. Rejecting here is what makes the budget go further, not less far.
 */

import { requireEnv } from './env.mts';
import { charge } from './openaiCost.mts';

/**
 * Small, non-reasoning, vision-capable. Chosen over the gpt-5 minis on cost
 * PREDICTABILITY, not headline price: a reasoning model bills its thinking as
 * output tokens, so a per-item budget guard cannot bound one call in advance.
 * This is a binary classification of three small images — there is nothing to
 * think about.
 */
export const GATE_MODEL = 'gpt-4.1-mini';

/**
 * The frames YouTube generates for every video, in clip order. hq2 duplicates
 * hqdefault when the creator set no custom thumbnail, which is harmless.
 */
const FRAME_NAMES = ['hq1', 'hq2', 'hq3'] as const;

/**
 * detail:'low' resizes to 512x512. These frames are 480x360, so low detail is
 * effectively lossless here AND costs a flat per-image rate — the rare case
 * where the cheap setting gives up nothing.
 */
const IMAGE_DETAIL = 'low';

/**
 * How many sampled frames must show the speaker.
 *
 * Raised 1 -> 2 on the first production run's own errors. Of 39 videos
 * published 2026-08-14, the 8 accepted on a SINGLE frame were audited by eye
 * and 3 were wrong — an animated skull cartoon, an illustrated art tutorial,
 * and a dog in a sombrero over narration. Every video accepted on 2 or 3
 * frames that was audited was correct.
 *
 * The failure mode is specific and obvious in hindsight: narrated content
 * routinely opens or closes on a shot of the narrator, so ONE frame with a
 * face is exactly what a voiceover video looks like. Two frames means the
 * person persists, which is what "talking on camera" actually means.
 *
 * This costs recall — 5 of those 8 were genuinely fine, including travel vlogs
 * from a manually vetted channel that cut to B-roll. That trade is deliberate:
 * a wrong video in the feed is a learner watching a cartoon with no mouth to
 * read, while a missed video is one row left 'eligible' for the next run.
 * Publish a known-good straggler with `--ids`, which bypasses this gate.
 */
const MIN_FRAMES_WITH_SPEAKER = 2;

export type OnCameraVerdict = {
  /** Publish-worthy: a real human is visibly speaking in these frames. */
  onCamera: boolean;
  /** How many of the sampled frames show the speaker. Drives the reason line. */
  framesWithSpeaker: number;
  /** One short clause, for the publisher log and the reject_reason trail. */
  reason: string;
  /** What the model called it: talking-head | interview | vlog | voiceover | ... */
  format: string;
};

const PROMPT = `You are screening short Spanish-language videos for a language-learning feed. The feed only accepts videos where a REAL HUMAN BEING IS VISIBLY SPEAKING ON CAMERA, because learners need to see a face and mouth to learn from.

You are given up to 3 frames sampled at roughly 25%, 50% and 75% through the video, in order.

ACCEPT (a real person is on camera speaking):
- someone talking directly to the camera (piece to camera, vlog, advice, storytelling)
- a street interview: interviewer and/or member of the public visibly answering
- two or more people visibly having a conversation on camera
- a presenter visible in frame while showing or doing something
- a real person in a picture-in-picture / corner overlay reacting or narrating, PROVIDED it is a real filmed human, not an avatar

REJECT (no real person is visibly the speaker):
- no human visible at all
- only hands visible: cooking POV, crafts, unboxing, "how to" with hands only
- animation, cartoon, CGI, anime, AI-generated or avatar presenters
- video game capture, screen recording, phone-screen tutorials
- stock footage, drone/landscape shots, animal footage, B-roll with an unseen narrator
- text-on-screen slideshows, quote cards, photo montages
- sports match footage, concert footage or news footage where the visible people are the SUBJECT, not the speaker
- a person is visible but is plainly not the one talking (e.g. a photograph, a passer-by, a still portrait)

Be strict. When the frames do not show a real human who is plausibly the person speaking, REJECT. A voiceover over footage is the single most common thing you must catch, and it is very common in this feed's source material.

Respond with ONLY a JSON object, no preamble, no markdown fences:
{"frames_with_speaker": 0-3, "format": "talking-head|interview|vlog|presenter|reaction-overlay|hands-only|voiceover-broll|animation|gameplay|slideshow|other", "on_camera": true|false, "reason": "max 12 words"}`;

/** Fetch one frame as a data URI, or null when YouTube has no such frame. */
async function fetchFrame(youtubeId: string, name: string): Promise<string | null> {
  const url = `https://i.ytimg.com/vi/${youtubeId}/${name}.jpg`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  // YouTube answers 200 with a tiny grey placeholder for frames it never
  // generated, so size is the real "does this frame exist" test.
  if (bytes.byteLength < 1_000) return null;
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

export class NoFramesError extends Error {
  constructor(youtubeId: string) {
    super(`no storyboard frames available for ${youtubeId}`);
    this.name = 'NoFramesError';
  }
}

/**
 * Judge one video. Throws NoFramesError when YouTube served no usable frame
 * (transient/unknowable — the caller must NOT persist that as a verdict), and
 * lets network/OpenAI errors propagate for the same reason.
 */
export async function judgeOnCamera(
  youtubeId: string,
  title: string
): Promise<OnCameraVerdict> {
  const frames = (
    await Promise.all(FRAME_NAMES.map((name) => fetchFrame(youtubeId, name)))
  ).filter((f): f is string => f !== null);

  if (frames.length === 0) throw new NoFramesError(youtubeId);

  const key = requireEnv('OPENAI_API_KEY');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: GATE_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: `${PROMPT}\n\nVideo title (context only, judge the FRAMES): "${title}"` },
            ...frames.map((url) => ({
              type: 'image_url' as const,
              image_url: { url, detail: IMAGE_DETAIL },
            })),
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  charge(GATE_MODEL, data.usage);

  const text = (data.choices?.[0]?.message?.content ?? '')
    .replace(/^```(?:json)?|```$/gm, '')
    .trim();
  const parsed = JSON.parse(text) as Record<string, unknown>;

  const framesWithSpeaker = Number(parsed.frames_with_speaker ?? 0);
  const format = typeof parsed.format === 'string' ? parsed.format : 'other';
  const reason = typeof parsed.reason === 'string' ? parsed.reason : '';

  // Both signals must agree, and the frame COUNT is the binding one: it is a
  // concrete observation, while on_camera is a label the model can attach to a
  // single establishing shot of a narrator. When fewer than 3 frames came back
  // the threshold cannot be met on evidence we do not have, so require all of
  // them rather than silently lowering the bar for short or sparse videos.
  const needed = Math.min(MIN_FRAMES_WITH_SPEAKER, frames.length);
  const onCamera = parsed.on_camera === true && framesWithSpeaker >= needed;

  return { onCamera, framesWithSpeaker, format, reason };
}
