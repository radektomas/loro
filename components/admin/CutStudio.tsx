'use client';

/**
 * getloro.app/cut — where Radek reviews the reels Claude cut.
 *
 * Left: the reel inside an Instagram Reels screen, with a timeline showing
 * which text is on screen when and where his notes sit. Right: a note box that
 * pins whatever he types to the second the video is paused on, the notes so
 * far (with Claude's answer once a recut addresses one), and the reel's status
 * — approve, drop, posted with its link and views.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DASH } from '@/components/admin/RadekDashboard';
import { ReelFrame } from '@/components/admin/ReelFrame';
import { ACCOUNTS, fmtTime, hookKey, workerView, type CutWorker, type CutReel, type CutStatus, type HookStat } from '@/lib/cutReels';

export type CutData = { reels: CutReel[]; hooks: HookStat[]; worker: CutWorker | null };
type Api = <T>(path: string, init?: RequestInit) => Promise<{ ok: true; data: T } | { ok: false; error: string }>;

const STATUS_LABEL: Record<CutStatus, string> = { review: 'To review', approved: 'Approved', posted: 'Posted', dropped: 'Dropped' };
const STATUS_COLOR: Record<CutStatus, string> = { review: DASH.orange, approved: DASH.green, posted: DASH.blue, dropped: DASH.faint };
const FRAME = 1 / 30;

const btn = (active = false) => ({
  background: active ? DASH.greenSoft : DASH.card,
  border: `1px solid ${active ? DASH.green : DASH.line}`,
  color: active ? DASH.green : DASH.ink,
});

export function CutStudio({ data, api, reload }: { data: CutData; api: Api; reload: () => Promise<void> }) {
  const [tab, setTab] = useState<'reels' | 'hooks'>('reels');
  const [account, setAccount] = useState<string>('all');
  const [status, setStatus] = useState<CutStatus | 'all'>('review');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const visible = useMemo(
    () =>
      data.reels
        .filter((r) => account === 'all' || r.account === account)
        .filter((r) => (status === 'all' ? r.status !== 'dropped' : r.status === status))
        .sort((a, b) => b.batch.localeCompare(a.batch) || a.account.localeCompare(b.account) || a.slot - b.slot),
    [data.reels, account, status]
  );
  const selected = data.reels.find((r) => r.id === selectedId) ?? visible[0] ?? null;
  const live = workerView(data.worker);
  const waiting = data.reels.some((r) => r.notes.some((n) => n.doneVersion == null && n.reply == null));

  // while Claude has work (open notes or a recut running), refresh every 10 s so
  // the new version and the answers appear without touching anything
  useEffect(() => {
    if (!waiting && live !== 'working') return;
    const id = setInterval(() => void reload(), 10_000);
    return () => clearInterval(id);
  }, [waiting, live, reload]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, review: 0, approved: 0, posted: 0, dropped: 0 };
    for (const r of data.reels) {
      if (account !== 'all' && r.account !== account) continue;
      c[r.status]++;
      if (r.status !== 'dropped') c.all++;
    }
    return c;
  }, [data.reels, account]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {(['reels', 'hooks'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className="rounded-lg px-4 py-2 text-sm font-semibold" style={btn(tab === t)}>
            {t === 'reels' ? 'Reels' : 'Hooks'}
          </button>
        ))}
        <span className="mx-1 h-6 w-px" style={{ background: DASH.line }} />
        {['all', ...ACCOUNTS].map((a) => (
          <button key={a} onClick={() => setAccount(a)} className="rounded-full px-3 py-1.5 text-xs font-semibold" style={btn(account === a)}>
            {a === 'all' ? 'All accounts' : `@${a}`}
          </button>
        ))}
      </div>

      <WorkerBanner live={live} waiting={waiting} />

      {tab === 'hooks' ? (
        <HooksTable hooks={data.hooks} reels={data.reels.filter((r) => account === 'all' || r.account === account)} />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {(['review', 'approved', 'posted', 'all', 'dropped'] as const).map((s) => (
              <button key={s} onClick={() => setStatus(s)} className="rounded-full px-3 py-1.5 text-xs font-semibold" style={btn(status === s)}>
                {s === 'all' ? 'All' : STATUS_LABEL[s]} · {counts[s]}
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <p className="rounded-2xl p-8 text-center text-sm" style={{ background: DASH.card, border: `1px solid ${DASH.line}`, color: DASH.muted }}>
              {data.reels.length === 0
                ? 'No reels yet. Drop clips into the green REELS folders on the Desktop (me + demo), then tell Claude “cut the reels”.'
                : 'Nothing here.'}
            </p>
          ) : (
            <>
              <Strip reels={visible} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
              {selected && (
                <ReelReview key={selected.id + ':' + selected.version} reel={selected} api={api} reload={reload} working={live === 'working' ? data.worker?.noteIds ?? [] : []} />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function Strip({ reels, selectedId, onSelect }: { reels: CutReel[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
      {reels.map((r) => {
        const open = r.notes.filter((n) => n.doneVersion == null).length;
        const on = r.id === selectedId;
        return (
          <button
            key={r.id}
            onClick={() => onSelect(r.id)}
            className="relative shrink-0 overflow-hidden rounded-xl text-left"
            style={{ width: 92, border: `2px solid ${on ? DASH.green : 'transparent'}`, background: DASH.card }}
            title={r.hook}
          >
            <div className="relative bg-black" style={{ aspectRatio: '9 / 16' }}>
              {r.posterUrl && <img src={r.posterUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />}
              <span className="absolute left-1 top-1 rounded px-1 text-[10px] font-bold" style={{ background: 'rgba(0,0,0,.6)', color: STATUS_COLOR[r.status] }}>
                {STATUS_LABEL[r.status]}
              </span>
              {open > 0 && (
                <span className="absolute right-1 top-1 rounded-full px-1.5 text-[10px] font-bold" style={{ background: DASH.orange, color: DASH.page }}>
                  {open}
                </span>
              )}
            </div>
            <div className="px-1.5 py-1 text-[10px] leading-tight" style={{ color: DASH.muted }}>
              <div className="truncate">@{r.account}</div>
              <div>
                {r.batch.slice(5)} #{r.slot} · v{r.version}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function WorkerBanner({ live, waiting }: { live: 'working' | 'watching' | 'offline'; waiting: boolean }) {
  const [text, color] =
    live === 'working'
      ? ['Claude is recutting from your notes… the new version shows up here by itself.', DASH.orange]
      : live === 'watching'
        ? [waiting ? 'A Claude chat is watching: it starts 20 s after your last note.' : 'A Claude chat is watching: write a note and it starts 20 s after your last one.', DASH.green]
        : ['No Claude chat is open on the Mac: notes wait until you open one in the loro project.', DASH.faint];
  return (
    <p className="flex items-center gap-2 text-xs" style={{ color: DASH.muted }}>
      <span className={`inline-block h-2 w-2 rounded-full${live === 'working' ? ' animate-pulse' : ''}`} style={{ background: color }} />
      {text}
    </p>
  );
}

function ReelReview({ reel, api, reload, working }: { reel: CutReel; api: Api; reload: () => Promise<void>; working: string[] }) {
  const video = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [overlay, setOverlay] = useState(true);
  const [draft, setDraft] = useState('');
  const [pinnedAt, setPinnedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [link, setLink] = useState(reel.permalink ?? '');
  const [views, setViews] = useState(reel.viewsSource === 'manual' && reel.views != null ? String(reel.views) : '');
  const dur = reel.durationS || 1;

  // smooth playhead
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (video.current) setT(video.current.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const seek = useCallback((s: number, pause = true) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(dur - 0.001, s));
    if (pause) v.pause();
  }, [dur]);

  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }, []);

  // keyboard: space play/pause, arrows 0.5 s, , . one frame — not while typing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const v = video.current;
      if (!v) return;
      if (e.key === ' ') { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowLeft') seek(v.currentTime - 0.5);
      else if (e.key === 'ArrowRight') seek(v.currentTime + 0.5);
      else if (e.key === ',') seek(v.currentTime - FRAME);
      else if (e.key === '.') seek(v.currentTime + FRAME);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [seek, toggle]);

  const segments = useMemo(() => {
    const first = reel.lines[0]?.from ?? dur;
    return [{ text: reel.hook, from: 0, to: first, hook: true }, ...reel.lines.map((l) => ({ ...l, hook: false }))];
  }, [reel, dur]);
  const current = segments.find((s) => t >= s.from && t < s.to);

  const startNote = () => {
    if (pinnedAt != null) return;
    video.current?.pause();
    setPinnedAt(Math.round((video.current?.currentTime ?? t) * 10) / 10);
  };

  const saveNote = async () => {
    const body = draft.trim();
    if (!body || pinnedAt == null) return;
    setBusy(true);
    setErr(null);
    const r = await api('/api/cut/notes', { method: 'POST', body: JSON.stringify({ reelId: reel.id, atS: pinnedAt, body }) });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setDraft('');
    setPinnedAt(null);
    await reload();
  };

  const deleteNote = async (id: string) => {
    const r = await api(`/api/cut/notes?id=${id}`, { method: 'DELETE' });
    if (!r.ok) return setErr(r.error);
    await reload();
  };

  const patch = async (p: Record<string, unknown>) => {
    setBusy(true);
    setErr(null);
    const r = await api('/api/cut', { method: 'PATCH', body: JSON.stringify({ id: reel.id, ...p }) });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    await reload();
  };

  const openNotes = reel.notes.filter((n) => n.doneVersion == null);
  const doneNotes = reel.notes.filter((n) => n.doneVersion != null);
  const fileName = `${reel.account}-${reel.batch}-${reel.slot}-v${reel.version}.mp4`;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
      {/* LEFT: the preview */}
      <div className="mx-auto w-full max-w-[380px]">
        <ReelFrame account={reel.account} overlay={overlay}>
          {reel.videoUrl ? (
            <video
              ref={video}
              src={reel.videoUrl}
              poster={reel.posterUrl ?? undefined}
              className="h-full w-full cursor-pointer object-cover"
              playsInline
              muted
              loop
              autoPlay
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onClick={toggle}
            />
          ) : (
            <p className="p-6 text-sm text-white">Video link expired, refresh.</p>
          )}
        </ReelFrame>

        {/* timeline */}
        <div className="mt-6">
          <div className="mb-1.5 flex items-center justify-between text-xs" style={{ color: DASH.muted }}>
            <button onClick={toggle} className="rounded-md px-2.5 py-1 font-semibold" style={btn()}>
              {playing ? '❚❚ Pause' : '▶ Play'}
            </button>
            <span className="font-mono">
              {fmtTime(t)} / {fmtTime(dur)}
            </span>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} />
              Instagram UI
            </label>
          </div>
          <div
            className="relative h-14 cursor-pointer select-none overflow-hidden rounded-lg"
            style={{ background: DASH.inset, border: `1px solid ${DASH.line}` }}
            onPointerDown={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              const move = (x: number) => seek(((x - box.left) / box.width) * dur);
              move(e.clientX);
              const mm = (ev: PointerEvent) => move(ev.clientX);
              const up = () => { window.removeEventListener('pointermove', mm); window.removeEventListener('pointerup', up); };
              window.addEventListener('pointermove', mm);
              window.addEventListener('pointerup', up);
            }}
          >
            {segments.map((s, i) => (
              <div
                key={i}
                className="absolute top-0 flex h-8 items-center overflow-hidden px-1.5 text-[10px] leading-tight"
                style={{
                  left: `${(s.from / dur) * 100}%`,
                  width: `${((s.to - s.from) / dur) * 100}%`,
                  background: s.hook ? 'rgba(251,146,60,.16)' : i % 2 ? DASH.greenSoft : 'rgba(52,211,153,.07)',
                  borderRight: `1px solid ${DASH.line}`,
                  color: DASH.muted,
                }}
                title={s.text}
              >
                <span className="line-clamp-2">{s.hook ? 'HOOK · ' : ''}{s.text}</span>
              </div>
            ))}
            {reel.notes.map((n) => (
              <button
                key={n.id}
                className="absolute bottom-1 h-3.5 w-3.5 -translate-x-1/2 rounded-full"
                style={{ left: `${(n.atS / dur) * 100}%`, background: n.doneVersion == null ? DASH.orange : DASH.faint, border: `2px solid ${DASH.page}` }}
                title={`${fmtTime(n.atS)} ${n.body}`}
                onPointerDown={(e) => { e.stopPropagation(); seek(n.atS); }}
              />
            ))}
            <div className="pointer-events-none absolute inset-y-0 w-0.5" style={{ left: `${(t / dur) * 100}%`, background: DASH.ink }} />
          </div>
          <p className="mt-1.5 text-[11px]" style={{ color: DASH.faint }}>
            Space play/pause · ← → half a second · , . one frame
          </p>
        </div>
      </div>

      {/* RIGHT: notes and status */}
      <div className="grid content-start gap-4">
        <section className="rounded-2xl p-4" style={{ background: DASH.card, border: `1px solid ${DASH.line}` }}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-bold">
              @{reel.account} · {reel.batch} #{reel.slot}
            </h2>
            <span className="text-xs font-semibold" style={{ color: STATUS_COLOR[reel.status] }}>
              {STATUS_LABEL[reel.status]} · v{reel.version}
            </span>
          </div>
          <p className="mt-1 text-xs" style={{ color: DASH.faint }}>
            {reel.meFile} + {reel.demoFile}
          </p>

          <div className="mt-4">
            <label className="text-xs font-semibold" style={{ color: DASH.muted }}>
              {pinnedAt != null ? (
                <>
                  Note at <span style={{ color: DASH.orange }}>{fmtTime(pinnedAt)}</span>
                  {current && <> · on “{current.text.slice(0, 40)}{current.text.length > 40 ? '…' : ''}”</>}
                  <button className="ml-2 underline" onClick={() => setPinnedAt(Math.round(t * 10) / 10)}>
                    move to {fmtTime(t)}
                  </button>
                </>
              ) : (
                <>Note at {fmtTime(t)} (start typing, the video pauses)</>
              )}
            </label>
            <textarea
              value={draft}
              onFocus={startNote}
              onChange={(e) => { startNote(); setDraft(e.target.value); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void saveNote(); }
                if (e.key === 'Escape') { setDraft(''); setPinnedAt(null); (e.target as HTMLTextAreaElement).blur(); }
              }}
              rows={2}
              placeholder="e.g. hook comes too late / cut the demo earlier / “literally” not “litteraly”"
              className="mt-1.5 w-full resize-y rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: DASH.page, border: `1px solid ${pinnedAt != null ? DASH.orange : DASH.line}`, color: DASH.ink }}
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={() => void saveNote()}
                disabled={busy || !draft.trim()}
                className="rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-40"
                style={{ background: DASH.green, color: DASH.page }}
              >
                Add note
              </button>
              <span className="text-[11px]" style={{ color: DASH.faint }}>Enter saves · Esc cancels</span>
            </div>
            {err && <p className="mt-2 text-sm" style={{ color: DASH.red }}>{err}</p>}
          </div>

          {openNotes.length > 0 && (
            <ul className="mt-4 grid gap-2">
              {openNotes.map((n) => (
                <li key={n.id} className="flex items-start gap-3 rounded-lg p-2.5" style={{ background: DASH.inset }}>
                  <button className="font-mono text-xs font-bold" style={{ color: DASH.orange }} onClick={() => seek(n.atS)}>
                    {fmtTime(n.atS)}
                  </button>
                  <span className="flex-1 text-sm">
                    {n.body}
                    {n.version < reel.version && <span className="ml-1 text-xs" style={{ color: DASH.faint }}>(on v{n.version})</span>}
                    {working.includes(n.id) && <span className="ml-2 text-xs" style={{ color: DASH.orange }}>⏳ Claude is on it</span>}
                    {n.reply && (
                      <span className="mt-1 block text-xs" style={{ color: DASH.blue }}>
                        Claude asks: {n.reply.replace(/^❓\s*/, '')} <span style={{ color: DASH.faint }}>(answer with a new note)</span>
                      </span>
                    )}
                  </span>
                  <button className="text-xs" style={{ color: DASH.faint }} onClick={() => void deleteNote(n.id)} title="Delete note">
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          {doneNotes.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-xs font-semibold" style={{ color: DASH.muted }}>
                {doneNotes.length} answered note{doneNotes.length > 1 ? 's' : ''}
              </summary>
              <ul className="mt-2 grid gap-2">
                {doneNotes.map((n) => (
                  <li key={n.id} className="rounded-lg p-2.5 text-sm" style={{ background: DASH.inset }}>
                    <span className="font-mono text-xs" style={{ color: DASH.faint }}>{fmtTime(n.atS)} · v{n.version}</span> {n.body}
                    <div className="mt-1 text-xs" style={{ color: DASH.green }}>
                      v{n.doneVersion}: {n.reply}
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section className="rounded-2xl p-4" style={{ background: DASH.card, border: `1px solid ${DASH.line}` }}>
          <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: DASH.muted }}>Text on screen</h3>
          <ul className="mt-2 grid gap-1">
            {segments.map((s, i) => (
              <li key={i}>
                <button
                  onClick={() => seek(s.from + 0.05)}
                  className="w-full rounded-md px-2 py-1 text-left text-sm"
                  style={{ background: current === s ? DASH.inset : 'transparent' }}
                >
                  <span className="mr-2 font-mono text-xs" style={{ color: s.hook ? DASH.orange : DASH.faint }}>
                    {fmtTime(s.from)}
                  </span>
                  {s.text}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl p-4" style={{ background: DASH.card, border: `1px solid ${DASH.line}` }}>
          <div className="flex flex-wrap gap-2">
            {reel.videoUrl && (
              <a href={`${reel.videoUrl}&download=${encodeURIComponent(fileName)}`} className="rounded-lg px-4 py-2 text-sm font-semibold" style={btn()}>
                ↓ Download
              </a>
            )}
            {reel.status !== 'approved' && reel.status !== 'posted' && (
              <button disabled={busy} onClick={() => void patch({ status: 'approved' })} className="rounded-lg px-4 py-2 text-sm font-bold" style={{ background: DASH.green, color: DASH.page }}>
                Approve
              </button>
            )}
            {reel.status !== 'posted' && (
              <button disabled={busy} onClick={() => void patch({ status: 'posted' })} className="rounded-lg px-4 py-2 text-sm font-semibold" style={btn()}>
                Mark posted
              </button>
            )}
            {reel.status !== 'dropped' ? (
              <button disabled={busy} onClick={() => void patch({ status: 'dropped' })} className="rounded-lg px-4 py-2 text-sm font-semibold" style={{ color: DASH.muted }}>
                Drop
              </button>
            ) : (
              <button disabled={busy} onClick={() => void patch({ status: 'review' })} className="rounded-lg px-4 py-2 text-sm font-semibold" style={btn()}>
                Restore
              </button>
            )}
          </div>

          {reel.status === 'posted' && (
            <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_140px_auto]">
              <input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="Reel link, e.g. instagram.com/reel/…"
                className="rounded-lg px-3 py-2 text-sm outline-none"
                style={{ background: DASH.page, border: `1px solid ${DASH.line}`, color: DASH.ink }}
              />
              <input
                value={reel.viewsSource === 'instagram' ? String(reel.views) : views}
                onChange={(e) => setViews(e.target.value.replace(/[^\d]/g, ''))}
                disabled={reel.viewsSource === 'instagram'}
                inputMode="numeric"
                placeholder="Views"
                className="rounded-lg px-3 py-2 text-sm outline-none disabled:opacity-60"
                style={{ background: DASH.page, border: `1px solid ${DASH.line}`, color: DASH.ink }}
              />
              <button
                disabled={busy}
                onClick={() => void patch({ permalink: link || null, ...(reel.viewsSource === 'instagram' ? {} : { manualViews: views ? Number(views) : null }) })}
                className="rounded-lg px-4 py-2 text-sm font-semibold"
                style={btn()}
              >
                Save
              </button>
              <p className="text-xs sm:col-span-3" style={{ color: DASH.faint }}>
                {reel.viewsSource === 'instagram'
                  ? 'Views come from Instagram (synced on /marketing).'
                  : 'Type the views until this account is connected on /marketing, then they fill in by themselves from the link.'}
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function HooksTable({ hooks, reels }: { hooks: HookStat[]; reels: CutReel[] }) {
  const keys = new Set(reels.map((r) => hookKey(r.hook)));
  const rows = hooks.filter((h) => keys.has(hookKey(h.hook)));
  const measured = rows.filter((h) => h.measured > 0).length;
  return (
    <section className="rounded-2xl p-4" style={{ background: DASH.card, border: `1px solid ${DASH.line}` }}>
      <p className="text-sm" style={{ color: DASH.muted }}>
        Each posted reel is compared with its own account’s typical reel (1.0× = ordinary), so a small account’s hit counts as much as a big one’s.
        {measured === 0 && ' No posted reel has views yet: mark reels as posted and add their link and views.'}
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs" style={{ color: DASH.faint }}>
              <th className="py-2 pr-3 font-semibold">Hook</th>
              <th className="py-2 pr-3 text-right font-semibold">vs usual</th>
              <th className="py-2 pr-3 text-right font-semibold">Avg views</th>
              <th className="py-2 pr-3 text-right font-semibold">Best</th>
              <th className="py-2 text-right font-semibold">Posted / cut</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <tr key={h.hook} style={{ borderTop: `1px solid ${DASH.line}` }}>
                <td className="py-2.5 pr-3">{h.hook}</td>
                <td
                  className="py-2.5 pr-3 text-right font-mono font-bold"
                  style={{ color: h.avgMultiple == null ? DASH.faint : h.avgMultiple >= 1.5 ? DASH.green : h.avgMultiple < 0.8 ? DASH.red : DASH.ink }}
                >
                  {h.avgMultiple == null ? '–' : `${h.avgMultiple.toFixed(1)}×`}
                </td>
                <td className="py-2.5 pr-3 text-right font-mono">{h.avgViews == null ? '–' : Math.round(h.avgViews).toLocaleString()}</td>
                <td className="py-2.5 pr-3 text-right text-xs" style={{ color: DASH.muted }}>
                  {h.best ? `${h.best.views.toLocaleString()} @${h.best.account}` : '–'}
                </td>
                <td className="py-2.5 text-right font-mono" style={{ color: DASH.muted }}>
                  {h.measured} / {h.used}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
