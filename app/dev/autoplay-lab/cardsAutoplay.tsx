'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ButtonRow,
  CleanRunLink,
  createPlayWatch,
  createWatchSet,
  destroyAllPlayers,
  destroyLabPlayer,
  fmtError,
  fmtState,
  LabButton,
  labLog,
  mountLabPlayer,
  PlayerStage,
  Prompt,
  Metrics,
  StatusLine,
  TestCard,
  useAutoRun,
  useStateSequence,
  useTeardown,
  VID_A,
  VID_B,
  type LabPlayer,
  type Status,
  type Verdict,
} from './labKit';

/** How long a play attempt is given before we call it blocked. */
const WATCH_MS = 5_000;

// ------------------------------------------------------- 1 & 2: raw autoplay

/**
 * Tests 1 and 2 differ only in the mute playerVar, so they are one component
 * used twice — the interesting output is the pair of results side by side.
 *
 * The 5s window starts at Run, not at onReady, so a slow boot cannot hide
 * inside the measurement; onReady's own timing is in the log to separate the
 * two. Nothing calls playVideo(): if the video plays, it is the autoplay
 * playerVar that did it.
 */
function AutoplayCard({
  n,
  id,
  title,
  question,
  muted,
}: {
  n: number;
  id: string;
  title: string;
  question: string;
  muted: boolean;
}) {
  const cardRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<LabPlayer | null>(null);
  const watchesRef = useRef(createWatchSet());
  const { add: addTeardown, runAll: runTeardown } = useTeardown();
  const { record, reset, text: sequenceText } = useStateSequence();
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: 'not run yet' });
  const [errors, setErrors] = useState<readonly string[]>([]);
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  const label = muted ? 'autoplay mute=1' : 'autoplay mute=0';

  const run = useCallback(() => {
    runTeardown();
    watchesRef.current.cancelAll();
    destroyAllPlayers(id);
    playerRef.current = null;
    reset();
    setErrors([]);
    setVerdict(null);

    const stage = stageRef.current;
    if (!stage) return;

    setStatus({
      kind: 'running',
      text: `mounting with ${label}; watching ${WATCH_MS}ms for PLAYING…`,
    });

    const watch = watchesRef.current.add(
      createPlayWatch({
        scope: id,
        label,
        timeoutMs: WATCH_MS,
        getPlayer: () => playerRef.current,
        onVerdict: (result) => {
          setVerdict(result);
          setStatus(
            result.reached
              ? {
                  kind: 'pass',
                  text: `PLAYING ${result.ms}ms after Run — ${label} is permitted here`,
                }
              : {
                  kind: 'fail',
                  text: `no PLAYING within ${WATCH_MS}ms — last state ${fmtState(
                    result.lastCode
                  )}`,
                }
          );
        },
      })
    );
    addTeardown(() => watch.cancel());

    void mountLabPlayer({
      mount: stage,
      videoId: muted ? VID_A.id : VID_B.id,
      scope: id,
      autoplay: true,
      muted,
      onState: (code) => {
        record(code);
        watchesRef.current.note(code);
      },
      onError: (code) => setErrors((previous) => [...previous, fmtError(code)]),
    })
      .then((player) => {
        playerRef.current = player;
      })
      .catch((error: unknown) => {
        labLog.push(id, `mount failed: ${String(error)}`);
        setStatus({ kind: 'fail', text: `mount failed: ${String(error)}` });
      });
  }, [addTeardown, id, label, muted, record, reset, runTeardown]);

  useEffect(() => () => destroyLabPlayer(playerRef.current, id), [id]);
  useAutoRun(id, run, cardRef);

  return (
    <TestCard id={id} n={n} title={title} question={question} cardRef={cardRef}>
      <ButtonRow>
        <LabButton onClick={run} tone="primary">
          Run
        </LabButton>
      </ButtonRow>
      <CleanRunLink id={id} />
      <StatusLine status={status} />
      <PlayerStage
        mountRef={stageRef}
        caption={`${muted ? VID_A.id : VID_B.id} · ${muted ? VID_A.creator : VID_B.creator}`}
      />
      <Metrics
        rows={[
          ['states', sequenceText],
          ['reached PLAYING', verdict ? (verdict.reached ? `yes (${verdict.ms}ms)` : 'no') : '—'],
          ['error events', errors.length === 0 ? 'none' : errors.join(', ')],
        ]}
      />
    </TestCard>
  );
}

export function MutedAutoplayCard() {
  return (
    <AutoplayCard
      n={1}
      id="muted-autoplay"
      title="Muted autoplay"
      question="autoplay=1 mute=1 playsinline=1 enablejsapi=1, nothing calls playVideo(). Does it reach PLAYING within 5s on its own?"
      muted
    />
  );
}

export function UnmutedAutoplayCard() {
  return (
    <AutoplayCard
      n={2}
      id="unmuted-autoplay"
      title="Unmuted autoplay (expected to fail)"
      question="Identical but mute=0. The point is the failure MODE: which state sequence do we get, and does any onError fire, or does it simply go quiet?"
      muted={false}
    />
  );
}

// ------------------------------------------------- 3 & 4: gesture blessing

/**
 * Tests 3 and 4 are the reason this lab exists: is the touchstart that BEGINS
 * a swipe enough activation to start playback, or does Safari only bless a
 * completed tap? The feed's whole autoplay-on-swipe design rests on the answer.
 *
 * Both mount with mute=0 on purpose. Muted playback is permitted without any
 * gesture at all (test 1 proves it), so a muted probe here would pass no matter
 * what and measure nothing. Unmuted playback is exactly the thing a gesture has
 * to unlock, which makes it the only honest probe.
 */
function GestureCard({
  n,
  id,
  title,
  question,
  mode,
}: {
  n: number;
  id: string;
  title: string;
  question: string;
  mode: 'touchstart' | 'tap';
}) {
  const cardRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<LabPlayer | null>(null);
  const watchesRef = useRef(createWatchSet());
  const { add: addTeardown, runAll: runTeardown } = useTeardown();
  const { record, reset, text: sequenceText } = useStateSequence();
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: 'not run yet' });
  const [armed, setArmed] = useState(false);
  const [gesture, setGesture] = useState<string>('—');
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  /** Set while the touchstart probe is armed; releases the link blocker. */
  const unarmRef = useRef<(() => void) | null>(null);

  /** Call playVideo() SYNCHRONOUSLY inside the gesture handler — no awaits. */
  const attempt = useCallback(
    (source: string) => {
      setArmed(false);
      setGesture(source);
      // Hold the link blocker until the verdict is in: the click that follows
      // this touchstart has not been dispatched yet, and neither has the tester
      // finished reading the result.
      if (unarmRef.current) {
        const unarm = unarmRef.current;
        unarmRef.current = null;
        const timer = setTimeout(unarm, WATCH_MS + 500);
        addTeardown(() => {
          clearTimeout(timer);
          unarm();
        });
      }
      const player = playerRef.current;
      if (!player) {
        labLog.push(id, `${source} arrived but the player is gone`);
        setStatus({ kind: 'fail', text: 'player missing — re-run the test' });
        return;
      }
      labLog.push(
        id,
        `${source} — calling playVideo() synchronously in the handler (mute=0)`
      );
      const watch = watchesRef.current.add(
        createPlayWatch({
          scope: id,
          label: `playVideo() from ${source}`,
          timeoutMs: WATCH_MS,
          getPlayer: () => playerRef.current,
          onVerdict: (result) => {
            setVerdict(result);
            setStatus(
              result.reached
                ? {
                    kind: 'pass',
                    text: `PLAYING ${result.ms}ms after the ${source} — this gesture IS sufficient activation for unmuted play`,
                  }
                : {
                    kind: 'fail',
                    text: `no PLAYING within ${WATCH_MS}ms of the ${source} — last state ${fmtState(
                      result.lastCode
                    )}. This gesture is NOT sufficient.`,
                  }
            );
          },
        })
      );
      addTeardown(() => watch.cancel());
      player.playVideo();
      setStatus({ kind: 'running', text: `playVideo() issued from ${source}; watching ${WATCH_MS}ms…` });
    },
    [addTeardown, id]
  );

  const run = useCallback(() => {
    runTeardown();
    watchesRef.current.cancelAll();
    destroyAllPlayers(id);
    playerRef.current = null;
    reset();
    setArmed(false);
    setGesture('—');
    setVerdict(null);

    const stage = stageRef.current;
    if (!stage) return;

    setStatus({ kind: 'running', text: 'mounting (autoplay=0, mute=0)…' });

    void mountLabPlayer({
      mount: stage,
      videoId: VID_A.id,
      scope: id,
      autoplay: false,
      muted: false,
      onState: (code) => {
        record(code);
        watchesRef.current.note(code);
      },
    })
      .then((player) => {
        playerRef.current = player;
        setArmed(true);
        if (mode === 'touchstart') {
          // once+passive: a one-shot observer that cannot alter how the browser
          // treats the gesture. Capture so a touch anywhere reaches us even if
          // something below stops propagation.
          const options = { once: true, passive: true, capture: true } as const;
          const handler = (event: Event) => {
            const touches =
              'touches' in event ? (event as TouchEvent).touches.length : 0;
            attempt(`document touchstart (${touches} touch point(s))`);
          };
          document.addEventListener('touchstart', handler, options);
          addTeardown(() =>
            document.removeEventListener('touchstart', handler, options)
          );

          // "Touch anywhere" includes the clean-run links, and following one is
          // a full page load that wipes the log — losing the very result the
          // touch just produced. The touchstart has already been measured by
          // the time click fires, so cancelling the navigation costs nothing.
          const blockLinks = (event: MouseEvent) => {
            const anchor =
              event.target instanceof Element ? event.target.closest('a') : null;
            if (!anchor) return;
            event.preventDefault();
            labLog.push(
              id,
              `blocked navigation to ${anchor.getAttribute(
                'href'
              )} — a link was tapped while this test was armed, so the log survives`
            );
          };
          document.addEventListener('click', blockLinks, true);
          const releaseLinks = () =>
            document.removeEventListener('click', blockLinks, true);
          unarmRef.current = releaseLinks;
          addTeardown(releaseLinks);

          labLog.push(
            id,
            'armed: one-shot touchstart listener on document — waiting for a touch anywhere'
          );
          setStatus({
            kind: 'waiting',
            text: 'armed — swipe or touch anywhere on the page',
          });
        } else {
          labLog.push(id, 'armed: waiting for a click on this card’s button');
          setStatus({ kind: 'waiting', text: 'armed — tap the button below' });
        }
      })
      .catch((error: unknown) => {
        labLog.push(id, `mount failed: ${String(error)}`);
        setStatus({ kind: 'fail', text: `mount failed: ${String(error)}` });
      });
  }, [addTeardown, attempt, id, mode, record, reset, runTeardown]);

  useEffect(() => () => destroyLabPlayer(playerRef.current, id), [id]);
  useAutoRun(id, run, cardRef);

  return (
    <TestCard id={id} n={n} title={title} question={question} cardRef={cardRef}>
      <ButtonRow>
        <LabButton onClick={run} tone="primary">
          Run
        </LabButton>
        {mode === 'tap' ? (
          <LabButton onClick={() => attempt('button click')} disabled={!armed}>
            Tap here to play
          </LabButton>
        ) : null}
      </ButtonRow>
      <CleanRunLink id={id} />
      {armed && mode === 'touchstart' ? (
        <Prompt>SWIPE OR TOUCH ANYWHERE</Prompt>
      ) : null}
      <StatusLine status={status} />
      <PlayerStage mountRef={stageRef} caption={`${VID_A.id} · ${VID_A.creator}`} />
      <Metrics
        rows={[
          ['gesture', gesture],
          ['states', sequenceText],
          [
            'blessed play',
            verdict ? (verdict.reached ? `yes (${verdict.ms}ms)` : 'no') : '—',
          ],
        ]}
      />
    </TestCard>
  );
}

export function TouchstartGestureCard() {
  return (
    <GestureCard
      n={3}
      id="gesture-touchstart"
      title="Gesture blessing via touchstart"
      question="Player mounted but never autoplayed; a one-shot document touchstart calls playVideo(). Is the start of a scroll gesture sufficient activation? (Desktop testers: touchstart never fires — use test 4.)"
      mode="touchstart"
    />
  );
}

export function TapGestureCard() {
  return (
    <GestureCard
      n={4}
      id="gesture-tap"
      title="Gesture blessing via tap"
      question="Same setup, but playVideo() runs from a click handler on an explicit button. Comparing 3 against 4 is the key output of this lab: same call, same player, different gesture."
      mode="tap"
    />
  );
}
