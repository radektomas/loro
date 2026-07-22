'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Feed } from '@/components/Feed';
import { fetchCreatorFeed, fetchPublishedVideos } from '@/lib/publishedVideos';
import { localVideos } from '@/lib/localVideos';
import type { Video } from '@/types';

/**
 * The feed, in one of two modes:
 *
 *  - DEFAULT: static seed videos render immediately, published UGC merges in
 *    once fetched. The static set stays first-class — if Supabase is
 *    unreachable the feed is exactly what it was before UGC.
 *  - SCOPED (?creator=handle, from a profile grid tile): only that creator's
 *    published videos, in grid order. It has its OWN fetch rather than
 *    filtering the merged list, because the merged list resolves after first
 *    paint — a filter would show an empty feed and then pop.
 */

function FeedRoute() {
  const creatorHandle = useSearchParams().get('creator');
  const scoped = creatorHandle !== null;

  // Scoped mode starts empty: seeding with localVideos would flash the whole
  // catalogue before narrowing to one creator.
  const [videos, setVideos] = useState<Video[]>(scoped ? [] : localVideos);

  useEffect(() => {
    let cancelled = false;
    if (creatorHandle !== null) {
      setVideos([]);
      void fetchCreatorFeed(creatorHandle).then((list) => {
        if (!cancelled) setVideos(list);
      });
      return () => {
        cancelled = true;
      };
    }
    setVideos(localVideos);
    void fetchPublishedVideos().then((published) => {
      if (cancelled || published.length === 0) return;
      setVideos((prev) => {
        const known = new Set(prev.map((v) => v.id));
        const fresh = published.filter((v) => !known.has(v.id));
        return fresh.length ? [...prev, ...fresh] : prev;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [creatorHandle]);

  // Remount on mode change: Feed fixes its order once per mount, so reusing
  // the instance would leave the previous mode's ordering in place.
  return <Feed key={creatorHandle ?? 'all'} videos={videos} scoped={scoped} />;
}

export default function Home() {
  return (
    // Suspense boundary required because this route reads useSearchParams
    // (the scoped-feed handle, and Feed's own deep links).
    <Suspense fallback={<div className="h-[100dvh] bg-background" />}>
      <FeedRoute />
    </Suspense>
  );
}
