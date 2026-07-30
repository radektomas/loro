'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  autoRunTarget,
  copyText,
  destroyAllPlayers,
  embedHostUrl,
  getEmbedHost,
  labLog,
  LabButton,
  setEmbedHost,
  useLogEntries,
  type CopyResult,
  type EmbedHost,
} from './labKit';
import {
  MutedAutoplayCard,
  TapGestureCard,
  TouchstartGestureCard,
  UnmutedAutoplayCard,
} from './cardsAutoplay';
import {
  BlessAcrossPauseCard,
  BlessingPersistenceCard,
  DualPlayerCard,
  UnmutePersistenceCard,
} from './cardsPersistence';
import { ClockAccuracyCard, VisibilityRecoveryCard } from './cardsRuntime';

/**
 * iOS Safari autoplay lab — the shell: device header, global controls, the nine
 * test cards, and the append-only log.
 *
 * Everything is on-screen by design. This page is meant to be driven on a
 * physical iPhone with no devtools attached, so console output would be
 * invisible and the log panel plus "Copy log" is the entire reporting channel.
 */

/** Read once and shown in the header, so a pasted log identifies its device. */
type DeviceInfo = ReadonlyArray<readonly [string, string]>;

let deviceLogged = false;

function readDeviceInfo(): DeviceInfo {
  if (typeof window === 'undefined') return [];
  const nav = navigator as Navigator & { standalone?: boolean };
  const standalone =
    nav.standalone === true ||
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches);
  return [
    ['userAgent', navigator.userAgent],
    ['screen', `${window.screen.width}×${window.screen.height} css px`],
    ['viewport', `${window.innerWidth}×${window.innerHeight}`],
    ['devicePixelRatio', String(window.devicePixelRatio)],
    ['hardwareConcurrency', String(navigator.hardwareConcurrency ?? 'unknown')],
    ['display-mode', standalone ? 'standalone (PWA)' : 'browser tab'],
  ];
}

export function AutoplayLab() {
  // Read in an effect, not during render: every one of these values differs
  // between the server and the phone, and this page's whole purpose is to
  // report the phone's.
  const [device, setDevice] = useState<DeviceInfo>([]);
  const [host, setHost] = useState<EmbedHost>('nocookie');
  const [copied, setCopied] = useState<string | null>(null);
  const [stopped, setStopped] = useState<string | null>(null);
  const entries = useLogEntries();
  const logRef = useRef<HTMLDivElement | null>(null);
  // Read in the mount effect, not during render: the server cannot see the
  // query string, and rendering the banner from it directly is a hydration
  // mismatch (React discards and re-renders the whole tree).
  const [autoRun, setAutoRun] = useState<string | null>(null);

  useEffect(() => {
    const info = readDeviceInfo();
    setDevice(info);
    setHost(getEmbedHost());
    setAutoRun(autoRunTarget());
    if (deviceLogged) return;
    deviceLogged = true;
    labLog.push('device', `url ${window.location.href}`);
    for (const [key, value] of info) labLog.push('device', `${key}: ${value}`);
  }, []);

  // Newest entries are at the bottom, so follow them.
  useEffect(() => {
    const element = logRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [entries.length]);

  // Built from the device state rather than re-reading the DOM, because this
  // also runs during the server render for the select-all box's value.
  const logText = useCallback(
    () =>
      [
        '# Loro autoplay lab',
        ...device.map(([key, value]) => `${key}: ${value}`),
        `embed host: ${embedHostUrl()}`,
        '',
        labLog.toText(),
      ].join('\n'),
    [device]
  );

  const onCopy = useCallback(() => {
    void copyText(logText()).then((result: CopyResult) => {
      setCopied(
        result === 'failed'
          ? 'copy blocked — use the select-all box below'
          : `copied ${entries.length} lines (${result})`
      );
      setTimeout(() => setCopied(null), 4_000);
    });
  }, [entries.length, logText]);

  const onStopAll = useCallback(() => {
    const count = destroyAllPlayers('config');
    setStopped(`destroyed ${count} player(s)`);
    setTimeout(() => setStopped(null), 3_000);
  }, []);

  const onToggleHost = useCallback(() => {
    const next: EmbedHost = getEmbedHost() === 'nocookie' ? 'youtube' : 'nocookie';
    setEmbedHost(next);
    setHost(next);
  }, []);

  return (
    <main className="mx-auto max-w-2xl px-4 pt-safe pb-16">
      <header className="pt-4">
        <h1 className="text-lg font-semibold">Autoplay lab</h1>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Dev-only diagnostics for iOS Safari autoplay on the video feed. Each card
          mounts its own player on Run; nothing here touches feed code. Every
          observation lands in the log at the bottom —{' '}
          <a href="#log" className="text-level underline decoration-dotted">
            jump to log
          </a>
          .
        </p>

        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-2xl bg-surface p-3 font-mono text-[11px]">
          {device.length === 0 ? (
            <div className="col-span-2 text-muted">reading device info…</div>
          ) : (
            [...device, ['embed host', embedHostUrl()] as const].map(([key, value]) => (
              <div key={key} className="col-span-2 grid grid-cols-subgrid">
                <dt className="text-muted">{key}</dt>
                <dd className="break-all text-text">{value}</dd>
              </div>
            ))
          )}
        </dl>

        <div className="mt-3 flex flex-wrap gap-2">
          <LabButton onClick={onCopy}>Copy log</LabButton>
          <LabButton onClick={onStopAll}>Destroy all players</LabButton>
          <LabButton onClick={onToggleHost}>
            host: {host === 'nocookie' ? 'nocookie' : 'youtube.com'}
          </LabButton>
        </div>
        {copied ? (
          <p className="mt-2 font-mono text-[11px] text-accent">{copied}</p>
        ) : null}
        {stopped ? (
          <p className="mt-2 font-mono text-[11px] text-accent">{stopped}</p>
        ) : null}
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          Every Run destroys any player left over from an earlier card, so each
          test measures an unloaded device rather than one already decoding five
          videos. The host toggle applies to players mounted from now on. Tapping Run is
          itself a user gesture and Safari keeps activation for the whole page
          load, so tests 1–4 and 7 also offer a “clean run” link that reloads the
          page and starts the test with zero prior gestures.
        </p>
        {autoRun ? (
          <p className="mt-2 rounded-2xl bg-level-soft p-2 font-mono text-[11px] text-level">
            auto-running “{autoRun}” from ?run= — this page load had no prior tap
          </p>
        ) : null}
      </header>

      <div className="mt-5 space-y-4">
        <MutedAutoplayCard />
        <UnmutedAutoplayCard />
        <TouchstartGestureCard />
        <TapGestureCard />
        <BlessingPersistenceCard />
        <UnmutePersistenceCard />
        <DualPlayerCard />
        <ClockAccuracyCard />
        <VisibilityRecoveryCard />
        <BlessAcrossPauseCard />
      </div>

      <section id="log" className="mt-6 scroll-mt-4 rounded-3xl bg-surface p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Log</h2>
          <span className="font-mono text-[11px] text-muted">
            {entries.length} entries · append-only
          </span>
        </div>
        <div
          ref={logRef}
          className="mt-2 max-h-[45vh] overflow-y-auto rounded-2xl bg-background/60 p-3 font-mono text-[10px] leading-relaxed"
        >
          {entries.length === 0 ? (
            <p className="text-muted">nothing yet — run a test</p>
          ) : (
            entries.map((entry) => (
              <p key={entry.seq} className="break-words">
                <span className="text-muted">
                  +{(entry.sinceLoad / 1000).toFixed(3)}s
                </span>{' '}
                <span className="text-level">[{entry.scope}]</span> {entry.text}
              </p>
            ))
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <LabButton onClick={onCopy} tone="primary">
            Copy log
          </LabButton>
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-muted">
            Copy button blocked? Open for a select-all box
          </summary>
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            The clipboard API only exists on a secure origin, so over
            http://192.168.x.x the button falls back to execCommand and may still
            fail. This box always works: long-press, Select All, Copy.
          </p>
          <textarea
            readOnly
            value={logText()}
            onFocus={(event) => event.currentTarget.select()}
            className="mt-2 h-40 w-full rounded-2xl bg-background/60 p-2 font-mono text-[10px]"
          />
        </details>
      </section>
    </main>
  );
}
