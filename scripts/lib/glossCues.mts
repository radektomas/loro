import { normalizeSurface } from '../../lib/dictionary.ts';
import { requireEnv } from './env.mts';
import type { CueOut } from './json3ToCues.mts';

/**
 * Translation + per-word glossing for caption-derived transcripts.
 *
 * The prompts are VERBATIM from transcribe.py (translate_cues/gloss_words) —
 * the same model produces the same shapes for both pipelines, and the
 * dictionary keys go through the SAME normalizer the app looks words up with:
 * normalizeSurface() is imported from lib/dictionary.ts rather than ported,
 * so the two can never drift.
 *
 * Text-only: no audio is ever involved. This is what replaces the Whisper
 * step for embeds.
 */

const TARGET_LANGS: Record<string, string> = {
  en: 'English',
  cs: 'Czech',
  de: 'German',
  fr: 'French',
};

const OPENAI_MODEL = 'gpt-4o';

async function chatJson(prompt: string): Promise<Record<string, unknown>> {
  const key = requireEnv('OPENAI_API_KEY');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  let text = (data.choices?.[0]?.message?.content ?? '').trim();
  // Belt-and-braces fence stripping, same as transcribe.py.
  text = text.replace(/^```(?:json)?|```$/gm, '').trim();
  return JSON.parse(text) as Record<string, unknown>;
}

const langsList = (): string =>
  Object.entries(TARGET_LANGS)
    .map(([k, v]) => `"${k}" (${v})`)
    .join(', ');

/** Fill cue.translations in place (mirrors transcribe.py translate_cues). */
export async function translateCues(
  cues: CueOut[],
  videoName: string
): Promise<void> {
  if (cues.length === 0) return;
  const lines = cues.map((c, i) => ({
    i,
    es: c.words.map((w) => w.text).join(' '),
  }));

  const prompt = `These are consecutive subtitle lines from one short Spanish video ("${videoName}"). Read them together as a single continuous piece of speech — the context matters for getting each line right.

Translate every line into: ${langsList()}.

Rules:
- Translate meaning, not words. This is casual spoken Spanish; make the translations sound like natural spoken language in the target language, not like a dictionary.
- Keep each translation roughly as short as the Spanish. These render as one line under a video on a phone.
- Preserve register: if the Spanish is slangy or blunt, the translation is slangy or blunt.
- Translate every line, including fragments.

Input:
${JSON.stringify(lines, null, 1)}

Respond with ONLY a JSON object, no preamble, no markdown fences. One object per input line, in the same order:
{"lines": [{"i": 0, "en": "...", "cs": "...", "de": "...", "fr": "..."}]}`;

  const parsed = await chatJson(prompt);
  const rows = (parsed.lines ?? []) as Record<string, unknown>[];
  const byIndex = new Map<number, Record<string, unknown>>();
  for (const row of rows) byIndex.set(Number(row.i), row);
  cues.forEach((cue, i) => {
    const row = byIndex.get(i) ?? {};
    cue.translations = Object.fromEntries(
      Object.keys(TARGET_LANGS).map((lang) => [
        lang,
        typeof row[lang] === 'string' ? (row[lang] as string) : '',
      ])
    );
  });
}

export type GlossOut = {
  lemma: string;
  pos: string;
  note: string | null;
  glosses: Record<string, string>;
};

/** Build the per-word dictionary (mirrors transcribe.py gloss_words). */
export async function glossWords(
  cues: readonly CueOut[],
  videoName: string
): Promise<Record<string, GlossOut>> {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const c of cues) {
    for (const w of c.words) {
      const n = normalizeSurface(w.text);
      if (n && !seen.has(n)) {
        seen.add(n);
        unique.push(n);
      }
    }
  }
  if (unique.length === 0) return {};

  const contextLines = cues.map((c) => ({
    es: c.words.map((w) => w.text).join(' '),
    en: c.translations.en ?? '',
  }));

  const prompt = `These are the subtitle lines of one short Spanish video ("${videoName}"), with English translations for context:

${JSON.stringify(contextLines, null, 1)}

Produce a dictionary entry for EVERY word in this list (these are the normalised words of those lines):
${JSON.stringify(unique)}

For each word return an object with:
- "w": the word exactly as it appears in the list above
- "lemma": its dictionary form ("es" -> "ser", "novia" -> "novia")
- "pos": one of: noun, verb, adj, adv, prep, pron, conj, det, other
- one SHORT gloss per language — ${langsList()} — translating THIS word AS USED in these sentences. 1-3 words. A translation, not a definition. Context matters: "como" is "like" in one sentence and "I eat" in another.
- "note": max 8 words, ONLY when genuinely useful (irregular verb, false friend, gendered form, common idiom). Otherwise null.

Gloss every single word, including function words — a beginner needs "de" and "que" as much as any noun. Do not skip any word from the list.

Respond with ONLY a JSON object, no preamble, no markdown fences:
{"words": [{"w": "novia", "lemma": "novia", "pos": "noun", "en": "girlfriend", "cs": "přítelkyně", "de": "Freundin", "fr": "copine", "note": null}]}`;

  const parsed = await chatJson(prompt);
  const rows = (parsed.words ?? []) as Record<string, unknown>[];
  const dictionary: Record<string, GlossOut> = {};
  for (const row of rows) {
    const key = normalizeSurface(String(row.w ?? ''));
    if (!key) continue;
    dictionary[key] = {
      lemma: typeof row.lemma === 'string' && row.lemma ? row.lemma : key,
      pos: typeof row.pos === 'string' && row.pos ? row.pos : 'other',
      note: typeof row.note === 'string' && row.note ? row.note : null,
      glosses: Object.fromEntries(
        Object.keys(TARGET_LANGS).map((lang) => [
          lang,
          typeof row[lang] === 'string' ? (row[lang] as string) : '',
        ])
      ),
    };
  }
  const missing = unique.filter((w) => !(w in dictionary));
  if (missing.length > 0) {
    console.warn(
      `  ! ${missing.length} word(s) missing from gloss response: ${missing.slice(0, 8).join(', ')}`
    );
  }
  return dictionary;
}
