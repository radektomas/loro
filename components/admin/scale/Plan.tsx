'use client';

import { useMemo, useState } from 'react';
import { DASH } from '../RadekDashboard';
import type { ScalePlan, ScalePlanItem } from '@/lib/marketingStats';
import { trackRecord } from '@/lib/scaleStats';
import type { Model } from './ScaleDashboard';
import { ChannelChip, Empty, MultipleBadge, day } from './ui';

const STATUS_STYLE: Record<ScalePlanItem['status'], { label: string; color: string; bg: string }> = {
  proposed: { label: 'Waiting for you', color: DASH.orange, bg: 'rgba(251,146,60,0.14)' },
  approved: { label: 'Approved', color: DASH.green, bg: DASH.greenSoft },
  rejected: { label: 'Rejected', color: DASH.red, bg: DASH.redSoft },
  cut: { label: 'Cut', color: DASH.blue, bg: DASH.blueSoft },
};

const PRETTY_VARIANT: Record<string, string> = { reels: '…scrolling reels', peppa: '…Peppa Pig', answer: '“ummm by…”' };

export function Plan({ m }: { m: Model }) {
  const plans = m.data.plans;
  /** a plan item's result: its cut reel → Instagram post → multiple */
  const actual = useMemo(() => {
    const mediaOf = new Map(Object.entries(m.data.cutReels).map(([mid, r]) => [r.id, mid]));
    return (item: ScalePlanItem) => {
      const mid = item.cutReelId ? mediaOf.get(item.cutReelId) : undefined;
      const p = mid ? m.byId.get(mid) : undefined;
      return p ? { multiple: p.settled ? p.multiple : null, settled: p.settled, posted: true } : { multiple: null, settled: false, posted: false };
    };
  }, [m]);

  const record = trackRecord(
    plans.flatMap((p) => p.items.filter((i) => i.status === 'cut').map((i) => ({ role: i.role, expected: i.expectedMultiple, actual: actual(i).multiple })))
  );

  if (plans.length === 0) {
    return (
      <Empty>
        No plan yet. Drop clips into the green REELS folders on the Desktop and tell Claude <b>“plan the next batch”</b>. The scaler checks what&apos;s
        winning, proposes a hook and lines for every clip pair, and it shows up here for you to approve.
      </Empty>
    );
  }

  const [current, ...past] = plans;
  return (
    <div className="grid gap-5">
      <PlanCard plan={current} m={m} actual={actual} open />
      <TrackRecord record={record} />
      {past.length > 0 && (
        <div className="grid gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: DASH.faint }}>Earlier plans</h2>
          {past.map((p) => (
            <PlanCard key={p.id} plan={p} m={m} actual={actual} />
          ))}
        </div>
      )}
    </div>
  );
}

function PlanCard({ plan, m, actual, open = false }: { plan: ScalePlan; m: Model; actual: (i: ScalePlanItem) => { multiple: number | null; settled: boolean; posted: boolean }; open?: boolean }) {
  const [expanded, setExpanded] = useState(open);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const waiting = plan.items.filter((i) => i.status === 'proposed').length;
  const decide = async (body: Record<string, unknown>) => {
    setBusy(true);
    setErr(await m.act('/api/marketing/plan', 'PATCH', body));
    setBusy(false);
  };
  const tests = plan.items.filter((i) => i.role === 'test').length;

  return (
    <section className="rounded-2xl p-5" style={{ background: DASH.card, border: `1px solid ${waiting ? DASH.green : DASH.line}` }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button onClick={() => setExpanded(!expanded)} className="text-left">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: DASH.faint }}>
            Batch {plan.batch} · proposed {day(plan.createdAt)} · {plan.items.length} reels, {tests} test{tests === 1 ? '' : 's'}
          </p>
          <h2 className="mt-1 text-lg font-bold leading-snug">{plan.summary ?? 'The next batch'}</h2>
        </button>
        {waiting > 0 ? (
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => void decide({ planId: plan.id, status: 'approved' })} className="rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-50" style={{ background: DASH.green, color: DASH.page }}>
              Approve all {waiting}
            </button>
            <button disabled={busy} onClick={() => void decide({ planId: plan.id, status: 'rejected' })} className="rounded-xl px-3 py-2 text-sm font-semibold disabled:opacity-50" style={{ color: DASH.muted, border: `1px solid ${DASH.line}` }}>
              Reject
            </button>
          </div>
        ) : (
          <span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: STATUS_STYLE[plan.status].bg, color: STATUS_STYLE[plan.status].color }}>{STATUS_STYLE[plan.status].label}</span>
        )}
      </div>
      {err && <p className="mt-2 text-sm" style={{ color: DASH.red }}>{err}</p>}

      {expanded && (
        <ul className="mt-4 grid gap-2.5 md:grid-cols-2">
          {plan.items.map((i) => {
            const a = actual(i);
            const st = STATUS_STYLE[i.status];
            return (
              <li key={i.id} className="flex flex-col gap-2.5 rounded-xl p-3.5" style={{ background: DASH.inset, border: `1px solid ${DASH.line}` }}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-black" style={{ color: DASH.faint }}>#{i.slot}</span>
                  <ChannelChip account={i.account} />
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide"
                    style={i.role === 'exploit' ? { background: DASH.greenSoft, color: DASH.green } : { background: 'rgba(167,139,250,0.15)', color: DASH.violet }}
                    title={i.role === 'exploit' ? 'Repeats a winning pattern with a fresh hook' : 'Tries something new, so the next winner can be found'}
                  >
                    {i.role === 'exploit' ? 'Repeat a winner' : 'Test'}
                  </span>
                  <span className="ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: st.bg, color: st.color }}>{st.label}</span>
                </div>
                <p className="text-[15px] font-bold leading-snug">{i.hook}</p>
                <p className="text-[13px] leading-relaxed" style={{ color: DASH.muted }}>{i.reason}</p>
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  {[i.hookKind, i.line1Variant ? `line 1: ${PRETTY_VARIANT[i.line1Variant] ?? i.line1Variant}` : null, i.voice ? `voice: ${i.voice}` : null, i.demoKind ? `${i.demoKind} demo` : null]
                    .filter(Boolean)
                    .map((x) => (
                      <span key={x!} className="rounded-md px-1.5 py-0.5" style={{ background: DASH.track, color: DASH.ink }}>{x}</span>
                    ))}
                </div>
                <p className="truncate text-[11px]" style={{ color: DASH.faint }} title={`${i.meFile} + ${i.demoFile}`}>
                  clips: {i.meFile.split('/').pop()} + {i.demoFile.split('/').pop()}
                </p>
                <div className="flex items-center justify-between gap-2 border-t pt-2.5 text-xs" style={{ borderColor: DASH.line }}>
                  <span style={{ color: DASH.muted }}>
                    expects <b style={{ color: DASH.ink }}>{i.expectedMultiple != null ? `${i.expectedMultiple.toFixed(1)}×` : '–'}</b>
                    {a.posted && (
                      <>
                        {' '}· got <MultipleBadge m={a.multiple} climbing={!a.settled} />
                      </>
                    )}
                  </span>
                  {i.status === 'proposed' || i.status === 'approved' || i.status === 'rejected' ? (
                    <span className="flex gap-1.5">
                      <button disabled={busy || i.status === 'approved'} onClick={() => void decide({ itemId: i.id, status: 'approved' })} className="rounded-lg px-2.5 py-1 font-bold disabled:opacity-40" style={{ background: DASH.greenSoft, color: DASH.green }}>
                        ✓ Approve
                      </button>
                      <button disabled={busy || i.status === 'rejected'} onClick={() => void decide({ itemId: i.id, status: 'rejected' })} className="rounded-lg px-2.5 py-1 font-semibold disabled:opacity-40" style={{ background: DASH.redSoft, color: DASH.red }}>
                        ✕
                      </button>
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function TrackRecord({ record }: { record: ReturnType<typeof trackRecord> }) {
  const cell = (title: string, v: string, sub: string) => (
    <div className="rounded-xl p-3.5" style={{ background: DASH.inset }}>
      <p className="text-xs font-semibold" style={{ color: DASH.muted }}>{title}</p>
      <p className="text-2xl font-black tabular-nums">{v}</p>
      <p className="text-[11px]" style={{ color: DASH.faint }}>{sub}</p>
    </div>
  );
  const n = record.exploit.n + record.test.n;
  return (
    <section className="rounded-2xl p-5" style={{ background: DASH.card, border: `1px solid ${DASH.line}` }}>
      <h2 className="text-[15px] font-semibold">The scaler&apos;s track record</h2>
      <p className="mt-0.5 text-xs leading-relaxed" style={{ color: DASH.muted }}>
        How its reels did once posted and settled. If “repeat a winner” keeps beating 1× and it often hits what it expected, it has earned more freedom.
      </p>
      {n === 0 ? (
        <p className="mt-3 text-sm" style={{ color: DASH.faint }}>No planned reel has been posted and settled yet.</p>
      ) : (
        <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
          {cell('Repeat-a-winner reels', record.exploit.median != null ? `${record.exploit.median.toFixed(1)}×` : '–', `median of ${record.exploit.n}`)}
          {cell('Test reels', record.test.median != null ? `${record.test.median.toFixed(1)}×` : '–', `median of ${record.test.n}`)}
          {cell('Hit what it expected', record.hitRate != null ? `${Math.round(record.hitRate * 100)}%` : '–', 'of settled reels')}
        </div>
      )}
    </section>
  );
}
