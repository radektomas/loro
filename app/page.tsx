import { Suspense } from 'react';
import { Feed } from '@/components/Feed';
import videosData from '@/data/videos.json';
import type { Video } from '@/types';

const videos = videosData as Video[];

export default function Home() {
  return (
    // Suspense boundary required because Feed reads useSearchParams (deep links).
    <Suspense fallback={<div className="h-[100dvh] bg-background" />}>
      <Feed videos={videos} />
    </Suspense>
  );
}
