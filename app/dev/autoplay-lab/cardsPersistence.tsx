'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ButtonRow,
  CleanRunLink,
  createPlayWatch,
  createWatchSet,
  currentVideoId,
  destroyAllPlayers,
  destroyLabPlayer,
  fmtState,
  LabButton,
  labLog,
  Metrics,
  mountLabPlayer,
  pageGestureCount,
  PlayerStage,
  playerInfo,
  PLAYING,
  Prompt,
  StatusLine,
  TestCard,
  useAutoRun,
  useStateSequence,
  useTeardown,
  VID_A,
  VID_B,
  VID_C,
  VID_D,
  type LabPlayer,
  type Status,
  type Verdict,
} from './labKit';

const WATCH_MS = 5_000;
/** Long enough to be unambiguously outside any user-gesture context. */
const DEFERRED_MS = 2_000;

/**
 * Gate a swap probe on the player reporting the video it was pointed at.
 *
 * If the player will not say which video it holds we accept and say so in the
 * log: a false positive that is labelled beats a silent false negative that
 * would read as "iOS refused the swap".
 */
function acceptSwappedVideo(
  scope: string,
  label: string,
  player: LabPlayer | null,
  targetId: string
): boolean {
  const seen = currentVideoId(player);
  if (seen === null) {
    labLog.push(
      scope,
      `${label}: accepting PLAYING without an id check — getVideoData() gave nothing`
    );
    return true;
  }
  return seen === targetId;
}

function verdictText(verdict: Verdict | null): string {
  if (!verdict) return '—';
  return verdict.reached
    ? `PLAYING after ${verdict.ms}ms`
    : `no PLAYING in ${WATCH_MS}ms (last ${fmtState(verdict.lastCode)})`;
}

// ------------------------------------------ 5: blessing across loadVideoById

/**
 * The feed swaps videos on the same player as the user scrolls, so the
 * question is whether one blessing covers every later loadVideoById() — and
 * whether it still covers one issued from a timer, which is what a prefetch or
 * a debounced scroll handler would look like.
 *
 * Both swaps are gated on the reported video id: the player is still PLAYING
 * the previous video at the moment the swap is issued, and a trailing PLAYING
 * event from that video would otherwise read as a success.
 */
export function BlessingPersistenceCard() {
  const id = 'swap-persistence';
  const cardRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<LabPlayer | null>(null);
  const watchesRef = useRef(createWatchSet());
  const { add: addTeardown, runAll: runTeardown } = useTeardown();
  const { record, reset, text: sequenceText } = useStateSequence();
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: 'not run yet' });
  const [armed, setArmed] = useState(false);
  const [blessed, setBlessed] = useState(false);
  const [inGesture, setInGesture] = useState<Verdict | null>(null);
  const [deferred, setDeferred] = useState<Verdict | null>(null);

  const bless = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    labLog.push(id, 'bless: playVideo() from a button click (mute=0)');
    const watch = watchesRef.current.add(
      createPlayWatch({
        scope: id,
        label: 'initial blessed play',
        timeoutMs: WATCH_MS,
        getPlayer: () => playerRef.current,
        onVerdict: (result) => {
          setBlessed(result.reached);
          setStatus(
            result.reached
              ? {
                  kind: 'info',
                  text: 'blessed and playing — now try the two swap buttons',
                }
              : {
                  kind: 'fail',
                  text: `the blessing itself failed (${verdictText(
                    result
                  )}) — the swap results below would be meaningless`,
                }
          );
        },
      })
    );
    addTeardown(() => watch.cancel());
    player.playVideo();
    setStatus({ kind: 'running', text: 'playVideo() issued from the tap…' });
  }, [addTeardown, id]);

  /** Arm a probe for one swap, then issue it. Same code for both buttons. */
  const swap = useCallback(
    (targetId: string, label: string) => {
      const player = playerRef.current;
      if (!player) return;
      labLog.push(
        id,
        `${label}: loadVideoById('${targetId}') on the SAME player — before: ${playerInfo(
          player
        )}`
      );
      const watch = watchesRef.current.add(
        createPlayWatch({
          scope: id,
          label,
          timeoutMs: WATCH_MS,
          getPlayer: () => playerRef.current,
          accept: () =>
            acceptSwappedVideo(id, label, playerRef.current, targetId),
          onVerdict: (result) => {
            if (label.startsWith('swap in gesture')) setInGesture(result);
            else setDeferred(result);
            setStatus(
              result.reached
                ? { kind: 'pass', text: `${label}: started with no new gesture (${result.ms}ms)` }
                : {
                    kind: 'fail',
                    text: `${label}: ${verdictText(result)} — a new gesture is required`,
                  }
            );
          },
        })
      );
      addTeardown(() => watch.cancel());
      player.loadVideoById(targetId);
    },
    [addTeardown, id]
  );

  const swapNow = useCallback(() => {
    setInGesture(null);
    swap(VID_B.id, `swap in gesture (${VID_B.id})`);
  }, [swap]);

  const swapDeferred = useCallback(() => {
    setDeferred(null);
    labLog.push(
      id,
      `scheduling loadVideoById('${VID_C.id}') in ${DEFERRED_MS}ms — it will run with no gesture context at all`
    );
    setStatus({ kind: 'waiting', text: `deferred swap fires in ${DEFERRED_MS}ms…` });
    const timer = setTimeout(() => {
      swap(VID_C.id, `swap outside gesture (${VID_C.id}, +${DEFERRED_MS}ms)`);
    }, DEFERRED_MS);
    addTeardown(() => clearTimeout(timer));
  }, [addTeardown, id, swap]);

  const run = useCallback(() => {
    runTeardown();
    watchesRef.current.cancelAll();
    destroyAllPlayers(id);
    playerRef.current = null;
    reset();
    setArmed(false);
    setBlessed(false);
    setInGesture(null);
    setDeferred(null);

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
        setStatus({ kind: 'waiting', text: 'armed — tap “Bless & play” first' });
      })
      .catch((error: unknown) => {
        labLog.push(id, `mount failed: ${String(error)}`);
        setStatus({ kind: 'fail', text: `mount failed: ${String(error)}` });
      });
  }, [id, record, reset, runTeardown]);

  useEffect(() => () => destroyLabPlayer(playerRef.current, id), [id]);

  return (
    <TestCard
      id={id}
      n={5}
      title="Blessing persistence across loadVideoById"
      question="One blessed play, then two swaps on the SAME player instance: one issued inside the click handler, one from a 2s timer with no gesture context. Does the blessing carry over, and does it survive leaving the gesture?"
      cardRef={cardRef}
    >
      <ButtonRow>
        <LabButton onClick={run} tone="primary">
          Run
        </LabButton>
        <LabButton onClick={bless} disabled={!armed}>
          Bless &amp; play
        </LabButton>
      </ButtonRow>
      <ButtonRow>
        <LabButton onClick={swapNow} disabled={!blessed}>
          Load next video (in gesture)
        </LabButton>
        <LabButton onClick={swapDeferred} disabled={!blessed}>
          Load next video (+{DEFERRED_MS / 1000}s, no gesture)
        </LabButton>
      </ButtonRow>
      <StatusLine status={status} />
      <PlayerStage
        mountRef={stageRef}
        caption={`${VID_A.id} → ${VID_B.id} → ${VID_C.id}`}
      />
      <Metrics
        rows={[
          ['states', sequenceText],
          ['swap in gesture', verdictText(inGesture)],
          [`swap +${DEFERRED_MS}ms`, verdictText(deferred)],
        ]}
      />
    </TestCard>
  );
}

// ------------------------------------------------------ 6: unmute persistence

/**
 * Mounted muted, because that is how the feed starts every slide: mute=1 is
 * what buys the gesture-free autoplay, and sound is restored afterwards. So
 * what is measured here is the restore — including the known iOS trap that an
 * unMute() the browser has not blessed does not merely stay silent, it PAUSES
 * the video. Samples are taken over 2.5s rather than once, because a re-mute or
 * a pause can land a beat after the call returns.
 */
export function UnmutePersistenceCard() {
  const id = 'unmute-persistence';
  const cardRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<LabPlayer | null>(null);
  const watchesRef = useRef(createWatchSet());
  const { add: addTeardown, runAll: runTeardown } = useTeardown();
  const { record, reset, text: sequenceText } = useStateSequence();
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: 'not run yet' });
  const [armed, setArmed] = useState(false);
  const [blessed, setBlessed] = useState(false);
  const [unmuted, setUnmuted] = useState(false);
  const [samples, setSamples] = useState<ReadonlyArray<readonly [string, string]>>([]);

  const sampleOver = useCallback(
    (tag: string, offsets: readonly number[]) => {
      for (const offset of offsets) {
        const timer = setTimeout(() => {
          const info = playerInfo(playerRef.current);
          labLog.push(id, `${tag} +${offset}ms — ${info}`);
          setSamples((previous) => [...previous, [`${tag} +${offset}ms`, info] as const]);
        }, offset);
        addTeardown(() => clearTimeout(timer));
      }
    },
    [addTeardown, id]
  );

  const bless = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    labLog.push(id, 'bless: playVideo() from a button click, still muted');
    const watch = watchesRef.current.add(
      createPlayWatch({
        scope: id,
        label: 'blessed muted play',
        timeoutMs: WATCH_MS,
        getPlayer: () => playerRef.current,
        onVerdict: (result) => {
          setBlessed(result.reached);
          setStatus(
            result.reached
              ? { kind: 'info', text: 'playing muted — now tap unMute()' }
              : { kind: 'fail', text: `blessing failed: ${verdictText(result)}` }
          );
        },
      })
    );
    addTeardown(() => watch.cancel());
    player.playVideo();
  }, [addTeardown, id]);

  const doUnmute = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    labLog.push(id, `unMute() from a button click — before: ${playerInfo(player)}`);
    player.unMute();
    setUnmuted(true);
    setStatus({ kind: 'running', text: 'unMute() called — sampling for 2.5s…' });
    sampleOver('after unMute()', [0, 300, 1000, 2500]);
  }, [id, sampleOver]);

  const swap = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    labLog.push(
      id,
      `loadVideoById('${VID_D.id}') after an unmute — before: ${playerInfo(player)}`
    );
    const watch = watchesRef.current.add(
      createPlayWatch({
        scope: id,
        label: `swap after unmute (${VID_D.id})`,
        timeoutMs: WATCH_MS,
        getPlayer: () => playerRef.current,
        accept: () =>
          acceptSwappedVideo(
            id,
            `swap after unmute (${VID_D.id})`,
            playerRef.current,
            VID_D.id
          ),
        onVerdict: (result) => {
          setStatus(
            result.reached
              ? {
                  kind: 'pass',
                  text: `new video playing (${result.ms}ms) — see whether isMuted survived the swap`,
                }
              : { kind: 'fail', text: `swap did not start: ${verdictText(result)}` }
          );
        },
      })
    );
    addTeardown(() => watch.cancel());
    player.loadVideoById(VID_D.id);
    sampleOver('after swap', [0, 500, 1500, 3000]);
  }, [addTeardown, id, sampleOver]);

  const run = useCallback(() => {
    runTeardown();
    watchesRef.current.cancelAll();
    destroyAllPlayers(id);
    playerRef.current = null;
    reset();
    setArmed(false);
    setBlessed(false);
    setUnmuted(false);
    setSamples([]);

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
      },
    })
      .then((player) => {
        playerRef.current = player;
        setArmed(true);
        setStatus({ kind: 'waiting', text: 'armed — tap “Bless & play (muted)”' });
      })
      .catch((error: unknown) => {
        labLog.push(id, `mount failed: ${String(error)}`);
        setStatus({ kind: 'fail', text: `mount failed: ${String(error)}` });
      });
  }, [id, record, reset, runTeardown]);

  useEffect(() => () => destroyLabPlayer(playerRef.current, id), [id]);

  return (
    <TestCard
      id={id}
      n={6}
      title="Unmute persistence"
      question="Mount muted, bless it, then unMute() and watch isMuted()/getVolume() for 2.5s — an unblessed unmute pauses the video rather than staying silent. Then swap videos and see whether the unmute survives."
      cardRef={cardRef}
    >
      <ButtonRow>
        <LabButton onClick={run} tone="primary">
          Run
        </LabButton>
        <LabButton onClick={bless} disabled={!armed}>
          Bless &amp; play (muted)
        </LabButton>
      </ButtonRow>
      <ButtonRow>
        <LabButton onClick={doUnmute} disabled={!blessed}>
          unMute()
        </LabButton>
        <LabButton onClick={swap} disabled={!unmuted}>
          loadVideoById({VID_D.id})
        </LabButton>
      </ButtonRow>
      <StatusLine status={status} />
      <PlayerStage mountRef={stageRef} caption={`${VID_A.id} → ${VID_D.id}`} />
      <Metrics rows={[['states', sequenceText], ...samples]} />
    </TestCard>
  );
}

// -------------------------------------------------------- 7: dual player bless

/**
 * Does one gesture bless the page, or only one element? The feed keeps the
 * neighbouring slide's player alive, so if activation is per-player then
 * preloading the next video is pointless — it will need its own tap.
 *
 * Both playVideo() calls are made synchronously from a single click handler,
 * which is the strongest form of the question.
 */
export function DualPlayerCard() {
  const id = 'dual-player';
  const cardRef = useRef<HTMLElement | null>(null);
  const stageA = useRef<HTMLDivElement | null>(null);
  const stageB = useRef<HTMLDivElement | null>(null);
  const playerA = useRef<LabPlayer | null>(null);
  const playerB = useRef<LabPlayer | null>(null);
  const watchesRef = useRef(createWatchSet());
  const { add: addTeardown, runAll: runTeardown } = useTeardown();
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: 'not run yet' });
  const [armed, setArmed] = useState(false);
  const [resultA, setResultA] = useState<Verdict | null>(null);
  const [resultB, setResultB] = useState<Verdict | null>(null);

  const playBoth = useCallback(() => {
    const a = playerA.current;
    const b = playerB.current;
    if (!a || !b) return;
    setResultA(null);
    setResultB(null);
    labLog.push(id, 'one click handler: playVideo() on player A then player B');

    // Both probes settle independently, so the conclusion — page-wide or
    // per-player activation — can only be drawn once the second one lands.
    const landed = new Map<string, Verdict>();
    const conclude = (tag: string, verdict: Verdict) => {
      landed.set(tag, verdict);
      if (landed.size < 2) return;
      const winners = [...landed.entries()]
        .filter(([, result]) => result.reached)
        .map(([name]) => name);
      const summary =
        winners.length === 2
          ? 'both players reached PLAYING — one gesture blesses the page, not a single element'
          : winners.length === 1
            ? `only player ${winners[0]} reached PLAYING — activation looks per-player, so a preloaded neighbour will need its own gesture`
            : 'neither player reached PLAYING — the gesture blessed nothing';
      labLog.push(id, `VERDICT dual player: ${summary}`);
      setStatus({ kind: winners.length === 2 ? 'pass' : 'fail', text: summary });
    };

    for (const [tag, player, setResult] of [
      ['A', a, setResultA],
      ['B', b, setResultB],
    ] as const) {
      const watch = watchesRef.current.add(
        createPlayWatch({
          scope: `${id}/${tag}`,
          label: `playVideo() on player ${tag}`,
          timeoutMs: WATCH_MS,
          getPlayer: () => player,
          onVerdict: (verdict) => {
            setResult(verdict);
            conclude(tag, verdict);
          },
        })
      );
      addTeardown(() => watch.cancel());
    }
    // Both synchronous, inside the same handler — no await between them.
    a.playVideo();
    b.playVideo();
    setStatus({ kind: 'running', text: `both playVideo() calls issued; watching ${WATCH_MS}ms…` });
  }, [addTeardown, id]);

  const run = useCallback(() => {
    runTeardown();
    watchesRef.current.cancelAll();
    destroyAllPlayers(id);
    playerA.current = null;
    playerB.current = null;
    setArmed(false);
    setResultA(null);
    setResultB(null);

    const a = stageA.current;
    const b = stageB.current;
    if (!a || !b) return;
    setStatus({ kind: 'running', text: 'mounting two players (autoplay=0, mute=0)…' });

    void Promise.all([
      mountLabPlayer({
        mount: a,
        videoId: VID_A.id,
        scope: id,
        tag: 'A',
        autoplay: false,
        muted: false,
        onState: (code) => watchesRef.current.note(code),
      }),
      mountLabPlayer({
        mount: b,
        videoId: VID_B.id,
        scope: id,
        tag: 'B',
        autoplay: false,
        muted: false,
        onState: (code) => watchesRef.current.note(code),
      }),
    ])
      .then(([one, two]) => {
        playerA.current = one;
        playerB.current = two;
        setArmed(true);
        setStatus({ kind: 'waiting', text: 'both ready — tap “Play both”' });
      })
      .catch((error: unknown) => {
        labLog.push(id, `mount failed: ${String(error)}`);
        setStatus({ kind: 'fail', text: `mount failed: ${String(error)}` });
      });
  }, [id, runTeardown]);

  useEffect(
    () => () => {
      destroyLabPlayer(playerA.current, `${id}/A`);
      destroyLabPlayer(playerB.current, `${id}/B`);
    },
    [id]
  );

  useAutoRun(id, run, cardRef);

  return (
    <TestCard
      id={id}
      n={7}
      title="Dual player blessing"
      question="Two players, one click handler calling playVideo() on both. Is activation page-wide or per-player? Whichever one loses tells us whether preloading the next slide's player is worth anything."
      cardRef={cardRef}
    >
      <ButtonRow>
        <LabButton onClick={run} tone="primary">
          Run
        </LabButton>
        <LabButton onClick={playBoth} disabled={!armed}>
          Play both
        </LabButton>
      </ButtonRow>
      <CleanRunLink id={id} />
      <StatusLine status={status} />
      <div className="flex flex-wrap gap-3">
        <PlayerStage mountRef={stageA} caption={`A · ${VID_A.id}`} />
        <PlayerStage mountRef={stageB} caption={`B · ${VID_B.id}`} />
      </div>
      <Metrics
        rows={[
          ['player A', verdictText(resultA)],
          ['player B', verdictText(resultB)],
        ]}
      />
    </TestCard>
  );
}

// ------------------------------------------- 10: blessing across a PAUSE

/**
 * Does the blessing survive being paused?
 *
 * This card exists for one production assumption and nothing else.
 * lib/playerContext.tsx bless() captures the grant by playing a priming video
 * and PAUSING it the moment 'play' confirms, so the deck does not stream a
 * video nobody asked for during its word cards. Every clip after that relies on
 * a grant that was given to a player which has since been paused — and test 5
 * above measured swap-after-PLAYING, never swap-after-pause.
 *
 * So the sequence here mirrors the provider exactly: bless with a tap, pause on
 * the first 'play', wait outside any gesture, then swap and play a DIFFERENT
 * video unmuted. Unmuted because muted playback needs no grant at all and would
 * pass whatever the answer is.
 *
 * The unattended window is the fragile part of the measurement: one stray touch
 * would bless the swap and turn a failure into a pass. So the gesture count is
 * sampled going in and checked at the verdict, and a run that was touched is
 * reported as contaminated rather than as a result.
 */
export function BlessAcrossPauseCard() {
  const id = 'bless-after-pause';
  const cardRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<LabPlayer | null>(null);
  const watchesRef = useRef(createWatchSet());
  const { add: addTeardown, runAll: runTeardown } = useTeardown();
  const { record, reset, text: sequenceText } = useStateSequence();
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: 'not run yet' });
  const [armed, setArmed] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [blessVerdict, setBlessVerdict] = useState<Verdict | null>(null);
  const [pausedInfo, setPausedInfo] = useState<string>('—');
  const [swapVerdict, setSwapVerdict] = useState<Verdict | null>(null);
  const [contaminated, setContaminated] = useState<string | null>(null);
  /** Gestures seen when the unattended window opened. */
  const gesturesAtPauseRef = useRef(0);
  /** Has the priming play already been paused? Mirrors the provider's flag. */
  const pausedRef = useRef(false);

  /** Step 3: the whole point — a swap with no gesture anywhere near it. */
  const swapOutsideGesture = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    setWaiting(false);
    labLog.push(
      id,
      `swapping to ${VID_B.id} unmuted, ${DEFERRED_MS}ms after the pause and outside any gesture — before: ${playerInfo(player)}`
    );
    const watch = watchesRef.current.add(
      createPlayWatch({
        scope: id,
        label: `swap after a pause (${VID_B.id})`,
        timeoutMs: WATCH_MS,
        getPlayer: () => playerRef.current,
        accept: () =>
          acceptSwappedVideo(id, `swap after a pause (${VID_B.id})`, playerRef.current, VID_B.id),
        onVerdict: (result) => {
          setSwapVerdict(result);
          const touched = pageGestureCount() - gesturesAtPauseRef.current;
          if (touched > 0) {
            const note = `CONTAMINATED: ${touched} gesture(s) landed during the wait — re-run without touching the screen`;
            labLog.push(id, note);
            setContaminated(note);
            setStatus({ kind: 'fail', text: note });
            return;
          }
          setContaminated(null);
          setStatus(
            result.reached
              ? {
                  kind: 'pass',
                  text: `PLAYING ${result.ms}ms after the swap — a pause does NOT drop the blessing, so playerContext's bless() is sound`,
                }
              : {
                  kind: 'fail',
                  text: `${verdictText(result)} — the pause DROPPED the blessing; playerContext's bless() must keep the priming video playing instead`,
                }
          );
        },
      })
    );
    addTeardown(() => watch.cancel());
    player.unMute();
    player.loadVideoById(VID_B.id);
  }, [addTeardown, id]);

  /** Step 2: pause the instant playback is confirmed, exactly as bless() does. */
  const pauseThenWait = useCallback(() => {
    const player = playerRef.current;
    if (!player || pausedRef.current) return;
    pausedRef.current = true;
    player.pauseVideo();
    const info = playerInfo(player);
    setPausedInfo(info);
    labLog.push(id, `paused immediately on 'play', as bless() does — ${info}`);
    gesturesAtPauseRef.current = pageGestureCount();
    labLog.push(
      id,
      `unattended window open: ${DEFERRED_MS}ms with pageGestures=${gesturesAtPauseRef.current}; any touch from here invalidates the run`
    );
    setWaiting(true);
    setStatus({
      kind: 'waiting',
      text: `paused and blessed — waiting ${DEFERRED_MS}ms. DO NOT TOUCH THE SCREEN.`,
    });
    const timer = setTimeout(swapOutsideGesture, DEFERRED_MS);
    addTeardown(() => clearTimeout(timer));
  }, [addTeardown, id, swapOutsideGesture]);

  /** Step 1: the one and only gesture in the whole test. */
  const bless = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    labLog.push(id, `bless: unmuted playVideo() from a button click on ${VID_A.id}`);
    const watch = watchesRef.current.add(
      createPlayWatch({
        scope: id,
        label: 'blessing play (unmuted, in gesture)',
        timeoutMs: WATCH_MS,
        getPlayer: () => playerRef.current,
        onVerdict: (result) => {
          setBlessVerdict(result);
          if (result.reached) return; // pauseThenWait already fired on 'play'
          setStatus({
            kind: 'fail',
            text: `the blessing itself failed (${verdictText(result)}) — nothing after this would mean anything`,
          });
        },
      })
    );
    addTeardown(() => watch.cancel());
    player.unMute();
    player.playVideo();
    setStatus({ kind: 'running', text: 'blessing play issued from the tap…' });
  }, [addTeardown, id]);

  const run = useCallback(() => {
    runTeardown();
    watchesRef.current.cancelAll();
    destroyAllPlayers(id);
    playerRef.current = null;
    reset();
    setArmed(false);
    setWaiting(false);
    setBlessVerdict(null);
    setPausedInfo('—');
    setSwapVerdict(null);
    setContaminated(null);
    pausedRef.current = false;

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
        // The provider pauses on the 'play' EVENT, so this does too — pausing
        // on the promise instead would measure a different sequence.
        if (code === PLAYING && !pausedRef.current) pauseThenWait();
      },
    })
      .then((player) => {
        playerRef.current = player;
        setArmed(true);
        setStatus({ kind: 'waiting', text: 'armed — tap “Bless & play”, then hands off' });
      })
      .catch((error: unknown) => {
        labLog.push(id, `mount failed: ${String(error)}`);
        setStatus({ kind: 'fail', text: `mount failed: ${String(error)}` });
      });
  }, [id, pauseThenWait, record, reset, runTeardown]);

  useEffect(() => () => destroyLabPlayer(playerRef.current, id), [id]);
  useAutoRun(id, run, cardRef);

  return (
    <TestCard
      id={id}
      n={10}
      title="Blessing across a pause"
      question="The one assumption production makes that nothing has measured: bless with a tap, pause the instant playback starts (exactly as playerContext's bless() does), wait 2s with no gesture, then swap to a different video and play it unmuted. If this fails, bless() is wrong."
      cardRef={cardRef}
    >
      <ButtonRow>
        <LabButton onClick={run} tone="primary">
          Run
        </LabButton>
        <LabButton onClick={bless} disabled={!armed}>
          Bless &amp; play
        </LabButton>
      </ButtonRow>
      <CleanRunLink id={id} />
      {waiting ? <Prompt>HANDS OFF — a tap now invalidates the result</Prompt> : null}
      <StatusLine status={status} />
      <PlayerStage mountRef={stageRef} caption={`${VID_A.id} → ${VID_B.id}`} />
      <Metrics
        rows={[
          ['states', sequenceText],
          ['1. blessing play', verdictText(blessVerdict)],
          ['2. after pause', pausedInfo],
          [`3. swap +${DEFERRED_MS}ms`, verdictText(swapVerdict)],
          ['run integrity', contaminated ?? (swapVerdict ? 'clean — no gestures in the window' : '—')],
        ]}
      />
    </TestCard>
  );
}
