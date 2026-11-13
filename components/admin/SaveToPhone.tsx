'use client';

import { useEffect, useRef, useState } from 'react';
import { DASH } from './RadekDashboard';

/**
 * "Save to phone" for an approved reel on /cut (Radek, 2026-11-13): the reel
 * goes to the iPhone's Photos through the share sheet ("Save Video"), and he
 * posts it from the Instagram app with Instagram's music. Instagram's API can
 * neither save drafts nor add its library music, so this is the fast path.
 *
 * iOS only opens the share sheet straight from a tap, so the video is fetched
 * ahead of time (when the reel is approved); the tap then shares instantly.
 * Where sharing files isn't supported (a desktop browser), it downloads.
 */
export function SaveToPhone({ url, fileName, preload }: { url: string; fileName: string; preload: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'saved' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const started = useRef<string | null>(null);

  const load = async (): Promise<File | null> => {
    if (file) return file;
    setState('loading');
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const f = new File([await res.blob()], fileName, { type: 'video/mp4' });
      setFile(f);
      setState('ready');
      return f;
    } catch (e) {
      setErr((e as Error).message);
      setState('error');
      return null;
    }
  };

  useEffect(() => {
    if (!preload || started.current === url) return;
    started.current = url;
    setFile(null);
    void load();
    // a new version (url) means a new file
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preload, url]);

  const canShareFiles = (f: File) => typeof navigator !== 'undefined' && !!navigator.canShare?.({ files: [f] });

  const save = async () => {
    setErr(null);
    // already fetched: share inside this tap (iOS needs that)
    const f = file ?? (await load());
    if (!f) return;
    if (canShareFiles(f)) {
      try {
        await navigator.share({ files: [f] });
        setState('saved');
      } catch (e) {
        const name = (e as Error).name;
        if (name === 'AbortError') return; // closed the sheet
        // the fetch took too long for iOS to count it as the same tap: the next tap works
        if (name === 'NotAllowedError') setErr('Ready, tap once more');
        else setErr((e as Error).message);
      }
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    setState('saved');
  };

  const label =
    state === 'loading' ? 'Getting it ready…' : state === 'saved' ? '✓ Saved · save again' : err === 'Ready, tap once more' ? 'Tap once more to save' : '📲 Save to phone';
  return (
    <span className="inline-flex flex-col">
      <button
        onClick={() => void save()}
        disabled={state === 'loading'}
        className="rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-60"
        style={{ background: DASH.green, color: DASH.page }}
        title="Opens the share sheet: choose Save Video, then post it from Instagram with your sound"
      >
        {label}
      </button>
      {err && err !== 'Ready, tap once more' && <span className="mt-1 text-xs" style={{ color: DASH.red }}>{err}</span>}
    </span>
  );
}
