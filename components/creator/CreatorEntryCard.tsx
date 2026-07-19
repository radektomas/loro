'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getMyCreator, type Creator } from '@/lib/creators';
import { useSupabaseUser } from '@/components/creator/ugc';
import { FilmIcon } from '@/components/icons/Icons';

/**
 * The creator entry point in the feed's top chrome — a pill next to
 * "My words" / "Progress", same visual language. Hidden for signed-out
 * users; for signed-in users it routes by state: approved creators land in
 * the studio, everyone else on the apply page (which doubles as the
 * application status screen).
 */
export function CreatorPill() {
  const { user, ready } = useSupabaseUser();
  const [creator, setCreator] = useState<Creator | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!ready || !user) return;
    void getMyCreator().then((c) => {
      setCreator(c);
      setLoaded(true);
    });
  }, [ready, user]);

  if (!ready || !user || !loaded) return null;

  return (
    <Link
      href={creator?.status === 'approved' ? '/creator' : '/creator/apply'}
      className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-black/40 px-3.5 py-2 text-sm font-medium text-text backdrop-blur-md transition-colors hover:bg-black/55"
    >
      <FilmIcon width={15} height={15} className="text-accent" />
      Create
    </Link>
  );
}
