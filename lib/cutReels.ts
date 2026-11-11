/**
 * The reel cutter (getloro.app/cut): shared constants and the hook arithmetic.
 *
 * THE ONE IDEA, borrowed from lib/marketingStats.ts: raw views are not
 * evidence, because the three accounts live at very different sizes. A reel
 * counts as a multiple of ITS account's median reel, and a hook is judged by
 * the average multiple of the reels that carried it. 1.0x is an ordinary reel.
 *
 * Plain relative imports only — this file is also imported by node --test and
 * by the .mts scripts on Radek's Mac.
 */
import { median } from './marketingStats.ts';

export const CUT_BUCKET = 'loro-cuts';

export const ACCOUNTS = ['radek.spanish', 'radek.explains.spanish', 'loro.app'] as const;
export type Account = (typeof ACCOUNTS)[number];

export type CutStatus = 'review' | 'approved' | 'posted' | 'dropped';

export type CutLine = { text: string; from: number; to: number };

export type CutNote = {
  id: string;
  reelId: string;
  version: number;
  atS: number;
  body: string;
  createdAt: string;
  doneVersion: number | null;
  reply: string | null;
};

export type CutReel = {
  id: string;
  account: Account;
  batch: string;
  slot: number;
  version: number;
  hook: string;
  lines: CutLine[];
  durationS: number;
  /** Signed, short-lived. */
  videoUrl: string | null;
  posterUrl: string | null;
  meFile: string | null;
  demoFile: string | null;
  status: CutStatus;
  permalink: string | null;
  igMediaId: string | null;
  /** Instagram's number when the post is synced on /marketing, else the typed one. */
  views: number | null;
  viewsSource: 'instagram' | 'manual' | null;
  postedAt: string | null;
  createdAt: string;
  notes: CutNote[];
};

/** Written by scripts/cut/wait-notes.mts: a heartbeat while a chat waits, "working" while one recuts. */
export type CutWorker = { state: 'watching' | 'working'; noteIds: string[]; at: string };

/** A chat counts as watching if its heartbeat (every 60 s) is under 3 minutes old. */
export function workerView(w: CutWorker | null, now = Date.now()): 'working' | 'watching' | 'offline' {
  if (!w) return 'offline';
  const age = now - Date.parse(w.at);
  if (w.state === 'working') return age < 40 * 60_000 ? 'working' : 'offline';
  return age < 3 * 60_000 ? 'watching' : 'offline';
}

export type HookStat = {
  hook: string;
  /** Reels cut with this hook, any status. */
  used: number;
  /** Posted reels with a view count. */
  measured: number;
  avgViews: number | null;
  /** Mean of views / account median; null until a reel has views. */
  avgMultiple: number | null;
  best: { views: number; account: Account } | null;
};

/** Same hook despite emoji, spacing, case or punctuation tweaks. */
export function hookKey(hook: string): string {
  return hook
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The shortcode in an Instagram reel/post link, used to match a synced post. */
export function shortcodeOf(permalink: string | null | undefined): string | null {
  const m = (permalink ?? '').match(/instagram\.com\/(?:[^/]+\/)?(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

type Measurable = Pick<CutReel, 'account' | 'hook' | 'views' | 'status'>;

/** Ranks hooks: measured ones by average multiple (best first), then the unmeasured. */
export function hookStats(reels: Measurable[]): HookStat[] {
  const medians = new Map<Account, number | null>();
  for (const a of ACCOUNTS) {
    medians.set(a, median(reels.filter((r) => r.account === a && r.views != null).map((r) => r.views!)));
  }
  const by = new Map<string, { hook: string; rs: Measurable[] }>();
  for (const r of reels) {
    if (r.status === 'dropped') continue;
    const k = hookKey(r.hook);
    if (!by.has(k)) by.set(k, { hook: r.hook, rs: [] });
    by.get(k)!.rs.push(r);
  }
  const out: HookStat[] = [];
  for (const { hook, rs } of by.values()) {
    const measured = rs.filter((r) => r.views != null);
    const multiples = measured
      .map((r) => {
        const m = medians.get(r.account);
        return m && m > 0 ? r.views! / m : null;
      })
      .filter((x): x is number => x != null);
    const best = measured.reduce<Measurable | null>((b, r) => (b == null || r.views! > b.views! ? r : b), null);
    out.push({
      hook,
      used: rs.length,
      measured: measured.length,
      avgViews: measured.length ? measured.reduce((s, r) => s + r.views!, 0) / measured.length : null,
      avgMultiple: multiples.length ? multiples.reduce((s, x) => s + x, 0) / multiples.length : null,
      best: best ? { views: best.views!, account: best.account } : null,
    });
  }
  return out.sort((a, b) => {
    if (a.avgMultiple != null && b.avgMultiple != null) return b.avgMultiple - a.avgMultiple;
    if (a.avgMultiple != null) return -1;
    if (b.avgMultiple != null) return 1;
    return b.used - a.used;
  });
}

/** 0:04.2 */
export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
}
