'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { DASH } from '../RadekDashboard';
import type { MarketingData } from '@/lib/marketingStats';
import { scorePosts, type PostTags, type ScoredPost } from '@/lib/scaleStats';
import { Overview } from './Overview';
import { Reels } from './Reels';
import { Winners } from './Winners';
import { Plan } from './Plan';
import { Leaderboard } from './Leaderboard';

/**
 * The scaler dashboard: /marketing's tabs, the hook leaderboard first. Every reel is scored once,
 * here, against its own channel's usual reel at the time it was posted
 * (lib/scaleStats.ts), and every tab reads the same scores.
 */

export type Act = (path: string, method: 'PATCH' | 'PUT', body: unknown) => Promise<string | null>;

export type Model = {
  data: MarketingData;
  /** Reels only (feed images aren't comparable), newest first. */
  reels: ScoredPost[];
  byId: Map<string, ScoredPost>;
  username: (igUserId: string) => string;
  /** Send an edit, then reload; resolves to an error message or null. */
  act: Act;
};

const TABS = [
  { id: 'leaderboard', label: 'Hook leaderboard' },
  { id: 'overview', label: 'Overview' },
  { id: 'reels', label: 'Reels' },
  { id: 'winners', label: 'Winners' },
  { id: 'plan', label: 'Plan' },
] as const;
type Tab = (typeof TABS)[number]['id'];

const tabFromHash = (): Tab => {
  const h = typeof window === 'undefined' ? '' : window.location.hash.slice(1);
  return (TABS.find((t) => t.id === h)?.id ?? 'leaderboard') as Tab;
};

export function ScaleDashboard({ data, act, accountsPanel, header }: { data: MarketingData; act: Act; accountsPanel: ReactNode; header: ReactNode }) {
  const [tab, setTab] = useState<Tab>('leaderboard');
  useEffect(() => {
    setTab(tabFromHash());
    const on = () => setTab(tabFromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (t: Tab) => {
    history.replaceState(null, '', `#${t}`);
    setTab(t);
    window.scrollTo({ top: 0 });
  };

  const model: Model = useMemo(() => {
    const names = new Map(data.accounts.map((a) => [a.igUserId, a.username]));
    const tags = new Map<string, PostTags>(Object.entries(data.tags));
    const reelPosts = data.posts.filter((p) => p.productType === 'REELS' || (p.productType == null && p.mediaType === 'VIDEO'));
    const reels = scorePosts(reelPosts, tags).sort((a, b) => b.postedAt.localeCompare(a.postedAt));
    return {
      data,
      reels,
      byId: new Map(reels.map((r) => [r.mediaId, r])),
      username: (id: string) => names.get(id) ?? '?',
      act,
    };
  }, [data, act]);

  const proposed = data.plans.filter((p) => p.status === 'proposed').length;

  return (
    <div>
      <div className="sticky top-0 z-20 -mx-4 mb-5 px-4 pb-3 pt-3 sm:-mx-8 sm:px-8" style={{ background: `${DASH.page}f2`, backdropFilter: 'blur(8px)', borderBottom: `1px solid ${DASH.line}` }}>
        {header}
        <nav className="mt-3 flex gap-1.5 overflow-x-auto" aria-label="Dashboard sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => go(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className="relative shrink-0 rounded-xl px-4 py-2 text-sm font-bold transition-colors"
              style={{ background: tab === t.id ? DASH.ink : 'transparent', color: tab === t.id ? DASH.page : DASH.muted }}
            >
              {t.label}
              {t.id === 'plan' && proposed > 0 && (
                <span className="ml-1.5 rounded-full px-1.5 py-px text-[11px]" style={{ background: DASH.green, color: DASH.page }}>{proposed}</span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'leaderboard' && <Leaderboard m={model} />}
      {tab === 'overview' && <Overview m={model} accountsPanel={accountsPanel} goto={go} />}
      {tab === 'reels' && <Reels m={model} />}
      {tab === 'winners' && <Winners m={model} />}
      {tab === 'plan' && <Plan m={model} />}
    </div>
  );
}
