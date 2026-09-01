import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import type { Level, SelfLevel } from '@loro/core/types';
import { getCatalog } from '@loro/core/catalog';
import { storage } from '@loro/core/storage';
import { buildCalibrationWords, deriveLevel } from '@loro/core/calibration';
import {
  ACCENT,
  Body,
  BlankMock,
  ChoiceCard,
  MUTED,
  ON_ACCENT,
  PrimaryButton,
  Screen,
  TEXT,
  Title,
} from './chrome';
import { BRAND } from './brand';
import {
  BLANKS,
  CALIBRATION_INTRO,
  FLUENCY_GOAL,
  FREQUENCY,
  GRID,
  HANDOFF,
  HOOK,
  HOW_IT_WORKS,
  MOTIVATION,
  PAYWALL,
  PLAN_BUILD,
  RESULT,
  SELF_LEVEL,
} from './copy';
import { PAYWALL_ENABLED, olog, setFrequency, setMotivation } from './flow';
import { TasteStep } from './TasteStep';
import { tasteAvailable } from './taste';

/**
 * The screens, in order. Each one is a pure component over the flow state; the
 * host (Onboarding.tsx) owns the state, the index and the slide.
 *
 * NO COUNT IS QUOTED HERE ON PURPOSE. Two things already vary it: the 'zero'
 * self-assessment drops three screens, and the paywall is filtered out while
 * its flag is false. Nothing in the app indexes these by number either, so a
 * count in a comment is a fact that only ever goes stale. Read STEPS.
 *
 * WHERE THE WRITES HAPPEN, because this is the part that has to match the web:
 *
 *   screen 3  selfLevel   storage.setSelfLevel        loro.level
 *             ('zero')    storage.setStartLevel('A1') loro.startLevel
 *   screen 5  grid        storage.setStartLevel       loro.startLevel
 *                         storage.setCalibrationKnown loro.calibrationKnown
 *   screen 11 handoff     storage.setOnboarded        loro.onboarded
 *   screen 2  motivation  driver                      loro.mobile.motivation
 *   screen 9  frequency   driver                      loro.mobile.frequency
 *
 * Every one of those five core writes is the web's, at the web's moment —
 * app/welcome/page.tsx:150-162 (self-assessment) and :214-226 (calibration),
 * with :132 for the finish. Nothing is written twice and nothing is invented.
 */

/** What the user has told us so far. Held by the host, patched by the screens. */
export type FlowState = {
  /** Several allowed, so an array. Empty means unanswered. */
  motivation: string[];
  selfLevel: SelfLevel | null;
  /** Surfaces tapped in the grid. The Set is the web's shape and feeds
      deriveLevel directly. */
  known: Set<string>;
  derived: Level | null;
  frequency: string | null;
  /** The fluency slider's months. IN FLOW STATE FOR DISPLAY ONLY — the plan
      screen draws the A→B journey from it. It is still never persisted:
      no storage key holds it and nothing after onboarding reads it. */
  goalMonths: number | null;
};

export const INITIAL_FLOW: FlowState = {
  motivation: [],
  selfLevel: null,
  known: new Set(),
  derived: null,
  frequency: null,
  goalMonths: null,
};

export type StepProps = {
  state: FlowState;
  /** Merges into the flow state SYNCHRONOUSLY, so a screen can patch and
      advance in one handler without `next` reading a stale answer. */
  update: (patch: Partial<FlowState>) => void;
  next: () => void;
  /** Commit and leave — the web's finish(): setOnboarded, then the feed. */
  finish: () => void;
  /**
   * Is this the screen ON STAGE right now?
   *
   * EVERY STEP IS MOUNTED AT ONCE — they sit side by side in the host's row
   * (Onboarding.tsx), which is what makes a transition one transform instead
   * of a mount. That is free for a static screen and wrong for a moving one:
   * an intro animation would play to an empty room and be over before the user
   * arrived, and a timed screen would run its clock from five screens away.
   *
   * The taste reel consumes this: it arms the real feed on arrival rather
   * than on mount, because PlayerDriver starts streaming as soon as it is
   * mounted and does not consult `active` (see TasteStep). Anything else
   * timed or animated added later must key off this too.
   */
  isCurrent: boolean;
  /**
   * IS THIS THE LAST SCREEN IN PLAY, so its button ends the flow?
   *
   * Computed by the host against the VISIBLE list, which is the only place
   * that knows. Two things move the finish line — the taste step removes
   * itself when the catalog has not landed, and the paywall step appears when
   * PAYWALL_ENABLED flips — and before this existed the last screen owned
   * `finish()` by hard-coding it. That is how a step gets stranded on a dead
   * button: `next()` at the end of the list is a no-op, so a screen that
   * assumed something came after it would simply stop responding.
   */
  isLast: boolean;
};

export type StepId =
  | 'hook'
  | 'motivation'
  | 'selfLevel'
  | 'calibrationIntro'
  | 'grid'
  | 'result'
  | 'howItWorks'
  | 'blanks'
  | 'frequency'
  | 'fluencyGoal'
  | 'planBuild'
  | 'handoff'
  | 'taste'
  | 'paywall';

/**
 * The grid's fifteen words. Built once: buildCalibrationWords is deterministic
 * by design (no Math.random, so the web can render it server-side —
 * calibration.ts:33-37), so there is nothing to memoize against and the same
 * array can back both the chips and the deriveLevel call. Passing the SAME list
 * to deriveLevel is what the web does (page.tsx:215) and it matters: the
 * function's default argument would rebuild it, and a band ratio computed
 * against a different list is a different answer.
 */
const CALIBRATION_WORDS = buildCalibrationWords();

// ------------------------------------------------------------------ 1. hook

function HookStep({ next }: StepProps) {
  return (
    <Screen footer={<PrimaryButton label={HOOK.cta} onPress={next} />}>
      {/* The full lockup, wordmark and parrot together, because this is the
          one screen where the app introduces itself by name. Every later
          appearance is the parrot alone. */}
      <Image
        source={BRAND.logo}
        style={styles.logo}
        resizeMode="contain"
        accessibilityRole="image"
        accessibilityLabel="Loro"
      />
      <Title>{HOOK.title}</Title>
      <Body>{HOOK.body}</Body>
    </Screen>
  );
}

// ------------------------------------------------------------ 2. motivation

/**
 * MULTI-SELECT, and that changes the screen's shape as well as its state:
 * a single-select card can advance on tap, several cannot, so this one needs
 * an explicit Continue. The commit happens there rather than per tap, so the
 * stored array is written once and mid-selection churn never reaches MMKV.
 *
 * An empty selection is allowed through and writes nothing. Blocking the flow
 * over a key nothing reads yet would be the wrong trade, and an empty array on
 * disk is worse than no answer: it looks like an answer.
 */
function MotivationStep({ state, update, next }: StepProps) {
  const toggle = (id: string) => {
    const chosen = state.motivation.includes(id)
      ? state.motivation.filter((value) => value !== id)
      : [...state.motivation, id];
    update({ motivation: chosen });
  };

  const commit = () => {
    if (state.motivation.length > 0) setMotivation(state.motivation);
    next();
  };

  return (
    <Screen footer={<PrimaryButton label={MOTIVATION.cta} onPress={commit} />}>
      <Title>{MOTIVATION.title}</Title>
      <Body>{MOTIVATION.body}</Body>
      <View style={styles.choices}>
        {MOTIVATION.options.map((option) => (
          <ChoiceCard
            key={option.id}
            multi
            label={option.label}
            body={option.body}
            selected={state.motivation.includes(option.id)}
            onPress={() => toggle(option.id)}
          />
        ))}
      </View>
    </Screen>
  );
}

// ----------------------------------------------------------- 3. self-assess

function SelfLevelStep({ state, update, next }: StepProps) {
  /** The web's pickSelfLevel, app/welcome/page.tsx:150-162. */
  const pick = (level: SelfLevel) => {
    storage.setSelfLevel(level);
    if (level === 'zero') {
      // The deck IS their calibration, so the feed is seeded at the easy end
      // and the grid is skipped — the web's exact pair of lines (:154-156).
      storage.setStartLevel('A1');
      olog(`selfLevel=zero -> startLevel=A1, grid skipped`);
      /**
       * ===================================================================
       * SEAM: THE STARTER DECK GOES HERE.
       * ===================================================================
       * On the web this branch routes to /onboarding/starter, a separate
       * flow that teaches ~15 first words and grants each one into the SRS
       * through storage.saveWordAtBox(word, box, stagger, 'deck') — box 3 if
       * the user says they knew it, box 1 if not
       * (app/onboarding/starter/page.tsx:225-245). On completion it writes
       * setStarterDone() and setOnboarded() (:157-163).
       *
       * NONE OF THAT IS FAKED HERE. There is no deck on mobile yet, so this
       * path currently just skips the grid: a 'zero' user starts at A1 with
       * an empty word list, which is honest. Granting words without the deck
       * that teaches them would put entries in /vocab the user has never
       * seen, and mis-filing them as source 'user' would additionally leak
       * them past the free-tier ceiling and the account prompt, both of
       * which exclude 'deck' grants deliberately (storage.ts:1196-1204).
       *
       * When the deck lands: render it as its own step between here and
       * screen 7, gated on selfLevel === 'zero', and call setStarterDone()
       * on the way out. loro.starterDone is untouched until then.
       */
    }
    update({ selfLevel: level });
    next();
  };

  return (
    <Screen>
      <Title>{SELF_LEVEL.title}</Title>
      <Body>{SELF_LEVEL.body}</Body>
      <View style={styles.choices} accessibilityRole="radiogroup">
        {SELF_LEVEL.options.map((option) => (
          <ChoiceCard
            key={option.id}
            label={option.label}
            body={option.body}
            selected={state.selfLevel === option.id}
            onPress={() => pick(option.id)}
          />
        ))}
      </View>
    </Screen>
  );
}

// ------------------------------------------------------ 4. calibration intro

function CalibrationIntroStep({ next }: StepProps) {
  return (
    <Screen footer={<PrimaryButton label={CALIBRATION_INTRO.cta} onPress={next} />}>
      <Title>{CALIBRATION_INTRO.title}</Title>
      <Body>{CALIBRATION_INTRO.body}</Body>
    </Screen>
  );
}

// ------------------------------------------------------------------ 5. grid

function GridStep({ state, update, next }: StepProps) {
  const toggle = (text: string) => {
    // The web's toggleWord, page.tsx:205-212 — a new Set each time so the
    // identity changes and the chips re-render.
    const nextKnown = new Set(state.known);
    if (nextKnown.has(text)) nextKnown.delete(text);
    else nextKnown.add(text);
    update({ known: nextKnown });
  };

  /**
   * The web's finishCalibration, page.tsx:214-226, minus the guided video it
   * also prepares (pickGuidedVideo / pickTargetWord) — that walkthrough is a
   * later checkpoint, and calling either here would pick a video nothing shows.
   * The two storage writes and their order are unchanged.
   */
  const commit = () => {
    const derived = deriveLevel(state.known, CALIBRATION_WORDS);
    storage.setStartLevel(derived);
    storage.setCalibrationKnown([...state.known]);
    olog(
      `calibration known=${state.known.size}/${CALIBRATION_WORDS.length} ` +
        `[${[...state.known].join(', ')}] -> startLevel=${derived}`
    );
    update({ derived });
    next();
  };

  return (
    <Screen
      footer={
        <PrimaryButton
          label={state.known.size > 0 ? GRID.ctaSome : GRID.ctaNone}
          onPress={commit}
        />
      }
    >
      <Title>{GRID.title}</Title>
      <Body>{GRID.body}</Body>
      <View style={styles.grid}>
        {CALIBRATION_WORDS.map((word) => (
          <WordChip
            key={word.text}
            text={word.text}
            on={state.known.has(word.text)}
            onToggle={() => toggle(word.text)}
          />
        ))}
      </View>
      {/*
        NO "I'M ACTUALLY STARTING FROM ZERO" ESCAPE HATCH, and that is a
        deliberate omission rather than a gap. On the web that button
        (page.tsx:174-202) is not a navigation shortcut — its whole body is
        starter-deck work: every tapped word is granted at box 3 with source
        'deck' via saveWordAtBox before it routes. Without the deck the button
        would either drop those grants silently or fake them. The same
        destination is one screen back, so nothing is unreachable. It returns
        with the deck; see the seam in SelfLevelStep.
      */}
    </Screen>
  );
}

/**
 * One tappable word of the calibration grid. Its own component because
 * selection is ANIMATED per chip, and fifteen chips inside GridStep's render
 * would mean fifteen hooks in a loop.
 *
 * THE GEOMETRY NEVER CHANGES, and holding that line is the reason this
 * component exists (2026-09-01, Radek on device: tapping "imprescindible"
 * made the grid "glitch into another position"). The old selected style
 * bumped the font weight 600 -> 700; a bolder run of a long word is a few
 * points wider, the chip is content-sized, and the flex-wrap grid reflowed
 * every chip after it — the tap looked like it shuffled the deck. Selection
 * may only touch PAINT (background, text colour) and TRANSFORM (the pop),
 * because neither reflows layout. Do not add borders, weight changes, icons
 * or padding to the selected state; any of them brings the jank back.
 *
 * The pop is transform-only for the same reason: the chip briefly overlaps
 * its neighbours instead of pushing them. Reduce Motion collapses both
 * animations to an instant colour change.
 */
function WordChip({
  text,
  on,
  onToggle,
}: {
  text: string;
  on: boolean;
  onToggle: () => void;
}) {
  const reduceMotion = useReducedMotion();
  /** 0 unselected -> 1 selected; one clock drives both colours so they can
      never crossfade out of step. */
  const sel = useSharedValue(on ? 1 : 0);
  const pop = useSharedValue(1);

  useEffect(() => {
    sel.value = withTiming(on ? 1 : 0, { duration: reduceMotion ? 0 : 160 });
    if (on && !reduceMotion) {
      pop.value = withSequence(
        withTiming(1.045, { duration: 110, easing: Easing.out(Easing.ease) }),
        withTiming(1, { duration: 150, easing: Easing.inOut(Easing.ease) })
      );
    }
  }, [on, reduceMotion, sel, pop]);

  const box = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(sel.value, [0, 1], ['#141a17', ACCENT]),
    transform: [{ scale: pop.value }],
  }));
  const label = useAnimatedStyle(() => ({
    color: interpolateColor(sel.value, [0, 1], [TEXT, ON_ACCENT]),
  }));

  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      style={({ pressed }) => pressed && styles.chipPressed}
    >
      <Animated.View style={[styles.chip, box]}>
        <Animated.Text style={[styles.chipText, label]}>{text}</Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

// ---------------------------------------------------------------- 6. result

function ResultStep({ state, next }: StepProps) {
  return (
    <Screen footer={<PrimaryButton label={RESULT.cta} onPress={next} />}>
      <View style={styles.resultBlock}>
        {/* The one unambiguously good moment in the flow: they answered, and
            here is the answer. The parrot shows up to mark it. */}
        <Image
          source={BRAND.parrot}
          style={styles.parrot}
          resizeMode="contain"
          accessibilityRole="image"
          accessibilityLabel="Loro the parrot"
        />
        <Text style={styles.kicker}>{RESULT.kicker}</Text>
        {/* Never reached with a null level: this step is skipped on the only
            path that does not derive one. Rendered defensively anyway — a
            crash here would be at the worst possible moment. */}
        <Text style={styles.level}>{state.derived ?? 'A1'}</Text>
        <Body>{RESULT.body}</Body>
      </View>
    </Screen>
  );
}

// --------------------------------------------------------- 7. how it works

/**
 * One row fading in after another, keyed off `active`, NOT off mount — every
 * step is mounted at once (see StepProps.isCurrent), so a mount-time entrance
 * would play to an empty room five screens before anyone arrived. Once shown,
 * a row stays shown: `active` going false again (the back arrow) must not
 * make content vanish.
 */
function Reveal({
  active,
  delay,
  children,
}: {
  active: boolean;
  delay: number;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const shown = useSharedValue(0);
  useEffect(() => {
    if (!active) return;
    shown.value = reduced
      ? 1
      : withDelay(delay, withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }));
  }, [active, delay, reduced, shown]);
  const style = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: (1 - shown.value) * 14 }],
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

function HowItWorksStep({ next, isCurrent }: StepProps) {
  return (
    <Screen footer={<PrimaryButton label={HOW_IT_WORKS.cta} onPress={next} />}>
      <Title>{HOW_IT_WORKS.title}</Title>
      <View style={styles.steps}>
        {/* Staggered so the three read as a sequence — which is what they
            are — rather than a wall of text competing with the title. The
            button is live from the start: the reveal is rhythm, not a gate.

            A timeline, not numbered badges: a dot per step and a rail
            running to the next, so the sequence is drawn instead of
            captioned. The rail lives inside its row and reaches down through
            the text's bottom padding, which is why the container has no gap
            — a gap would cut the line at every joint. */}
        {HOW_IT_WORKS.steps.map((line, i) => (
          <Reveal key={line} active={isCurrent} delay={250 + i * 450}>
            <View style={styles.stepRow}>
              <View style={styles.stepSpine}>
                <View style={styles.stepDot} />
                {i < HOW_IT_WORKS.steps.length - 1 && (
                  <View style={styles.stepRail} />
                )}
              </View>
              <Text style={styles.stepText}>{line}</Text>
            </View>
          </Reveal>
        ))}
      </View>
    </Screen>
  );
}

// -------------------------------------------------------------- 8. blanks

function BlanksStep({ next }: StepProps) {
  return (
    <Screen footer={<PrimaryButton label={BLANKS.cta} onPress={next} />}>
      <Title>{BLANKS.title}</Title>
      <Body>{BLANKS.body}</Body>
      {/* The mock sentence, laid out like the real subtitle line so the shape
          is recognised when it appears mid-video. */}
      <View style={styles.mockLine}>
        {BLANKS.mockSentence.map((token, i) =>
          token === '__BLANK__' ? (
            <BlankMock key={i} gloss={BLANKS.mockGloss} />
          ) : (
            <Text key={i} style={styles.mockWord}>
              {token}
            </Text>
          )
        )}
      </View>
    </Screen>
  );
}

// ------------------------------------------------------------ 9. frequency

function FrequencyStep({ state, update, next }: StepProps) {
  return (
    <Screen>
      <Title>{FREQUENCY.title}</Title>
      <Body>{FREQUENCY.body}</Body>
      <View style={styles.choices} accessibilityRole="radiogroup">
        {FREQUENCY.options.map((option) => (
          <ChoiceCard
            key={option.id}
            label={option.label}
            body={option.body}
            selected={state.frequency === option.id}
            onPress={() => {
              setFrequency(option.id);
              update({ frequency: option.id });
              next();
            }}
          />
        ))}
      </View>
    </Screen>
  );
}

// ------------------------------------------------------- 10. fluency goal

/** The pickable range, in months. Display only: nothing here is stored. */
const MIN_MONTHS = 3;
const MAX_MONTHS = 24;
const DEFAULT_MONTHS = 6;
const KNOB = 30;

/** Month + year the target lands on, computed at render from today. */
function targetLabel(months: number): string {
  const now = new Date();
  const absolute = now.getMonth() + months;
  return `${FLUENCY_GOAL.months[absolute % 12]} ${now.getFullYear() + Math.floor(absolute / 12)}`;
}

/**
 * A slider built from a pan gesture and two animated styles.
 *
 * NO NEW MODULE, AND NO SLIDER LIBRARY. react-native-gesture-handler is
 * already a dependency and already wraps the app (GestureHandlerRootView in
 * App.tsx), and Reanimated is what the karaoke loop runs on. Between them a
 * slider is about twenty lines, where @react-native-community/slider would be
 * a native module and therefore a rebuild.
 *
 * THE WHOLE MAPPING IS A WORKLET. Pan gives `x` already relative to the track,
 * so the drag never crosses to JS: clamp, snap to a whole month, write the
 * shared value, and let the knob and the fill read it on the UI thread.
 * `minDistance(0)` is what also makes a plain tap position the knob, so it is
 * one gesture rather than a Pan racing a Tap.
 *
 * The only JS hop is the label, and useAnimatedReaction fires it only when the
 * SNAPPED month changes — roughly twenty times across the full track instead
 * of once per frame.
 *
 * accessibilityRole="adjustable" is not decoration: a raw pan gesture is
 * invisible to a screen reader, so without the increment/decrement actions
 * this control would not exist for VoiceOver users.
 */
function FluencyGoalStep({ update, next }: StepProps) {
  const [months, setMonths] = useState(DEFAULT_MONTHS);
  const [trackWidth, setTrackWidth] = useState(0);

  const width = useSharedValue(0);
  const progress = useSharedValue(
    (DEFAULT_MONTHS - MIN_MONTHS) / (MAX_MONTHS - MIN_MONTHS)
  );

  const snap = (value: number) => {
    'worklet';
    const clamped = Math.min(1, Math.max(0, value));
    const step = Math.round(MIN_MONTHS + clamped * (MAX_MONTHS - MIN_MONTHS));
    return (step - MIN_MONTHS) / (MAX_MONTHS - MIN_MONTHS);
  };

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((event) => {
      'worklet';
      if (width.value > 0) progress.value = snap(event.x / width.value);
    })
    .onUpdate((event) => {
      'worklet';
      if (width.value > 0) progress.value = snap(event.x / width.value);
    });

  useAnimatedReaction(
    () => Math.round(MIN_MONTHS + progress.value * (MAX_MONTHS - MIN_MONTHS)),
    (value, previous) => {
      if (value !== previous) runOnJS(setMonths)(value);
    }
  );

  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: progress.value }],
  }));
  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * width.value }],
  }));

  /** Keyboard and VoiceOver adjustment, in whole months. */
  const nudge = (delta: number) => {
    const target = Math.min(MAX_MONTHS, Math.max(MIN_MONTHS, months + delta));
    progress.value = (target - MIN_MONTHS) / (MAX_MONTHS - MIN_MONTHS);
    setMonths(target);
  };

  return (
    <Screen
      footer={
        <PrimaryButton
          label={FLUENCY_GOAL.cta}
          // Patched on leave, not per drag: the flow state is the answer, and
          // the answer is whatever the knob rests on when they move on. The
          // plan screen draws its point B from this; it is still written to
          // no storage key — see FlowState.goalMonths.
          onPress={() => {
            update({ goalMonths: months });
            next();
          }}
        />
      }
    >
      <Title>{FLUENCY_GOAL.title}</Title>
      <Body>{FLUENCY_GOAL.body}</Body>

      <View style={styles.goalValue}>
        <Text style={styles.goalNumber}>{months}</Text>
        <Text style={styles.goalUnit}>
          {months === 1 ? FLUENCY_GOAL.unitOne : FLUENCY_GOAL.unitMany}
        </Text>
      </View>

      <GestureDetector gesture={pan}>
        <View
          style={styles.sliderHit}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={FLUENCY_GOAL.title}
          accessibilityValue={{ min: MIN_MONTHS, max: MAX_MONTHS, now: months }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'increment') nudge(1);
            if (event.nativeEvent.actionName === 'decrement') nudge(-1);
          }}
          onLayout={(event) => {
            const measured = event.nativeEvent.layout.width;
            width.value = measured;
            setTrackWidth(measured);
          }}
        >
          <View style={styles.track}>
            <Animated.View style={[styles.trackFill, fillStyle]} />
          </View>
          {/* Rendered only once the track has been measured: at width 0 the
              knob would sit at the far left for a frame regardless of the
              starting month. */}
          {trackWidth > 0 && (
            <Animated.View style={[styles.knob, knobStyle]} pointerEvents="none" />
          )}
        </View>
      </GestureDetector>

      {/* DERIVED FOR DISPLAY, NEVER SAVED. Recomputed from today's date on
          every render; no key holds it. The months (not this date) travel to
          the plan screen via FlowState, which re-derives its own label. */}
      <Text style={styles.goalDerived}>
        {FLUENCY_GOAL.derivedPrefix}{' '}
        <Text style={styles.goalDerivedStrong}>{targetLabel(months)}</Text>
      </Text>
    </Screen>
  );
}

// ------------------------------------------------------------ 11. plan build

/** How long the bar takes. The lines land inside this window, and the
    button unlocks just after it — long enough to read them, short enough
    that nobody reaches for the button while it is still dimmed. */
const PLAN_BUILD_MS = 2600;

/**
 * Minutes per week each frequency answer amounts to, FOR THE SUM LINE ONLY.
 * Each figure is the option's own copy turned into arithmetic — change the
 * copy in FREQUENCY.options and these must move with it:
 *
 *   light    "A few times a week · About 5 minutes"  → 3 × 5
 *   daily    "Every day · About 10 minutes"          → 7 × 10
 *   serious  "As much as I can · 20 minutes or more" → 7 × 20, the FLOOR —
 *            an open-ended promise is summed at its minimum, never padded.
 */
const WEEKLY_MINUTES: Record<string, number> = {
  light: 15,
  daily: 70,
  serious: 140,
};

/** "about N hours": months × weeks × their weekly minutes, rounded to a
    figure that does not pretend precision the inputs never had. */
function planHours(weeklyMinutes: number, months: number): number {
  const weeks = (months * 365.25) / 12 / 7;
  const hours = (weeks * weeklyMinutes) / 60;
  return hours >= 10 ? Math.round(hours / 5) * 5 : Math.round(hours);
}

/**
 * Verdict tiers for the sum line, cut against the REAL spread of the inputs
 * (light 3–25h, daily 15–120h, serious 30–245h across the 3–24 month
 * slider): under 25h only the lightest plans land, so the verdict nudges for
 * more; 100h and up is only reachable by leaning in, so the verdict can
 * afford awe. The lines themselves live in PLAN_BUILD and are coaching on
 * commitment, never outcome promises — see the note there.
 */
const PLAN_VERDICT_LOW_H = 25;
const PLAN_VERDICT_HIGH_H = 100;

function planVerdict(hours: number): string {
  if (hours < PLAN_VERDICT_LOW_H) return PLAN_BUILD.verdictLow;
  if (hours >= PLAN_VERDICT_HIGH_H) return PLAN_BUILD.verdictHigh;
  return PLAN_BUILD.verdictMid;
}

/**
 * Geometry of the rising line. The journey is drawn as a climb — point B
 * sits PLAN_RISE higher than point A, because the level going UP is the
 * point of the picture — and the path between them is a polyline of small
 * rotated track segments, not one straight bar. Layout needs the seat's real
 * width (every angle depends on it), so the path renders only after onLayout
 * reports one; RN rotates around the centre, which is why the maths below
 * places each segment's midpoint first and tilts it second.
 */
const PLAN_RISE = 36;
/** Badge midline: paddingVertical 6 × 2 + one 18pt line of 14pt/800 ≈ 30. */
const PLAN_BADGE_MID = 15;

/**
 * The climb's silhouette. x is the fraction of the run, y the fraction of
 * the CLIMB reached — and it dips on purpose, because that is what the user
 * asked the picture to say: progress that wobbles and still ends up at B.
 * The shape is drawing, not data — it is the same fixed squiggle for
 * everyone, asserts nothing about how learning actually paces, and must
 * never grow axes, ticks or labels that would claim otherwise.
 */
const PLAN_WAYPOINTS = [
  { x: 0, y: 0 },
  { x: 0.24, y: 0.42 },
  { x: 0.42, y: 0.26 },
  { x: 0.62, y: 0.74 },
  { x: 0.76, y: 0.6 },
  { x: 1, y: 1 },
] as const;

/**
 * One leg of the path. Its own component because each leg owns an animated
 * style (hooks cannot live in a loop), filling only across its span of the
 * shared 0→1 progress — so the fill runs the polyline end to end, leg by
 * leg, instead of all legs growing at once.
 */
function PlanSegment({
  progress,
  from,
  to,
  left,
  top,
  width,
  angle,
}: {
  progress: SharedValue<number>;
  from: number;
  to: number;
  left: number;
  top: number;
  width: number;
  angle: number;
}) {
  const fill = useAnimatedStyle(() => ({
    width: `${interpolate(progress.value, [from, to], [0, 100], Extrapolation.CLAMP)}%`,
  }));
  return (
    <View
      style={[
        styles.planBarTilt,
        styles.planBar,
        { left, top, transform: [{ rotate: `${angle}rad` }], width },
      ]}
    >
      <Animated.View style={[styles.planBarFill, fill]} />
    </View>
  );
}

/**
 * The plan assembling on screen — and every element of it is TRUE, which is
 * the condition this slot exists under (see the history in copy.ts: the fake
 * loader with invented testimonials that once followed this screen was
 * deleted, not disabled). Point A of the journey is the level the grid
 * derived — or the A1 the zero path writes — point B is the goal month the
 * slider just set, the pace line is the frequency card tapped two screens
 * ago, and the recall line is shipped behaviour. The bar paces the reveal of
 * real answers; it does not simulate computation.
 *
 * Keyed off isCurrent, not mount: every step is mounted at once, so a
 * mount-time clock would have finished five screens before anyone arrived.
 * It runs ONCE — coming back through the back arrow shows the finished
 * state, because watching the same loader twice is where trust goes to die.
 */
function PlanBuildStep({ state, next, isCurrent }: StepProps) {
  const reduced = useReducedMotion();
  const started = useRef(false);
  const [done, setDone] = useState(false);
  /** The seat's measured width — the tilt angle depends on it. */
  const [run, setRun] = useState(0);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!isCurrent || started.current) return;
    started.current = true;
    if (reduced) {
      progress.value = 1;
      setDone(true);
      return;
    }
    progress.value = withTiming(1, {
      duration: PLAN_BUILD_MS,
      easing: Easing.inOut(Easing.cubic),
    });
    const timer = setTimeout(() => setDone(true), PLAN_BUILD_MS + 150);
    return () => clearTimeout(timer);
  }, [isCurrent, reduced, progress]);

  const pace = FREQUENCY.options.find((option) => option.id === state.frequency);
  // Defensive 'A1' matches the zero path's real write (setStartLevel('A1')),
  // so the fallback is still a true statement, not a guess.
  const level = state.derived ?? 'A1';
  // Unreachable null: the goal screen patches this on the only way forward.
  // The slider's untouched default is the honest stand-in if it ever is.
  const goalMonths = state.goalMonths ?? DEFAULT_MONTHS;
  const goalDate = targetLabel(goalMonths);
  const lines = [
    PLAN_BUILD.clips,
    pace
      ? `${pace.label} · ${pace.body.replace(/\.$/, '')}`
      : PLAN_BUILD.paceFallback,
    PLAN_BUILD.recall,
  ];
  // The sum line needs a pace to multiply; without one there is no honest
  // number, so the hero simply does not render rather than inventing one.
  const hours = pace ? planHours(WEEKLY_MINUTES[pace.id] ?? 0, goalMonths) : 0;

  return (
    <Screen
      footer={
        <PrimaryButton label={PLAN_BUILD.cta} onPress={next} disabled={!done} />
      }
    >
      <Title>{PLAN_BUILD.title}</Title>

      {/* THE JOURNEY IS THE PROGRESS BAR, AND IT CLIMBS. Point A is the
          level the grid just derived, sitting low; point B is the user's own
          goal from the slider one screen back, sitting PLAN_RISE higher; and
          the bar filling between them is the same loader as before — now it
          visibly rises from where they are toward where they said they want
          to be. Both ends are true inputs; the slope is drawing, not data,
          and the bar is pacing, not a measured forecast. */}
      <View
        style={styles.planJourney}
        accessible
        accessibilityLabel={`Your plan: from ${level} today to fluent by ${goalDate}`}
      >
        <View style={[styles.planNode, { marginTop: PLAN_RISE }]}>
          <View style={styles.planNodeBadge}>
            <Text style={styles.planNodeBadgeText}>{level}</Text>
          </View>
          <Text style={styles.planNodeLabel}>{PLAN_BUILD.todayLabel}</Text>
        </View>

        <View
          style={styles.planBarSeat}
          onLayout={(event) => setRun(event.nativeEvent.layout.width)}
        >
          {run > 0 &&
            (() => {
              // Waypoints in seat coordinates: y = 0 of the climb is A's
              // badge midline, y = 1 is B's. Fill spans are proportional to
              // each leg's LENGTH, so the travel reads at one speed instead
              // of sprinting the short legs.
              const aMid = PLAN_RISE + PLAN_BADGE_MID;
              const pts = PLAN_WAYPOINTS.map((p) => ({
                x: p.x * run,
                y: aMid - p.y * PLAN_RISE,
              }));
              const legs = pts.slice(1).map((p2, i) => {
                const p1 = pts[i];
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                return {
                  length: Math.hypot(dx, dy),
                  angle: Math.atan2(dy, dx),
                  midX: (p1.x + p2.x) / 2,
                  midY: (p1.y + p2.y) / 2,
                };
              });
              const total = legs.reduce((sum, leg) => sum + leg.length, 0);
              let travelled = 0;
              return legs.map((leg, i) => {
                const from = travelled / total;
                travelled += leg.length;
                // +4 overlaps the joints by ~2pt each side; with rounded
                // caps that reads as one bending line, not five bars.
                const drawn = leg.length + 4;
                return (
                  <PlanSegment
                    key={i}
                    progress={progress}
                    from={from}
                    to={travelled / total}
                    left={leg.midX - drawn / 2}
                    top={leg.midY - 3}
                    width={drawn}
                    angle={leg.angle}
                  />
                );
              });
            })()}
        </View>

        <View style={styles.planNode}>
          <View style={[styles.planNodeBadge, styles.planNodeBadgeGoal]}>
            <Text style={styles.planNodeBadgeGoalText}>
              {PLAN_BUILD.goalBadge}
            </Text>
          </View>
          <Text style={styles.planNodeLabel}>{goalDate}</Text>
        </View>
      </View>

      <View style={styles.planLines}>
        {lines.map((line, i) => (
          <Reveal
            key={line}
            active={isCurrent}
            // Spread across the bar's run, with the last landing before it
            // completes — a line arriving after "100%" would read as an
            // afterthought.
            delay={300 + i * ((PLAN_BUILD_MS - 900) / (lines.length - 1))}
          >
            <View style={styles.planRow}>
              <View style={styles.planTick}>
                <Text style={styles.planTickMark}>✓</Text>
              </View>
              <Text style={styles.planText}>{line}</Text>
            </View>
          </Reveal>
        ))}
      </View>

      {/* THE SUM, LAST — the payoff the lines build to, landing just before
          the bar completes. Their pace times their window, as hours of real
          Spanish: the one number this screen may show, because it is the
          user's own two answers multiplied and nothing else (see
          WEEKLY_MINUTES). "About" and the rounding in planHours keep it from
          pretending precision. */}
      {pace && hours > 0 && (
        <Reveal active={isCurrent} delay={PLAN_BUILD_MS - 400}>
          <View style={styles.planTotal}>
            <Text style={styles.planTotalLead}>{PLAN_BUILD.totalLead}</Text>
            <Text style={styles.planTotalValue}>
              ≈ {hours}{' '}
              <Text style={styles.planTotalUnit}>{PLAN_BUILD.totalUnit}</Text>
            </Text>
            <Text style={styles.planTotalBody}>
              {PLAN_BUILD.totalBodyPrefix}
              {goalDate}
            </Text>
            <Text style={styles.planVerdict}>{planVerdict(hours)}</Text>
          </View>
        </Reveal>
      )}
    </Screen>
  );
}

// -------------------------------------------------------------- 12. paywall

/**
 * The dark seam. Unreachable while PAYWALL_ENABLED is false — the step is
 * filtered out of the flow, so this renders no frame to slide through rather
 * than rendering an empty one.
 */
function PaywallStep({ next }: StepProps) {
  return (
    <Screen footer={<PrimaryButton label={PAYWALL.cta} onPress={next} />}>
      <Title>{PAYWALL.title}</Title>
      <Body>{PAYWALL.body}</Body>
    </Screen>
  );
}

// ------------------------------------------------------------- 13. handoff

function HandoffStep({ next, finish, isLast }: StepProps) {
  /**
   * THIS IS NO LONGER ALWAYS THE LAST SLIDE.
   *
   * The taste reel sits after it when the catalog has landed, and this screen's
   * copy turned out to be its lead-in almost word for word: "Swipe it like
   * anything else, and tap a word the moment it stops making sense" is the
   * instruction for the three clips that now follow. When the reel is absent
   * (no catalog yet) and the in-flow paywall is dark, this IS the last slide
   * again and owns the exit, which is what isLast is for.
   */
  const leave = isLast ? finish : next;
  return (
    <Screen footer={<PrimaryButton label={HANDOFF.cta} onPress={leave} />}>
      {/* Waving, on the screen that hands over to the feed. It is the last
          time the mascot appears, so it may as well be saying something. */}
      <Image
        source={BRAND.parrotWaving}
        style={styles.parrotWaving}
        resizeMode="contain"
        accessibilityRole="image"
        accessibilityLabel="Loro the parrot, waving"
      />
      <Title>{HANDOFF.title}</Title>
      <Body>{HANDOFF.body}</Body>
    </Screen>
  );
}

// ---------------------------------------------------------------- the list

export type StepDef = {
  id: StepId;
  Component: (props: StepProps) => ReactElement;
  /** Filtered out of the flow when this returns true. Evaluated against the
      LIVE state, so answering screen 3 changes what screen 4 is. */
  skip?: (state: FlowState) => boolean;
  /**
   * HIDE THE HOST'S CHROME while this step is on stage: no progress bar, no
   * back arrow, no Skip.
   *
   * One step sets it, and for a geometry reason rather than a styling one. The
   * taste reel mounts the real FeedScreen, whose player box is published in
   * WINDOW space (PlayerHost's WebView is positioned against the app root)
   * while the slide measures it against itself. Those agree only when the step
   * starts at the top of the window, so chrome above it would slide the
   * WebView off the poster and tap surface it is meant to cover. See TasteStep.
   */
  fullBleed?: boolean;
};

/** A 'zero' self-assessment has no grid to fill: the deck calibrates instead
    (and until it lands, nothing does — see the seam in SelfLevelStep). */
const zeroPath = (state: FlowState) => state.selfLevel === 'zero';

/**
 * THE TASTE REEL IS BENCHED (2026-09-01, owner's call) — this update ships
 * onboarding WITHOUT it, ending at handoff exactly as the live App Store
 * build does.
 *
 * Why, so the next reader does not re-argue it from scratch: three days of
 * device runs kept finding new ways for a first-timer to fall off the
 * scripted path (missed taps, dismissed sheets, stale-device blanks), and
 * each fix raised the machinery's complexity another notch. The last round
 * closed every known hole — the hold clamps, the missed tap falls back to a
 * blue blank, every path ends with a blank filled — but the owner chose to
 * ship the update without the step rather than bet the wall on it.
 *
 * The replacement idea on the table, a screen recording of the reel inside a
 * phone mockup, is BLOCKED on rights: the clips are other creators' YouTube
 * videos, playable only inside YouTube's embedded player, and bundling a
 * recording of them redistributes their content — the one thing the embed
 * architecture exists to never do. A recorded demo needs footage Loro
 * actually holds rights to.
 *
 * Everything stays: TasteStep, taste.ts, the walkthrough seams in the feed,
 * and the guard tests still run so the script's numbers stay true to the
 * catalog. Flipping this back to false is the entire un-bench.
 */
const TASTE_BENCHED = true;

export const STEPS: StepDef[] = [
  { id: 'hook', Component: HookStep },
  { id: 'motivation', Component: MotivationStep },
  { id: 'selfLevel', Component: SelfLevelStep },
  { id: 'calibrationIntro', Component: CalibrationIntroStep, skip: zeroPath },
  { id: 'grid', Component: GridStep, skip: zeroPath },
  { id: 'result', Component: ResultStep, skip: zeroPath },
  { id: 'howItWorks', Component: HowItWorksStep },
  { id: 'blanks', Component: BlanksStep },
  { id: 'frequency', Component: FrequencyStep },
  /**
   * THE CONVERSION TAIL, and the order is an argument rather than a list.
   *
   * fluencyGoal sits against frequency because they are one beat: "how often"
   * and "by when" are both the user setting their own stakes.
   *
   * planBuild follows the goal rather than preceding it, so the screen
   * answers the question the goal has just raised ("can I actually do
   * that?") with the plan assembled from everything just answered, instead
   * of arriving unprompted. Swap these two lines to try it the other way
   * round; nothing else depends on the order.
   *
   * THIS SLOT HAS FORM. An earlier "Building your plan" loader here sat for
   * four seconds rotating fabricated five-star reviews, and was deleted, not
   * disabled. planBuild is its honest successor: every line it shows is the
   * user's own answer or shipped behaviour — see PlanBuildStep and the
   * history note in copy.ts before adding anything to it.
   *
   * Renamed from 'progressComparison' 2026-08-31 (the screen it named — a
   * static reassurance card — is gone). The analytics step name changes with
   * it ON PURPOSE: the dashboard's drop-off report can then compare the old
   * screen's losses against the new one's instead of blending them.
   */
  { id: 'fluencyGoal', Component: FluencyGoalStep },
  { id: 'planBuild', Component: PlanBuildStep },
  /**
   * HANDOFF THEN TASTE THEN THE WALL, and the order is the argument.
   *
   * The taste reel is deliberately the LAST thing before the paywall, because
   * that is where the purchase decision is actually made: everything above it
   * describes the product and this is the only screen that shows it. Putting
   * it earlier would spend the demonstration on someone who is still answering
   * questions.
   *
   * Handoff moved above it rather than being cut. Its copy reads as the reel's
   * instructions ("Swipe it like anything else, and tap a word the moment it
   * stops making sense") and its button is the one that launches into them.
   *
   * ⚠️ WHAT THIS DOES NOT FIX. Handoff also says "Your feed is ready", and
   * after the reel the user still meets PaywallScreen rather than the feed.
   * Three clips make that promise less wrong, not right. The copy and the
   * placement of the real wall are a separate decision — see the conversion
   * audit — and nothing here should be read as having settled it.
   */
  { id: 'handoff', Component: HandoffStep },
  {
    id: 'taste',
    Component: TasteStep,
    fullBleed: true,
    /**
     * NO CATALOG, NO REEL, NO STEP — the flow simply ends one screen earlier.
     *
     * Resolved against the live catalog rather than against FlowState, which is
     * the one predicate here that is not a function of the user's answers. That
     * is safe because the host recomputes the visible list on every navigation
     * AND re-renders when the catalog changes (see Onboarding's catalog
     * subscription): both halves see the same answer, so the row and the
     * index can never disagree.
     *
     * A first launch is the case this exists for. The snapshot downloads during
     * onboarding, so most people have it by the time they get here; anyone who
     * does not gets the flow as it was before this step existed, rather than a
     * screen apologising for itself.
     */
    /** BENCHED first (see TASTE_BENCHED above), catalog-gated second. The
        short-circuit keeps tasteAvailable un-called while benched, so the
        reel-resolution logs stay quiet in a flow that will not show it. */
    skip: () => TASTE_BENCHED || !tasteAvailable(getCatalog()),
  },
  { id: 'paywall', Component: PaywallStep, skip: () => !PAYWALL_ENABLED },
];

/** The steps actually in play for this answer set, in order. */
export function visibleSteps(state: FlowState): StepDef[] {
  return STEPS.filter((step) => !step.skip?.(state));
}

const styles = StyleSheet.create({
  /**
   * Art is sized in POINTS with an explicit height, never left to intrinsic
   * size. These are unsuffixed assets, so RN reads them as 1x and would draw
   * the logo 660pt wide; and a resizeMode of 'contain' with only a width would
   * still reserve the full intrinsic height, pushing the title off screen.
   */
  logo: { alignSelf: 'flex-start', height: 104, marginBottom: 22, width: 210 },
  parrot: { height: 168, marginBottom: 18, width: 113 },
  parrotWaving: { alignSelf: 'flex-start', height: 150, marginBottom: 20, width: 134 },
  choices: { marginTop: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 22 },
  chip: {
    backgroundColor: '#141a17',
    borderRadius: 16,
    paddingHorizontal: 15,
    paddingVertical: 11,
  },
  chipPressed: { opacity: 0.7 },
  /** ONE weight for both states — see WordChip: a selected chip that gets
      bolder gets WIDER, and the flex-wrap grid reflows around it. The
      selected colours live in WordChip's animated styles, not here. */
  chipText: { color: TEXT, fontSize: 17, fontWeight: '600' },
  resultBlock: { alignItems: 'center' },
  kicker: {
    color: 'rgba(242,245,243,0.5)',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2.4,
    textTransform: 'uppercase',
  },
  level: {
    color: ACCENT,
    fontSize: 64,
    fontWeight: '800',
    letterSpacing: -1,
    marginTop: 6,
  },
  steps: { marginTop: 26 },
  stepRow: { alignItems: 'stretch', flexDirection: 'row', gap: 14 },
  stepSpine: { alignItems: 'center', width: 12 },
  stepDot: {
    backgroundColor: ACCENT,
    borderRadius: 4,
    height: 8,
    // Centres on the text's first line (lineHeight 22).
    marginTop: 7,
    width: 8,
  },
  stepRail: {
    backgroundColor: 'rgba(94,230,168,0.25)',
    borderRadius: 1,
    flex: 1,
    marginTop: 6,
    width: 2,
  },
  stepText: {
    color: 'rgba(242,245,243,0.75)',
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    // The rail's reach: rows have no gap, so this is the space between steps
    // and the rail runs through it unbroken.
    paddingBottom: 20,
  },
  mockLine: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 28,
  },
  mockWord: { color: TEXT, fontSize: 22, fontWeight: '700' },

  // ---- fluency goal ----
  goalValue: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 34,
  },
  goalNumber: { color: ACCENT, fontSize: 58, fontWeight: '800', letterSpacing: -1 },
  goalUnit: { color: 'rgba(242,245,243,0.55)', fontSize: 18, fontWeight: '700' },
  /** Tall enough to be draggable with a thumb; the visible track is thinner. */
  sliderHit: { height: 44, justifyContent: 'center', marginTop: 18 },
  track: {
    backgroundColor: 'rgba(242,245,243,0.12)',
    borderRadius: 999,
    height: 6,
    overflow: 'hidden',
  },
  trackFill: {
    backgroundColor: ACCENT,
    height: '100%',
    transformOrigin: 'left',
    width: '100%',
  },
  knob: {
    backgroundColor: ACCENT,
    borderRadius: 999,
    height: KNOB,
    left: -KNOB / 2,
    position: 'absolute',
    width: KNOB,
  },
  goalDerived: {
    color: 'rgba(242,245,243,0.6)',
    fontSize: 15,
    marginTop: 26,
    textAlign: 'center',
  },
  goalDerivedStrong: { color: TEXT, fontWeight: '800' },

  // ---- reassurance ----
  /** The one thing left of the old bar chart's block of styles: a centred slot
      for the mascot, at roughly the spacing the chart used to sit at. */
  planJourney: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    marginTop: 30,
  },
  planNode: { alignItems: 'center', gap: 6 },
  planNodeBadge: {
    backgroundColor: 'rgba(94,230,168,0.14)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  planNodeBadgeText: { color: ACCENT, fontSize: 14, fontWeight: '800' },
  /** The destination is the loud end: filled, not tinted. */
  planNodeBadgeGoal: { backgroundColor: ACCENT },
  planNodeBadgeGoalText: { color: ON_ACCENT, fontSize: 14, fontWeight: '800' },
  planNodeLabel: { color: MUTED, fontSize: 12, fontWeight: '600' },
  /** Full height of the journey, so the tilted track can be positioned
      against both badge midlines (see PLAN_TRACK_MID). */
  planBarSeat: { alignSelf: 'stretch', flex: 1 },
  planBarTilt: { position: 'absolute' },
  planBar: {
    backgroundColor: 'rgba(242,245,243,0.08)',
    borderRadius: 3,
    height: 6,
    overflow: 'hidden',
  },
  planBarFill: {
    backgroundColor: ACCENT,
    borderRadius: 3,
    height: '100%',
  },
  planLines: { gap: 16, marginTop: 26 },
  planTotal: { marginTop: 30 },
  planTotalLead: { color: MUTED, fontSize: 13, fontWeight: '600' },
  planTotalValue: {
    color: TEXT,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginTop: 4,
  },
  planTotalUnit: { color: ACCENT, fontSize: 22, fontWeight: '800' },
  planTotalBody: { color: MUTED, fontSize: 13, lineHeight: 19, marginTop: 2 },
  planVerdict: {
    color: TEXT,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 19,
    marginTop: 10,
  },
  planRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
  planTick: {
    alignItems: 'center',
    backgroundColor: 'rgba(94,230,168,0.15)',
    borderRadius: 11,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  planTickMark: { color: ACCENT, fontSize: 12, fontWeight: '800' },
  planText: {
    color: TEXT,
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 21,
  },
});
