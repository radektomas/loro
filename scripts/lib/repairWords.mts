import { chatJson } from './glossCues.mts';
import type { CueWord } from './json3ToCues.mts';

/**
 * Repair an unpunctuated ASR word stream, token for token.
 *
 * WHY. YouTube serves two tiers of Spanish auto-captions. The newer one is
 * punctuated and capitalised, and the cue chunker turns it into one clean
 * sentence per cue. The older one is a bare word stream: no sentence ends,
 * so cues can only break on pauses, run 8–11s, split mid-sentence, and carry
 * the recogniser's mishearings ("poli" for Polly, "pepp" for Peppa, "seor").
 * On 2026-09-21, 15 of 16 single Peppa episodes on the official channel were
 * the old tier — including four uploaded the SAME DAY as the one good one,
 * so the tier is not something a smarter search can route around.
 *
 * HOW (third design, 2026-09-21). The model is asked for the one thing it is
 * good at: rewrite the word stream as correctly punctuated Spanish, plain
 * text, keeping every word. WE align that text back onto the original tokens
 * with an edit-distance alignment (alignWords) — nothing the model returns
 * is positional, so a word it drops costs ONE flagged token instead of
 * shifting everything after it. Timings are never touched: every output
 * token inherits its input token's start/end, which is what keeps the
 * karaoke, the blanks and the word taps exactly as aligned as they were.
 *
 * The two designs this replaces, so nobody rebuilds them:
 *   1. "Echo every token with its index." The model drops a token mid-way,
 *      keeps numbering consecutively, and every later index carries its
 *      neighbour's text. Indices cannot detect a shift the model renumbers.
 *      Two episodes, 48% and 16% "rewritten", both rejected — 8¢ each.
 *   2. "Return only the tokens you would change." Lazy: 2–7 changes per
 *      episode, sentence-ended share never left the floor. And gpt-4o-mini
 *      hallucinated single-word swaps ("soy" → "sé", "el" → "¿Dónde") that
 *      sit under any cap. Cheap and useless.
 *
 * THE VERIFIER IS STILL THE POINT. applyRepair() sorts every changed token
 * into three tiers and refuses the answer if the third gets out of hand:
 *   punctuation / case  — free ("pig" → "Pig.")
 *   accents             — free, counted ("esta" → "está")
 *   letters             — a CORRECTION: counted, capped, listed one by one
 * The alignment adds two more refusals: too many tokens the model dropped
 * (kept as they were), or a substitution whose letters bear no resemblance
 * to the original (kept as it was, and reported) — that is how a confident
 * hallucination is caught: "lauel" → "Claro," does not align, "poli" →
 * "Polly" does.
 */

export const REPAIR_MODEL = 'gpt-4o';

/** Above this share of tokens with changed LETTERS the repair is rejected. */
export const MAX_CHANGED_SHARE = 0.08;
/** Above this share of input tokens the model simply left out, reject: it
 *  is summarising, not punctuating. */
export const MAX_DROPPED_SHARE = 0.05;
/**
 * A substitution is a plausible mishearing when the skeletons are this
 * close (normalised Levenshtein): poli/polly 0.4, pepp/peppa 0.2,
 * dinosauri/dinosaurio 0.1. lauel/claro is 0.8 and is refused.
 */
export const MAX_SUBSTITUTION_DISTANCE = 0.5;

export type RepairChange = { i: number; from: string; to: string };

export type RepairResult = {
  words: CueWord[];
  /** Tokens whose letters changed — the corrections, for review. */
  changes: RepairChange[];
  /** Tokens that only gained punctuation or capitalisation. */
  punctuated: number;
  /** Tokens that only gained or lost accents. */
  accents: number;
};

export class RepairRejected extends Error {
  constructor(reason: string) {
    super(`repair rejected: ${reason}`);
    this.name = 'RepairRejected';
  }
}

/** Letters and digits only, lower-cased, accents kept. */
export function letters(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/** letters() with the accents stripped too — what "the same word" means for
 *  the cap. "esta" and "está" share a skeleton; "poli" and "polly" do not. */
export function skeleton(s: string): string {
  return letters(s).normalize('NFD').replace(/\p{M}/gu, '');
}

/** Plain Levenshtein, normalised by the longer length. 0 = same, 1 = nothing shared. */
export function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length || !b.length) return 1;
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length] / Math.max(a.length, b.length);
}

// ── Alignment ───────────────────────────────────────────────────────────────

const COST_MATCH = 0;
const COST_SUBSTITUTE_CLOSE = 1;
const COST_SUBSTITUTE_FAR = 4;
const COST_GAP = 2;

export type Alignment = {
  /** One text per input token — the model's word (with its punctuation) or
   *  the original when the model dropped it or its substitute was refused. */
  proposed: string[];
  /** Input tokens the model left out; kept as they were. */
  dropped: number[];
  /** Model words that matched nothing; discarded. */
  inserted: string[];
  /** Substitutions refused for bearing no resemblance; kept as they were. */
  refused: RepairChange[];
};

/**
 * Pure. Align the model's punctuated text onto the input tokens.
 * Needleman–Wunsch over skeletons: a match is free, a close substitution is
 * cheap, a far one is dear, a gap on either side costs in between — so the
 * aligner prefers "this word was misheard" over "this word was dropped and
 * another inserted" only when the letters actually resemble each other.
 */
export function alignWords(words: readonly CueWord[], text: string): Alignment {
  const out = text
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
  const a = words.map((w) => skeleton(w.text));
  const b = out.map((w) => skeleton(w));
  const n = a.length;
  const m = b.length;

  // Words with no letters at all ("—", "…") can only ever be insertions.
  const subCost = (i: number, j: number): number => {
    if (!b[j]) return Infinity;
    if (a[i] === b[j]) return COST_MATCH;
    return distance(a[i], b[j]) <= MAX_SUBSTITUTION_DISTANCE
      ? COST_SUBSTITUTE_CLOSE
      : COST_SUBSTITUTE_FAR;
  };

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) dp[i][0] = i * COST_GAP;
  for (let j = 1; j <= m; j++) dp[0][j] = j * COST_GAP;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j - 1] + subCost(i - 1, j - 1),
        dp[i - 1][j] + COST_GAP,
        dp[i][j - 1] + COST_GAP
      );
    }
  }

  const proposed = words.map((w) => w.text);
  const dropped: number[] = [];
  const inserted: string[] = [];
  const refused: RepairChange[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + subCost(i - 1, j - 1)) {
      const cost = subCost(i - 1, j - 1);
      if (cost === COST_SUBSTITUTE_FAR) {
        refused.push({ i: i - 1, from: words[i - 1].text, to: out[j - 1] });
      } else {
        proposed[i - 1] = out[j - 1];
      }
      i -= 1;
      j -= 1;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + COST_GAP) {
      dropped.push(i - 1);
      i -= 1;
    } else {
      inserted.push(out[j - 1]);
      j -= 1;
    }
  }
  dropped.reverse();
  inserted.reverse();
  refused.reverse();
  return { proposed, dropped, inserted, refused };
}

/**
 * Pure. Apply a full proposed token list to the original words, or throw
 * RepairRejected. The per-token half of the verifier.
 */
export function applyRepair(
  words: readonly CueWord[],
  proposed: readonly string[]
): RepairResult {
  if (proposed.length !== words.length) {
    throw new RepairRejected(
      `token count ${proposed.length} does not match the ${words.length} sent`
    );
  }
  const out: CueWord[] = [];
  const changes: RepairChange[] = [];
  let punctuated = 0;
  let accents = 0;
  for (let i = 0; i < words.length; i++) {
    const from = words[i].text;
    const to = (proposed[i] ?? '').trim();
    if (!to) throw new RepairRejected(`token ${i} ("${from}") came back empty`);
    if (/\s/.test(to)) {
      throw new RepairRejected(`token ${i} ("${from}") came back as two words ("${to}")`);
    }
    if (!letters(to)) {
      throw new RepairRejected(`token ${i} ("${from}") came back as punctuation only ("${to}")`);
    }
    if (skeleton(to) !== skeleton(from)) changes.push({ i, from, to });
    else if (letters(to) !== letters(from)) accents += 1;
    else if (to !== from) punctuated += 1;
    out.push({ ...words[i], text: to });
  }
  const share = changes.length / words.length;
  if (share > MAX_CHANGED_SHARE) {
    const sample = changes
      .slice(0, 12)
      .map((c) => `#${c.i} ${c.from}→${c.to}`)
      .join(', ');
    throw new RepairRejected(
      `${changes.length} of ${words.length} tokens rewritten (${(share * 100).toFixed(1)}%) — ` +
        `over the ${MAX_CHANGED_SHARE * 100}% cap, that is paraphrase not repair. ` +
        `First diffs: ${sample}`
    );
  }
  return { words: out, changes, punctuated, accents };
}

function buildPrompt(words: readonly CueWord[], videoName: string): string {
  return `Below is the raw word stream of YouTube's automatic Spanish captions for one video ("${videoName}"). The speech recogniser dropped all punctuation and capitalisation, and misheard a few words.

Rewrite it as correctly punctuated, capitalised Spanish subtitle text, the way a careful subtitle editor would: capitals at sentence starts, "." "?" "!" at sentence ends, "¿" and "¡" opening questions and exclamations, commas where speech naturally pauses. Put one sentence per line.

Rules:
- Keep EVERY word, in the same order. Do not add words, drop words, merge two into one, or split one into two. Do not paraphrase. Do not change tense, person or number.
- Restore missing accents ("esta" → "está", "que" → "qué") where the sentence requires them.
- Correct a misheard word ONLY when the right word is certain from the sentence and the video's title — proper names ("poli" → "Polly" in an episode about a parrot called Polly; "pepp" → "Peppa"), clipped words ("dinosauri" → "dinosaurio"). If you are not sure what a word was, leave it exactly as it is.

Word stream:
${words.map((w) => w.text).join(' ')}

Respond with ONLY a JSON object, no preamble, no markdown fences:
{"text": "Yo soy Peppa Pig.\\nEste es mi hermano pequeño, George.\\n..."}`;
}

/** Network half: one call, align, verify. */
export async function repairWords(
  words: readonly CueWord[],
  videoName: string
): Promise<RepairResult & { ignored: string[] }> {
  if (words.length === 0) return { words: [], changes: [], punctuated: 0, accents: 0, ignored: [] };
  const parsed = await chatJson(buildPrompt(words, videoName), REPAIR_MODEL);
  const text = typeof parsed.text === 'string' ? parsed.text : '';
  if (!text.trim()) throw new RepairRejected('response carried no "text"');

  const aligned = alignWords(words, text);
  const droppedShare = aligned.dropped.length / words.length;
  if (droppedShare > MAX_DROPPED_SHARE) {
    throw new RepairRejected(
      `model left out ${aligned.dropped.length} of ${words.length} words (${(droppedShare * 100).toFixed(1)}%) — ` +
        `summarising, not punctuating. First: ${aligned.dropped
          .slice(0, 10)
          .map((i) => `#${i} ${words[i].text}`)
          .join(', ')}`
    );
  }
  const ignored: string[] = [];
  for (const i of aligned.dropped) ignored.push(`kept #${i} "${words[i].text}" — the model dropped it`);
  for (const w of aligned.inserted) ignored.push(`discarded inserted word "${w}"`);
  for (const r of aligned.refused) {
    ignored.push(`kept #${r.i} "${r.from}" — the model's "${r.to}" bears no resemblance`);
  }
  return { ...applyRepair(words, aligned.proposed), ignored };
}
