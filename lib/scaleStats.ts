/**
 * The scaler dashboard's arithmetic: every reel scored against its own
 * channel's usual reel AT THE TIME IT WAS POSTED, rankings that say how many
 * reels back them, and the small text helpers that turn a cut job or a cover
 * into tags. Pure, so the page, the API and the scaler's report agree.
 *
 * Plain relative imports only — node --test loads this file.
 */
import { BASELINE_POSTS, median, sharesSavesPer1k, type MarketingPost } from './marketingStats.ts';
import { hookKey } from './cutReels.ts';

export type HookKind = 'question' | 'statement';
export type Format = 'cut' | 'phrases' | 'outline-game' | 'other';
export type DemoKind = 'reels' | 'peppa' | 'other' | 'unknown';
export type Voice = 'i' | 'you';

export const FORMATS: Format[] = ['cut', 'phrases', 'outline-game', 'other'];
export const DEMO_KINDS: DemoKind[] = ['reels', 'peppa', 'other', 'unknown'];
export const HOOK_KINDS: HookKind[] = ['question', 'statement'];

export type PostTags = {
  hook: string | null;
  hookSource: 'cut' | 'cover' | 'manual' | null;
  hookKind: HookKind | null;
  format: Format;
  demoKind: DemoKind;
  line1Variant: string | null;
  voice: Voice | null;
  cutReelId: string | null;
  manual: boolean;
};

export type ScoredPost = MarketingPost & {
  tags: PostTags | null;
  /** The channel's usual views when this reel went up. */
  baseline: number | null;
  multiple: number | null;
  commentsPer1k: number | null;
  sharesSavesPer1k: number | null;
  /** 48h+ old: Instagram's numbers have mostly settled. */
  settled: boolean;
};

const SETTLE_MS = 48 * 3600 * 1000;
/** Fewer earlier reels than this and there is no "usual": a channel's 2nd reel would otherwise score 10x off its 1st. */
export const MIN_BASELINE_POSTS = 3;

/** Median views of the account's BASELINE_POSTS most recent posts that were already 48h+ old at `at`. */
export function baselineAt(posts: MarketingPost[], igUserId: string, at: Date): number | null {
  const cutoff = at.getTime() - SETTLE_MS;
  const views = posts
    .filter((p) => p.igUserId === igUserId && p.latest?.views != null && new Date(p.postedAt).getTime() <= cutoff)
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
    .slice(0, BASELINE_POSTS)
    .map((p) => p.latest!.views!);
  return views.length >= MIN_BASELINE_POSTS ? median(views) : null;
}

export function scorePosts(posts: MarketingPost[], tags: Map<string, PostTags>, now: Date = new Date()): ScoredPost[] {
  return posts.map((p) => {
    const baseline = baselineAt(posts, p.igUserId, new Date(p.postedAt));
    const views = p.latest?.views ?? null;
    return {
      ...p,
      tags: tags.get(p.mediaId) ?? null,
      baseline,
      multiple: views != null && baseline != null && baseline > 0 ? views / baseline : null,
      commentsPer1k: views != null && views > 0 && p.latest?.comments != null ? (p.latest.comments / views) * 1000 : null,
      sharesSavesPer1k: sharesSavesPer1k(p.latest),
      settled: now.getTime() - new Date(p.postedAt).getTime() >= SETTLE_MS,
    };
  });
}

export type Dimension = 'hook' | 'hookKind' | 'format' | 'demoKind' | 'line1Variant' | 'voice' | 'account';
/** fading = it won overall, but its last 3 reels are under 0.8x: burned out, don't push it. */
export type Verdict = 'winning' | 'promising' | 'ordinary' | 'fading' | 'losing';

export type RankRow = {
  key: string;
  /** A readable label: the first hook text seen for this key, or the key itself. */
  label: string;
  n: number;
  medianMultiple: number | null;
  min: number | null;
  max: number | null;
  totalViews: number;
  verdict: Verdict;
  /** mediaIds, best multiple first, at most 3. */
  examples: string[];
  /** Hooks only: how many distinct wordings were folded into this family. */
  variants?: number;
  /** Median multiple of its 3 most recent settled reels: recent form, which can differ from the all-time record. */
  recentMedian: number | null;
};

/** Winning needs 3+ reels at a 1.5x median; fewer is only promising. */
export function verdictOf(n: number, med: number | null): Verdict {
  if (med == null) return 'ordinary';
  if (med >= 1.5) return n >= 3 ? 'winning' : 'promising';
  if (n >= 3 && med < 0.8) return 'losing';
  return 'ordinary';
}

const VERDICT_ORDER: Verdict[] = ['winning', 'promising', 'fading', 'ordinary', 'losing'];
/** How many of a group's newest reels make its recent form. */
export const RECENT_REELS = 3;

/** Wordings this alike are the same hook ("1000 words in ONE MONTH" / "2000 words in one month"). */
const FAMILY_SIMILARITY = 0.8;

/**
 * hookKey → family key. Greedy: the most used wording founds a family and
 * every later wording joins the first family it's FAMILY_SIMILARITY alike.
 */
export function hookFamilies(hooks: string[]): Map<string, string> {
  const count = new Map<string, number>();
  for (const h of hooks) {
    const k = hookKey(h);
    if (k) count.set(k, (count.get(k) ?? 0) + 1);
  }
  const reps: string[] = [];
  const out = new Map<string, string>();
  for (const k of [...count.keys()].sort((a, b) => count.get(b)! - count.get(a)! || a.localeCompare(b))) {
    const rep = reps.find((r) => textSimilarity(r, k) >= FAMILY_SIMILARITY);
    if (rep) out.set(k, rep);
    else {
      reps.push(k);
      out.set(k, k);
    }
  }
  return out;
}

function keyOf(p: ScoredPost, dim: Dimension, families: Map<string, string>): { key: string; label: string } | null {
  const t = p.tags;
  switch (dim) {
    case 'account':
      return { key: p.igUserId, label: p.igUserId };
    case 'hook': {
      if (!t?.hook) return null;
      const k = hookKey(t.hook);
      return k ? { key: families.get(k) ?? k, label: t.hook } : null;
    }
    default: {
      const v = t?.[dim];
      return v ? { key: String(v), label: String(v) } : null;
    }
  }
}

export function rankBy(posts: ScoredPost[], dim: Dimension): RankRow[] {
  const ranked = posts.filter((p) => p.settled && p.multiple != null);
  const families = dim === 'hook' ? hookFamilies(ranked.map((p) => p.tags?.hook ?? '').filter(Boolean)) : new Map<string, string>();
  const groups = new Map<string, { labels: Map<string, number>; ps: ScoredPost[] }>();
  for (const p of ranked) {
    const k = keyOf(p, dim, families);
    if (!k) continue;
    if (!groups.has(k.key)) groups.set(k.key, { labels: new Map(), ps: [] });
    const g = groups.get(k.key)!;
    g.labels.set(k.label, (g.labels.get(k.label) ?? 0) + 1);
    g.ps.push(p);
  }
  const rows: RankRow[] = [];
  for (const [key, { labels, ps }] of groups) {
    // the most common wording names the family
    const label = [...labels].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    const wordings = new Set(ps.map((p) => hookKey(p.tags?.hook ?? ''))).size;
    const ms = ps.map((p) => p.multiple!);
    const med = median(ms);
    const recent = [...ps].sort((a, b) => b.postedAt.localeCompare(a.postedAt)).slice(0, RECENT_REELS).map((p) => p.multiple!);
    const recentMedian = median(recent);
    let verdict = verdictOf(ps.length, med);
    // it won before, but the newest reels flop: the hook is burned out
    if (ps.length > RECENT_REELS && med != null && med >= 1.5 && recentMedian != null && recentMedian < 0.8) verdict = 'fading';
    // all-time winning but lately only ordinary: not a winner to push any more
    else if (verdict === 'winning' && recentMedian != null && recentMedian < 1) verdict = 'ordinary';
    rows.push({
      key,
      label,
      n: ps.length,
      medianMultiple: med,
      min: Math.min(...ms),
      max: Math.max(...ms),
      totalViews: ps.reduce((s, p) => s + (p.latest?.views ?? 0), 0),
      verdict,
      recentMedian,
      examples: [...ps].sort((a, b) => b.multiple! - a.multiple!).slice(0, 3).map((p) => p.mediaId),
      ...(dim === 'hook' ? { variants: wordings } : {}),
    });
  }
  return rows.sort(
    (a, b) => VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict) || (b.medianMultiple ?? 0) - (a.medianMultiple ?? 0)
  );
}

/** A viewer's question (it has a ? or opens with a quote) or a statement. */
export function inferHookKind(hook: string): HookKind {
  return /\?/.test(hook) || /^\s*["“'‘]/.test(hook) ? 'question' : 'statement';
}

/**
 * What line 1 says about how you learn: the thing the format varies. The
 * "ummm by…" filler that answers a question hook is not a variant of its own
 * (the hook's kind already records the question); what follows it is.
 */
export function line1Variant(line: string): string {
  if (/peppa/i.test(line)) return 'peppa';
  if (/reel|scroll/i.test(line)) return 'reels';
  const rest = line.replace(/^\s*(u+m+|m{2,})\b[\s.,…]*(by\s+)?/i, '');
  return rest.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').trim().split(/\s+/).slice(0, 4).join(' ');
}

export function voiceOf(lines: string[]): Voice | null {
  const all = lines.join(' ');
  if (/\byou\b/i.test(all)) return 'you';
  if (/\b(i|me|my)\b/i.test(all)) return 'i';
  return null;
}

export type OcrLine = { text: string; h: number };

const SHORT_WORDS = ['wtf', 'lol', 'now', 'this', 'omg'];

/**
 * The hook off a cover. OCR lines arrive top to bottom; the hook is the big
 * text, so lines much smaller than the tallest readable one are background
 * (the notebook, the app's UI). Emoji tend to be misread as a stray letter
 * glued to the last word ("wtf😭" → "wtfo"), which is dropped.
 */
export function cleanCoverText(lines: OcrLine[]): string | null {
  const readable = lines.filter((l) => {
    const letters = (l.text.match(/[A-Za-z]/g) ?? []).length;
    const chars = l.text.replace(/\s/g, '').length;
    return letters >= 3 && chars > 0 && letters / chars >= 0.5;
  });
  if (readable.length === 0) return null;
  const tallest = Math.max(...readable.map((l) => l.h));
  const run: string[] = [];
  let started = false;
  for (const l of lines) {
    const keep = readable.includes(l) && l.h >= 0.7 * tallest;
    if (keep) {
      run.push(l.text.trim());
      started = true;
    } else if (started) break;
  }
  let text = run
    .join(' ')
    .replace(/[®©™°]+/g, '')
    .replace(/(\w)- (\w)/g, '$1-$2') // "Spanish- speaking" split across lines
    .replace(/ -(\w)/g, ' $1') // "soo -quick": a stray dash from the line break
    .replace(/([?!])\s*[A-Za-z]\s*(["”]?)\s*$/, '$1$2') // "month??t\"": the emoji after the hook misread as a letter
    .trim();
  // the junk an emoji leaves sits at the end, or just before a closing quote
  const quote = /["”]$/.test(text) && /^\W*["“]/.test(text) ? text.slice(-1) : '';
  if (quote) text = text.slice(0, -1);
  text =
    text
      .replace(/[^A-Za-z0-9.!?…'"”]+$/, '')
      .replace(/(\s+\d{1,3})+$/, '') // " 6", " 338": an emoji read as digits
      .replace(/\b([A-Z]{3,})[\d&%$#]+$/, '$1') // "MONTH83", "FAST838": glued to a capitalised word
      .replace(/[^A-Za-z0-9.!?…'"”]+$/, '')
      .trim() + quote;
  const words = text.split(/\s+/);
  const last = words[words.length - 1]?.toLowerCase().replace(/[^a-z]/g, '') ?? '';
  const glued = SHORT_WORDS.find((w) => last.length === w.length + 1 && last.startsWith(w));
  if (glued) words[words.length - 1] = words[words.length - 1].slice(0, glued.length);
  text = words.join(' ');
  return words.length >= 3 ? text : null;
}

/** Phrase reels ("Things to say when…", "Spanish phrases to use…") by their hook; everything else stays "other" until tagged. */
export function inferFormat(hook: string): Format {
  return /^\W*(things (to say|a|you|people)|((basic|useful|common|essential) )?spanish (phrases|words)|phrases|words to|how to (say|call|flirt|ask|tell|order|reply)|ways to say|stages of)\b/i.test(hook)
    ? 'phrases'
    : 'other';
}

/** Dice coefficient on lowercase letter/digit bigrams, 0..1. */
export function textSimilarity(a: string, b: string): number {
  const grams = (s: string) => {
    const t = s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const out = new Map<string, number>();
    for (let i = 0; i < t.length - 1; i++) {
      const g = t.slice(i, i + 2);
      out.set(g, (out.get(g) ?? 0) + 1);
    }
    return out;
  };
  const A = grams(a);
  const B = grams(b);
  const size = (m: Map<string, number>) => [...m.values()].reduce((s, x) => s + x, 0);
  const total = size(A) + size(B);
  if (total === 0) return 0;
  let both = 0;
  for (const [g, n] of A) both += Math.min(n, B.get(g) ?? 0);
  return (2 * both) / total;
}

export type PlanItemResult = { expected: number | null; actual: number | null; role: 'exploit' | 'test' };

/** How the scaler's picks did: exploit vs test medians, and how often a reel met its expected multiple. */
export function trackRecord(items: PlanItemResult[]): {
  exploit: { n: number; median: number | null };
  test: { n: number; median: number | null };
  hitRate: number | null;
} {
  const side = (role: 'exploit' | 'test') => {
    const xs = items.filter((i) => i.role === role && i.actual != null).map((i) => i.actual!);
    return { n: xs.length, median: median(xs) };
  };
  const judged = items.filter((i) => i.actual != null && i.expected != null);
  return {
    exploit: side('exploit'),
    test: side('test'),
    hitRate: judged.length ? judged.filter((i) => i.actual! >= i.expected!).length / judged.length : null,
  };
}
