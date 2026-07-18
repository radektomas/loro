'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  countVideosByCreator,
  isAdmin,
  listCreators,
  reviewCreator,
  type Creator,
} from '@/lib/creators';
import {
  GateMessage,
  PageHeader,
  SectionTitle,
  useSupabaseUser,
} from '@/components/creator/ugc';
import { CheckIcon, CloseIcon } from '@/components/icons/Icons';

function ApplicationCard({
  creator,
  onReview,
  busy,
}: {
  creator: Creator;
  onReview: (decision: 'approved' | 'rejected') => void;
  busy: boolean;
}) {
  return (
    <li className="rounded-3xl bg-surface p-5">
      <div className="flex items-baseline gap-2">
        <p className="text-base font-bold text-text">{creator.displayName}</p>
        <p className="text-sm text-muted">@{creator.handle}</p>
        <p className="ml-auto shrink-0 text-xs text-muted/60">
          {new Date(creator.appliedAt).toLocaleDateString()}
        </p>
      </div>
      <p className="mt-1 text-xs font-semibold text-accent">
        {creator.nativeLanguage}
      </p>
      <p className="mt-3 text-sm leading-relaxed text-muted">{creator.bio}</p>
      {creator.sampleLink && (
        <a
          href={creator.sampleLink}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block max-w-full truncate rounded-xl bg-white/5 px-3 py-2 text-xs text-level underline"
        >
          {creator.sampleLink}
        </a>
      )}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onReview('approved')}
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-accent py-3 text-sm font-semibold text-background transition-transform active:scale-[0.98] disabled:opacity-40"
        >
          <CheckIcon width={15} height={15} />
          Approve
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onReview('rejected')}
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-[#f87171]/15 py-3 text-sm font-semibold text-[#f87171] transition-transform active:scale-[0.98] disabled:opacity-40"
        >
          <CloseIcon width={15} height={15} />
          Reject
        </button>
      </div>
    </li>
  );
}

export default function AdminCreatorsPage() {
  const { user, ready } = useSupabaseUser();
  const [admin, setAdmin] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState<Creator[]>([]);
  const [approved, setApproved] = useState<Creator[]>([]);
  const [counts, setCounts] = useState<
    Map<string, { total: number; published: number }>
  >(new Map());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [p, a, c] = await Promise.all([
      listCreators('pending'),
      listCreators('approved'),
      countVideosByCreator(),
    ]);
    setPending(p);
    setApproved(a);
    setCounts(c);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      setLoaded(true);
      return;
    }
    void isAdmin().then(async (ok) => {
      setAdmin(ok);
      if (ok) await refresh();
      setLoaded(true);
    });
  }, [ready, user, refresh]);

  const review = async (userId: string, decision: 'approved' | 'rejected') => {
    setBusyId(userId);
    setError(null);
    const result = await reviewCreator(userId, decision);
    if (!result.ok) setError(result.error ?? 'Review failed.');
    await refresh();
    setBusyId(null);
  };

  return (
    <main className="min-h-[100dvh] bg-background pb-safe">
      <PageHeader title="Creator applications" />
      <div className="mx-auto max-w-md space-y-8 px-4 pb-10">
        {ready && loaded && (!user || !admin) && (
          <GateMessage
            title="Admins only"
            body="This screen reviews creator applications and is limited to Loro admins."
          />
        )}

        {ready && loaded && admin && (
          <>
            {error && (
              <p className="rounded-2xl bg-[#f87171]/10 px-4 py-3 text-sm text-[#f87171]">
                {error}
              </p>
            )}

            <section>
              <SectionTitle>Pending · {pending.length}</SectionTitle>
              {pending.length === 0 ? (
                <p className="rounded-3xl bg-surface px-5 py-6 text-sm text-muted">
                  No applications waiting. Nice.
                </p>
              ) : (
                <ul className="space-y-3">
                  {pending.map((c) => (
                    <ApplicationCard
                      key={c.userId}
                      creator={c}
                      busy={busyId === c.userId}
                      onReview={(d) => void review(c.userId, d)}
                    />
                  ))}
                </ul>
              )}
            </section>

            <section>
              <SectionTitle>Approved · {approved.length}</SectionTitle>
              {approved.length === 0 ? (
                <p className="rounded-3xl bg-surface px-5 py-6 text-sm text-muted">
                  No approved creators yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {approved.map((c) => {
                    const n = counts.get(c.userId) ?? {
                      total: 0,
                      published: 0,
                    };
                    return (
                      <li
                        key={c.userId}
                        className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-text">
                            {c.displayName}{' '}
                            <span className="font-normal text-muted">
                              @{c.handle}
                            </span>
                          </p>
                          <p className="mt-0.5 text-xs text-muted/70">
                            {c.nativeLanguage}
                          </p>
                        </div>
                        <p className="shrink-0 text-xs tabular-nums text-muted">
                          <span className="font-semibold text-text">
                            {n.total}
                          </span>{' '}
                          {n.total === 1 ? 'video' : 'videos'}
                          {n.total > 0 && (
                            <span className="text-muted/60">
                              {' '}
                              · {n.published} live
                            </span>
                          )}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
