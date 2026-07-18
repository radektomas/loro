'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { getUser, onAuthChange } from '@/lib/auth';
import type { UgcVideoStatus } from '@/lib/creators';
import { ChevronLeftIcon } from '@/components/icons/Icons';

/**
 * Shared shell pieces for the UGC screens (/creator/*, /admin/*), styled to
 * match the /progress header + card language.
 */

export function PageHeader({
  title,
  backHref = '/',
  right,
}: {
  title: string;
  backHref?: string;
  right?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-10 bg-background/85 pt-safe backdrop-blur-md">
      <div className="flex items-center gap-2 px-4 py-4">
        <Link
          href={backHref}
          aria-label="Back"
          className="rounded-full bg-surface p-2 text-muted transition-colors hover:text-text"
        >
          <ChevronLeftIcon width={20} height={20} />
        </Link>
        <h1 className="text-xl font-bold tracking-tight text-text">{title}</h1>
        {right && <div className="ml-auto">{right}</div>}
      </div>
    </header>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-1 pb-2 text-xs font-semibold uppercase tracking-widest text-muted">
      {children}
    </h2>
  );
}

/** Video pipeline status → label + tone. Amber = waiting on a human. */
const VIDEO_STATUS_STYLE: Record<UgcVideoStatus, { label: string; cls: string }> =
  {
    uploaded: { label: 'Uploaded', cls: 'bg-white/10 text-muted' },
    processing: { label: 'Processing', cls: 'bg-level-soft text-level' },
    published: { label: 'Published', cls: 'bg-accent-soft text-accent' },
    pending_review: {
      label: 'Needs review',
      cls: 'bg-amber-400/15 text-amber-300',
    },
    rejected: { label: 'Rejected', cls: 'bg-[#f87171]/15 text-[#f87171]' },
  };

export function VideoStatusChip({ status }: { status: UgcVideoStatus }) {
  const s = VIDEO_STATUS_STYLE[status];
  return (
    <span
      className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

/**
 * The signed-in Supabase user, resolved once and kept live across
 * sign-in/out. `ready` gates rendering so auth-dependent screens never flash
 * the wrong state.
 */
export function useSupabaseUser(): { user: User | null; ready: boolean } {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // A network hiccup here (AuthRetryableFetchError) must not wedge the
    // screen on its loading state — treat it as signed-out and move on;
    // onAuthChange corrects us the moment the session resolves.
    getUser()
      .catch(() => null)
      .then((u) => {
        setUser(u);
        setReady(true);
      });
    return onAuthChange((session) => setUser(session?.user ?? null));
  }, []);
  return { user, ready };
}

/** Centered quiet message for gate states (not signed in, not allowed…). */
export function GateMessage({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-8 pt-24 text-center">
      <h2 className="text-lg font-semibold text-text">{title}</h2>
      <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted">{body}</p>
      {action && <div className="mt-8">{action}</div>}
    </div>
  );
}
