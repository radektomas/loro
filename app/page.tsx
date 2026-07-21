'use client';

import { Suspense, useEffect, useState } from 'react';
import { Feed } from '@/components/Feed';
import { fetchPublishedVideos } from '@/lib/publishedVideos';
import { localVideos } from '@/lib/localVideos';
import type { Video } from '@/types';

export default function Home() {
  // The static seed videos render immediately; published UGC videos from
  // loro_videos merge in once fetched. The static set stays first-class —
  // if Supabase is unreachable the feed is exactly what it was before UGC.
  const [videos, setVideos] = useState<Video[]>(localVideos);

  useEffect(() => {
    void fetchPublishedVideos().then((published) => {
      if (published.length === 0) return;
      setVideos((prev) => {
        const known = new Set(prev.map((v) => v.id));
        const fresh = published.filter((v) => !known.has(v.id));
        return fresh.length ? [...prev, ...fresh] : prev;
      });
    });
  }, []);

  return (
    // Suspense boundary required because Feed reads useSearchParams (deep links).
    <Suspense fallback={<div className="h-[100dvh] bg-background" />}>
      <Feed videos={videos} />
    </Suspense>
  );
}
