'use client';

import Link from 'next/link';
import { useMyCreator } from '@/components/creator/ugc';
import { Avatar } from '@/components/creator/Avatar';
import { UserIcon } from '@/components/icons/Icons';

/**
 * The feed's top-right entry into /profile, in the same pill idiom as
 * "My words" and "Progress".
 *
 * Unlike the creator pill it replaced, this renders for EVERYONE — /profile
 * is a primary destination with something useful in every viewer state, so
 * there is no signed-out case to hide from. A creator with an avatar sees
 * their own face (via the shared Avatar component, which also owns the
 * initial-circle fallback); anyone else gets a neutral glyph.
 */
export function ProfilePill() {
  const { creator, ready } = useMyCreator();

  return (
    <Link
      href="/profile"
      aria-label="Profile"
      className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-black/40 py-1.5 pl-1.5 pr-3.5 text-sm font-medium text-text backdrop-blur-md transition-colors hover:bg-black/55"
    >
      {ready && creator ? (
        <Avatar url={creator.avatarUrl} name={creator.displayName} size={22} />
      ) : (
        <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-white/10">
          <UserIcon width={13} height={13} className="text-accent" />
        </span>
      )}
      Profile
    </Link>
  );
}
