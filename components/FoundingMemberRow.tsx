'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { storage } from '@/lib/storage';
import { CloseIcon } from '@/components/icons/Icons';

/**
 * The app's one quiet pointer to /join — a dismissible row on /profile.
 * Styled to sit among the profile's surface rows, not to shout: the landing
 * page does the selling. Dismissal persists (loro.joinPromoDismissed) and is
 * final on this device.
 */
export function FoundingMemberRow() {
  // true until hydration so SSR/first paint never flashes the row.
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(storage.isJoinPromoDismissed());
  }, []);

  if (dismissed) return null;

  return (
    <div className="relative">
      <Link
        href="/"
        className="block rounded-3xl bg-surface p-5 pr-14 transition-colors hover:bg-surface-raised"
      >
        <span className="block text-sm font-semibold text-text">
          <span className="text-muted">Open beta</span>
          <span className="text-muted"> · </span>
          Become a founding member →
        </span>
      </Link>
      <button
        type="button"
        onClick={() => {
          storage.dismissJoinPromo();
          setDismissed(true);
        }}
        aria-label="Dismiss"
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-2 text-muted transition-colors hover:text-text"
      >
        <CloseIcon width={16} height={16} />
      </button>
    </div>
  );
}
