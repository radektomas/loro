'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ButtonRow,
  createPlayWatch,
  createWatchSet,
  destroyAllPlayers,
  destroyLabPlayer,
  fmtState,
  LabButton,
  labLog,
  Metrics,
  mountLabPlayer,
  ms,
  PlayerStage,
  playerInfo,
  PLAYING,
  Prompt,
  stats,
  StatusLine,
  TestCard,
  useStateSequence,
  useTeardown,
  VID_A,
  type LabPlayer,
  type Status,
} from './labKit';

const WATCH_MS = 5_000;

// ---------------------------------------------------------- 8: clock accuracy

/** The sampling window, per the spec. */
const SAMPLE_MS = 10_000;
/** Hard stop: if rAF is suspended entirely the loops never reach the window. */
const SAMPLE_BAILOUT_MS = SAMPLE_MS + 4_000;

type ClockResult = {
  elapsed: number;
  clockReads: number;
  distinct: number;
  valueDeltaMs: ReturnType<typeof stats>;
  intervalMs: ReturnType<typeof stats>;
  rafFrames: number;
  rafMaxGap: number;
  interrupted: boolean;
  endInfo: string;
};

/**
 * How coarse is getCurrentTime(), really?
 *
 * The iframe reports position over postMessage a few times a second while the
 * karaoke highlight reads it every animation frame — so the gap between "reads
 * per second" and "fresh values per second" is the whole reason the feed's
 * adapter extrapolates instead of proxying. This measures both, plus a second
 * independent rAF loop: if the clock looks bad only while scrolling, the
 * question is whether rAF itself was throttled, and one loop cannot tell you.
 */
export function ClockAccuracyCard() {
  const id = 'clock-accuracy';
  const cardRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<LabPlayer | null>(null);
  const watchesRef = useRef(createWatchSet());
  const samplingRef = useRef(false);
  const interruptedRef = useRef(false);
  const { add: addTeardown, runAll: runTeardown } = useTeardown();
  const { record, reset, text: sequenceText } = useStateSequence();
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: 'not run yet' });
  const [armed, setArmed] = useState(false);
  const [sampling, setSampling] = useState(false);
  const [result, setResult] = useState<ClockResult | null>(null);

  const startSampling = useCallback(() => {
    const player = playerRef.current;
    if (!player || samplingRef.current) return;
    samplingRef.current = true;
    interruptedRef.current = false;
    setSampling(true);
    setResult(null);
    setStatus({
      kind: 'running',
      text: `sampling for ${SAMPLE_MS / 1000}s — SCROLL THE PAGE NOW, that is the point`,
    });
    labLog.push(
      id,
      `sampling getCurrentTime() at rAF for ${SAMPLE_MS}ms with a parallel rAF counter — scroll during this window to test throttling`
    );

    const t0 = performance.now();
    // Loop A: read the clock every frame and note when the value actually moves.
    let clockReads = 0;
    let lastValue = Number.NaN;
    const changeAt: number[] = [];
    const changeValue: number[] = [];
    // Loop B: nothing but a frame counter, so a throttled rAF is visible on its
    // own rather than being blamed on the player.
    let rafFrames = 0;
    let lastFrameAt = t0;
    let maxGap = 0;

    let clockRaf = 0;
    let counterRaf = 0;
    let stopped = false;

    const stop = (): void => {
      if (stopped) return;
      stopped = true;
      samplingRef.current = false;
      cancelAnimationFrame(clockRaf);
      cancelAnimationFrame(counterRaf);
      clearTimeout(bailout);

      const elapsed = performance.now() - t0;
      const intervals: number[] = [];
      for (let i = 1; i < changeAt.length; i += 1) {
        intervals.push(changeAt[i] - changeAt[i - 1]);
      }
      const valueDeltas: number[] = [];
      for (let i = 1; i < changeValue.length; i += 1) {
        valueDeltas.push((changeValue[i] - changeValue[i - 1]) * 1000);
      }

      const next: ClockResult = {
        elapsed,
        clockReads,
        distinct: changeAt.length,
        valueDeltaMs: stats(valueDeltas),
        intervalMs: stats(intervals),
        rafFrames,
        rafMaxGap: maxGap,
        interrupted: interruptedRef.current,
        endInfo: playerInfo(playerRef.current),
      };
      setResult(next);
      setSampling(false);

      const lines = [
        `window ${elapsed.toFixed(0)}ms (target ${SAMPLE_MS}ms)`,
        `clock reads ${clockReads} (${((clockReads / elapsed) * 1000).toFixed(1)}/s)`,
        `distinct values ${next.distinct} (${((next.distinct / elapsed) * 1000).toFixed(2)}/s)`,
        next.valueDeltaMs
          ? `value delta ms min=${ms(next.valueDeltaMs.min)} max=${ms(
              next.valueDeltaMs.max
            )} mean=${ms(next.valueDeltaMs.mean)}`
          : 'value delta: not enough changes',
        next.intervalMs
          ? `update interval min=${ms(next.intervalMs.min)} max=${ms(
              next.intervalMs.max
            )} mean=${ms(next.intervalMs.mean)} maxJitter=${ms(next.intervalMs.jitter)}`
          : 'update interval: not enough changes',
        `parallel rAF ${rafFrames} frames (${((rafFrames / elapsed) * 1000).toFixed(
          1
        )}fps), longest gap ${ms(maxGap)}`,
        `interrupted=${next.interrupted}`,
        next.endInfo,
      ];
      for (const line of lines) labLog.push(id, `clock: ${line}`);

      setStatus({
        kind: next.distinct > 0 ? 'pass' : 'fail',
        text: next.intervalMs
          ? `${next.distinct} fresh values in ${(elapsed / 1000).toFixed(
              1
            )}s — mean ${ms(next.intervalMs.mean)} apart, max jitter ${ms(
              next.intervalMs.jitter
            )}, ${((rafFrames / elapsed) * 1000).toFixed(0)}fps rAF`
          : 'the clock never moved — playback was probably not running',
      });
    };

    const clockLoop = (): void => {
      const now = performance.now();
      if (now - t0 >= SAMPLE_MS) {
        stop();
        return;
      }
      clockReads += 1;
      const value = playerRef.current?.getCurrentTime() ?? Number.NaN;
      if (Number.isFinite(value) && value !== lastValue) {
        lastValue = value;
        changeAt.push(now);
        changeValue.push(value);
      }
      clockRaf = requestAnimationFrame(clockLoop);
    };

    const counterLoop = (): void => {
      const now = performance.now();
      if (now - t0 >= SAMPLE_MS) {
        stop();
        return;
      }
      rafFrames += 1;
      maxGap = Math.max(maxGap, now - lastFrameAt);
      lastFrameAt = now;
      counterRaf = requestAnimationFrame(counterLoop);
    };

    const bailout = setTimeout(() => {
      labLog.push(
        id,
        `sampling hit the ${SAMPLE_BAILOUT_MS}ms bailout — rAF stopped firing (page hidden?), reporting partial data`
      );
      stop();
    }, SAMPLE_BAILOUT_MS);

    clockRaf = requestAnimationFrame(clockLoop);
    counterRaf = requestAnimationFrame(counterLoop);
    addTeardown(stop);
  }, [addTeardown, id]);

  const playThenSample = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    labLog.push(id, 'playVideo() from a button click; sampling starts on PLAYING');
    const watch = watchesRef.current.add(
      createPlayWatch({
        scope: id,
        label: 'playVideo() before sampling',
        timeoutMs: WATCH_MS,
        getPlayer: () => playerRef.current,
        onVerdict: (verdict) => {
          if (verdict.reached) startSampling();
          else
            setStatus({
              kind: 'fail',
              text: 'playback never started, so there is no clock to measure',
            });
        },
      })
    );
    addTeardown(() => watch.cancel());
    player.playVideo();
    setStatus({ kind: 'running', text: 'starting playback…' });
  }, [addTeardown, id, startSampling]);

  const run = useCallback(() => {
    runTeardown();
    watchesRef.current.cancelAll();
    destroyAllPlayers(id);
    playerRef.current = null;
    reset();
    setArmed(false);
    setResult(null);

    const stage = stageRef.current;
    if (!stage) return;
    setStatus({ kind: 'running', text: 'mounting (autoplay=0, mute=1)…' });

    void mountLabPlayer({
      mount: stage,
      videoId: VID_A.id,
      scope: id,
      autoplay: false,
      muted: true,
      onState: (code) => {
        record(code);
        watchesRef.current.note(code);
        // A pause or a buffer stall mid-window makes the numbers mean something
        // else entirely, so it is reported alongside them.
        if (samplingRef.current && code !== PLAYING) interruptedRef.current = true;
      },
    })
      .then((player) => {
        playerRef.current = player;
        setArmed(true);
        setStatus({ kind: 'waiting', text: 'armed — tap “Play & sample 10s”' });
      })
      .catch((error: unknown) => {
        labLog.push(id, `mount failed: ${String(error)}`);
        setStatus({ kind: 'fail', text: `mount failed: ${String(error)}` });
      });
  }, [id, record, reset, runTeardown]);

  useEffect(() => () => destroyLabPlayer(playerRef.current, id), [id]);

  const rows: Array<readonly [string, string]> = [['states', sequenceText]];
  if (result) {
    const perSecond = (count: number) => ((count / result.elapsed) * 1000).toFixed(1);
    rows.push(
      ['window', `${result.elapsed.toFixed(0)}ms`],
      ['clock reads', `${result.clockReads} (${perSecond(result.clockReads)}/s)`],
      [
        'distinct values',
        `${result.distinct} (${perSecond(result.distinct)}/s fresh)`,
      ],
      [
        'stale reads',
        `${result.clockReads - result.distinct} (${(
          ((result.clockReads - result.distinct) / Math.max(result.clockReads, 1)) *
          100
        ).toFixed(1)}%)`,
      ],
      [
        'value delta',
        result.valueDeltaMs
          ? `min ${ms(result.valueDeltaMs.min)} · max ${ms(
              result.valueDeltaMs.max
            )} · mean ${ms(result.valueDeltaMs.mean)}`
          : 'not enough changes',
      ],
      [
        'update interval',
        result.intervalMs
          ? `min ${ms(result.intervalMs.min)} · max ${ms(
              result.intervalMs.max
            )} · mean ${ms(result.intervalMs.mean)}`
          : 'not enough changes',
      ],
      [
        'max jitter',
        result.intervalMs ? ms(result.intervalMs.jitter) : 'not enough changes',
      ],
      [
        'parallel rAF',
        `${result.rafFrames} frames (${perSecond(result.rafFrames)}fps)`,
      ],
      ['longest rAF gap', `${ms(result.rafMaxGap)} (>32ms = dropped frames)`],
      ['interrupted', result.interrupted ? 'YES — state left PLAYING' : 'no'],
      ['player at end', result.endInfo]
    );
  }

  return (
    <TestCard
      id={id}
      n={8}
      title="Clock accuracy"
      question="Poll getCurrentTime() every animation frame for 10s and count how often it actually moves, alongside an independent rAF frame counter. Scroll the page during the window: if the clock degrades but the counter does not, the clock is the problem — if both degrade, rAF was throttled."
      cardRef={cardRef}
    >
      <ButtonRow>
        <LabButton onClick={run} tone="primary">
          Run
        </LabButton>
        <LabButton onClick={playThenSample} disabled={!armed || sampling}>
          Play &amp; sample 10s
        </LabButton>
      </ButtonRow>
      {sampling ? <Prompt>SCROLL THE PAGE UP AND DOWN NOW</Prompt> : null}
      <StatusLine status={status} />
      <PlayerStage mountRef={stageRef} caption={`${VID_A.id} · ${VID_A.seconds}s`} />
      <Metrics rows={rows} />
    </TestCard>
  );
}

// ----------------------------------------------------- 9: visibility recovery

type Snapshot = { at: number; info: string; time: number; state: number };

/**
 * A phone user leaves and comes back constantly. What matters is whether the
 * player resumes by itself, resumes but with a stalled clock, or needs an
 * explicit playVideo() — and whether that playVideo() still counts as blessed
 * after the round trip, since it will be issued from a visibilitychange
 * handler, which is not a user gesture.
 *
 * pagehide/pageshow are logged next to visibilitychange because iOS Safari does
 * not always deliver both, and a silent test is worse than a noisy one.
 */
export function VisibilityRecoveryCard() {
  const id = 'visibility';
  const cardRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<LabPlayer | null>(null);
  const watchesRef = useRef(createWatchSet());
  const hiddenRef = useRef<Snapshot | null>(null);
  const { add: addTeardown, runAll: runTeardown } = useTeardown();
  const { record, reset, text: sequenceText } = useStateSequence();
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: 'not run yet' });
  const [armed, setArmed] = useState(false);
  const [blessed, setBlessed] = useState(false);
  const [rows, setRows] = useState<ReadonlyArray<readonly [string, string]>>([]);

  const addRow = useCallback((key: string, value: string) => {
    setRows((previous) => [...previous, [key, value] as const]);
  }, []);

  const snapshot = useCallback((): Snapshot => {
    const player = playerRef.current;
    return {
      at: performance.now(),
      info: playerInfo(player),
      time: player?.getCurrentTime() ?? Number.NaN,
      state: player?.getPlayerState() ?? Number.NaN,
    };
  }, []);

  /** After returning, watch for a few seconds before judging "auto-resumed". */
  const watchRecovery = useCallback(
    (before: Snapshot | null) => {
      const offsets = [250, 750, 1500, 3000] as const;
      const taken: Snapshot[] = [];
      offsets.forEach((offset, index) => {
        const timer = setTimeout(() => {
          const now = snapshot();
          taken.push(now);
          labLog.push(id, `after return +${offset}ms — ${now.info}`);
          addRow(`return +${offset}ms`, now.info);
          if (index !== offsets.length - 1) return;

          const first = taken[0];
          const last = taken[taken.length - 1];
          const advanced =
            Number.isFinite(first.time) &&
            Number.isFinite(last.time) &&
            last.time - first.time > 0.05;
          const resumed = last.state === PLAYING && advanced;
          const verdict = resumed
            ? `AUTO-RESUMED: state ${fmtState(last.state)}, clock advanced ${(
                last.time - first.time
              ).toFixed(2)}s over ${offsets[offsets.length - 1] - offsets[0]}ms`
            : `DID NOT RESUME: state ${fmtState(last.state)}, clock advanced ${(
                last.time - first.time
              ).toFixed(
                2
              )}s — an explicit playVideo() is needed (use the button below)`;
          labLog.push(
            id,
            `VERDICT visibility recovery: ${verdict}${
              before ? ` — before hiding: ${before.info}` : ''
            }`
          );
          addRow('verdict', verdict);
          setStatus({ kind: resumed ? 'pass' : 'fail', text: verdict });
        }, offset);
        addTeardown(() => clearTimeout(timer));
      });
    },
    [addRow, addTeardown, id, snapshot]
  );

  const bless = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    labLog.push(id, 'bless: playVideo() from a button click');
    const watch = watchesRef.current.add(
      createPlayWatch({
        scope: id,
        label: 'blessed play before backgrounding',
        timeoutMs: WATCH_MS,
        getPlayer: () => playerRef.current,
        onVerdict: (verdict) => {
          setBlessed(verdict.reached);
          setStatus(
            verdict.reached
              ? {
                  kind: 'waiting',
                  text: 'playing — now background the app (home / lock / app switcher) for a few seconds, then come back',
                }
              : { kind: 'fail', text: 'playback never started; re-run the test' }
          );
        },
      })
    );
    addTeardown(() => watch.cancel());
    player.playVideo();
  }, [addTeardown, id]);

  const resume = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    // A probe waits for a PLAYING *event*, and a player that is already playing
    // will never fire another one — arming it here would report "did not
    // recover" about a video that is running fine.
    if (player.getPlayerState() === PLAYING) {
      const note = `already PLAYING before the explicit call — nothing to recover, ${playerInfo(
        player
      )}`;
      labLog.push(id, note);
      addRow('explicit playVideo()', 'skipped — already playing');
      setStatus({ kind: 'info', text: note });
      return;
    }
    labLog.push(id, `explicit playVideo() after return — before: ${playerInfo(player)}`);
    const watch = watchesRef.current.add(
      createPlayWatch({
        scope: id,
        label: 'explicit playVideo() after return',
        timeoutMs: WATCH_MS,
        getPlayer: () => playerRef.current,
        onVerdict: (verdict) => {
          addRow(
            'explicit playVideo()',
            verdict.reached ? `recovered in ${verdict.ms}ms` : 'still not playing'
          );
          setStatus(
            verdict.reached
              ? { kind: 'pass', text: `explicit playVideo() recovered playback in ${verdict.ms}ms` }
              : {
                  kind: 'fail',
                  text: 'even an explicit playVideo() did not recover — the blessing did not survive',
                }
          );
        },
      })
    );
    addTeardown(() => watch.cancel());
    player.playVideo();
  }, [addRow, addTeardown, id]);

  const run = useCallback(() => {
    runTeardown();
    watchesRef.current.cancelAll();
    destroyAllPlayers(id);
    playerRef.current = null;
    reset();
    setArmed(false);
    setBlessed(false);
    setRows([]);
    hiddenRef.current = null;

    const stage = stageRef.current;
    if (!stage) return;
    setStatus({ kind: 'running', text: 'mounting (autoplay=0, mute=1)…' });

    const onVisibility = () => {
      const state = document.visibilityState;
      const now = snapshot();
      labLog.push(id, `visibilitychange -> ${state} — ${now.info}`);
      if (state === 'hidden') {
        hiddenRef.current = now;
        addRow('hidden at', now.info);
        return;
      }
      const before = hiddenRef.current;
      const away = before ? Math.round(now.at - before.at) : null;
      labLog.push(
        id,
        `returned after ${away === null ? 'unknown time' : `${away}ms`} away — before: ${
          before?.info ?? 'no hidden snapshot'
        } / now: ${now.info}`
      );
      addRow('visible at', `${away === null ? '' : `after ${away}ms away · `}${now.info}`);
      watchRecovery(before);
    };
    const onPageHide = () => labLog.push(id, `pagehide — ${playerInfo(playerRef.current)}`);
    const onPageShow = () => labLog.push(id, `pageshow — ${playerInfo(playerRef.current)}`);

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    addTeardown(() => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
    });

    void mountLabPlayer({
      mount: stage,
      videoId: VID_A.id,
      scope: id,
      autoplay: false,
      muted: true,
      onState: (code) => {
        record(code);
        watchesRef.current.note(code);
      },
    })
      .then((player) => {
        playerRef.current = player;
        setArmed(true);
        setStatus({ kind: 'waiting', text: 'armed — tap “Bless & play”, then background the app' });
      })
      .catch((error: unknown) => {
        labLog.push(id, `mount failed: ${String(error)}`);
        setStatus({ kind: 'fail', text: `mount failed: ${String(error)}` });
      });
  }, [addRow, addTeardown, id, record, reset, runTeardown, snapshot, watchRecovery]);

  useEffect(() => () => destroyLabPlayer(playerRef.current, id), [id]);

  return (
    <TestCard
      id={id}
      n={9}
      title="Visibility recovery"
      question="Play, then leave the app and come back. Every visibilitychange (plus pagehide/pageshow) is logged with the player state either side, and the clock is sampled for 3s after the return to tell a real resume from a PLAYING state whose clock is frozen."
      cardRef={cardRef}
    >
      <ButtonRow>
        <LabButton onClick={run} tone="primary">
          Run
        </LabButton>
        <LabButton onClick={bless} disabled={!armed}>
          Bless &amp; play
        </LabButton>
        <LabButton onClick={resume} disabled={!blessed}>
          Resume with playVideo()
        </LabButton>
      </ButtonRow>
      {blessed ? (
        <Prompt>
          NOW BACKGROUND THE APP — home screen, lock the phone, or switch apps — THEN COME BACK
        </Prompt>
      ) : null}
      <StatusLine status={status} />
      <PlayerStage mountRef={stageRef} caption={`${VID_A.id} · ${VID_A.creator}`} />
      <Metrics rows={[['states', sequenceText], ...rows]} />
    </TestCard>
  );
}
