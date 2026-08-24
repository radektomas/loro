// Relative and extension-ed, not '@/lib/…': core's modules load under plain
// node for their tests (same rule as catalogLoader.ts).
import {
  CatalogContentError,
  fetchPointerAt,
  getText,
  joinUrl,
  parseJson,
  type CatalogFetch,
  type CatalogPointer,
} from './catalogLoader.ts';

/**
 * The word-explanations blob: pregenerated learner notes per LEMMA, published
 * beside the catalog in the same public bucket with the same two-object
 * discipline (immutable content-hash blob, mutable pointer written last):
 *
 *   explanations/latest.json   the pointer — {hash, count, generatedAt}
 *   explanations/<hash>.json   Record<lemma, WordExplanation>
 *
 * Keyed by lemma, not surface: surfaces resolve to a lemma through
 * Video.dictionary (the same path WordSheet already walks), and one record
 * then serves "trabajo", "trabaja", "trabajan" alike.
 *
 * Content is authored offline (data/explanations/batches/, validated by
 * scripts/lib/explanations.mts and published by
 * scripts/publish-explanations.mts). This module is only the client-side
 * loader; it shares catalogLoader's transport, error taxonomy and fail-loud
 * validation policy — a truncated blob that parses is worse than a failed
 * fetch, so there is no partial-success path.
 *
 * Renderers pull example SENTENCES from the catalog by {videoId, cueIndex} —
 * examples are real spoken cues, never invented text — so a record's examples
 * can dangle if the referenced video has since been pruned from the catalog.
 * That is the renderer's case to handle (skip the example), not a load error:
 * the blob and the catalog are published independently.
 */

export const EXPLANATION_LANGS = ['en', 'cs', 'de', 'fr'] as const;
export type ExplanationLang = (typeof EXPLANATION_LANGS)[number];

export type ExplanationExample = {
  videoId: string;
  cueIndex: number;
};

export type WordExplanation = {
  lemma: string;
  /** noun | verb | adj | … — the dominant pos among the lemma's catalog glosses. */
  pos: string;
  /** 1–2 sentence usage/context note, per language. All four present. */
  usage: Record<ExplanationLang, string>;
  /** Grammar note (gender, conjugation family, clitics…) or null; if present,
      all four languages. */
  grammar: Record<ExplanationLang, string> | null;
  register: 'neutral' | 'informal' | 'formal' | 'slang' | null;
  /** 1–3 real catalog cues that speak this lemma. */
  examples: ExplanationExample[];
};

export const EXPLANATIONS_POINTER_PATH = 'explanations/latest.json';

export function explanationsPath(hash: string): string {
  return `explanations/${hash}.json`;
}

export const REGISTERS = ['neutral', 'informal', 'formal', 'slang'] as const;

/** Validate one record, or throw. Field-by-field: the blob is authored (and
    merged) by tooling, and a hole here renders as a broken sheet. */
function assertExplanation(
  url: string,
  key: string,
  value: unknown
): WordExplanation {
  const where = `entry "${key}"`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CatalogContentError(url, `${where} is not an object`);
  }
  const raw = value as Partial<WordExplanation>;
  if (raw.lemma !== key) {
    throw new CatalogContentError(url, `${where} lemma does not match its key`);
  }
  if (typeof raw.pos !== 'string' || raw.pos.trim() === '') {
    throw new CatalogContentError(url, `${where} has no pos`);
  }
  const langRecord = (field: string, v: unknown): Record<ExplanationLang, string> => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      throw new CatalogContentError(url, `${where} ${field} is not an object`);
    }
    for (const lang of EXPLANATION_LANGS) {
      const text = (v as Record<string, unknown>)[lang];
      if (typeof text !== 'string' || text.trim() === '') {
        throw new CatalogContentError(url, `${where} ${field} is missing "${lang}"`);
      }
    }
    return v as Record<ExplanationLang, string>;
  };
  langRecord('usage', raw.usage);
  if (raw.grammar !== null) langRecord('grammar', raw.grammar);
  if (
    raw.register !== null &&
    !REGISTERS.includes(raw.register as (typeof REGISTERS)[number])
  ) {
    throw new CatalogContentError(url, `${where} register "${String(raw.register)}" is not recognised`);
  }
  if (
    !Array.isArray(raw.examples) ||
    raw.examples.length < 1 ||
    raw.examples.length > 3
  ) {
    throw new CatalogContentError(url, `${where} needs 1–3 examples`);
  }
  for (const example of raw.examples) {
    const ex = example as Partial<ExplanationExample> | null;
    if (
      !ex ||
      typeof ex !== 'object' ||
      typeof ex.videoId !== 'string' ||
      ex.videoId.trim() === '' ||
      typeof ex.cueIndex !== 'number' ||
      !Number.isInteger(ex.cueIndex) ||
      ex.cueIndex < 0
    ) {
      throw new CatalogContentError(url, `${where} has a malformed example`);
    }
  }
  return value as WordExplanation;
}

/** Fetch and validate explanations/latest.json. */
export async function fetchExplanationsPointer(
  fetchFn: CatalogFetch,
  baseUrl: string
): Promise<CatalogPointer> {
  return fetchPointerAt(fetchFn, baseUrl, EXPLANATIONS_POINTER_PATH);
}

/**
 * Fetch and validate explanations/<hash>.json. `expectedCount` is the
 * truncation check (number of lemmas); pass null only as a deliberate act,
 * same contract as fetchCatalogBlob.
 */
export async function fetchExplanationsBlob(
  fetchFn: CatalogFetch,
  baseUrl: string,
  hash: string,
  expectedCount: number | null
): Promise<Record<string, WordExplanation>> {
  const url = joinUrl(baseUrl, explanationsPath(hash));
  const parsed = parseJson(url, await getText(fetchFn, url));

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CatalogContentError(url, 'explanations blob is not an object');
  }
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (expectedCount !== null && keys.length !== expectedCount) {
    throw new CatalogContentError(
      url,
      `blob holds ${keys.length} lemmas, pointer says ${expectedCount} — truncated or stale`
    );
  }
  if (keys.length === 0) {
    throw new CatalogContentError(url, 'explanations blob is empty');
  }
  for (const key of keys) assertExplanation(url, key, record[key]);
  return parsed as Record<string, WordExplanation>;
}
