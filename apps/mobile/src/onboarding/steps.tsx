import { useEffect, useState, type ReactElement } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { Level, SelfLevel } from '@loro/core/types';
import { storage } from '@loro/core/storage';
import { buildCalibrationWords, deriveLevel } from '@loro/core/calibration';
import {
  ACCENT,
  Body,
  BlankMock,
  ChoiceCard,
  PrimaryButton,
  Screen,
  TEXT,
  Title,
} from './chrome';
import { BRAND } from './brand';
import {
  BLANKS,
  BUILDING_PLAN,
  CALIBRATION_INTRO,
  FLUENCY_GOAL,
  FREQUENCY,
  GRID,
  HANDOFF,
  HOOK,
  HOW_IT_WORKS,
  MOTIVATION,
  PAYWALL,
  PROGRESS_COMPARISON,
  RESULT,
  SELF_LEVEL,
} from './copy';
import { PAYWALL_ENABLED, olog, setFrequency, setMotivation } from './flow';

/**
 * The eleven screens, in order. Each one is a pure component over the flow
 * state; the host (Onboarding.tsx) owns the state, the index and the slide.
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
};

export const INITIAL_FLOW: FlowState = {
  motivation: [],
  selfLevel: null,
  known: new Set(),
  derived: null,
  frequency: null,
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
   * arrived, and the building-plan loader would start its timer, finish, and
   * advance the flow from five screens away. Anything time-based keys off
   * this and tears itself down when it goes false.
   */
  isCurrent: boolean;
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
  | 'progressComparison'
  | 'buildingPlan'
  | 'paywall'
  | 'handoff';

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
        {CALIBRATION_WORDS.map((word) => {
          const on = state.known.has(word.text);
          return (
            <Pressable
              key={word.text}
              onPress={() => toggle(word.text)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              style={({ pressed }) => [
                styles.chip,
                on && styles.chipOn,
                pressed && styles.chipPressed,
              ]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>
                {word.text}
              </Text>
            </Pressable>
          );
        })}
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

function HowItWorksStep({ next }: StepProps) {
  return (
    <Screen footer={<PrimaryButton label={HOW_IT_WORKS.cta} onPress={next} />}>
      <Title>{HOW_IT_WORKS.title}</Title>
      <View style={styles.steps}>
        {HOW_IT_WORKS.steps.map((line, i) => (
          <View key={line} style={styles.stepRow}>
            <View style={styles.stepNumber}>
              <Text style={styles.stepNumberText}>{i + 1}</Text>
            </View>
            <Text style={styles.stepText}>{line}</Text>
          </View>
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
function FluencyGoalStep({ next }: StepProps) {
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
    <Screen footer={<PrimaryButton label={FLUENCY_GOAL.cta} onPress={next} />}>
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
          every render; no key holds it and nothing downstream reads it. */}
      <Text style={styles.goalDerived}>
        {FLUENCY_GOAL.derivedPrefix}{' '}
        <Text style={styles.goalDerivedStrong}>{targetLabel(months)}</Text>
      </Text>
    </Screen>
  );
}

// -------------------------------------------------- 11. progress comparison

/** Bar heights in points. The 2:1 ratio IS the claim the copy makes, so it
    lives beside the copy's warning rather than being quietly tuned here. */
const BAR_OTHER = 92;
const BAR_LORO = 184;

function ProgressComparisonStep({ isCurrent, next }: StepProps) {
  const reducedMotion = useReducedMotion();
  const grow = useSharedValue(0);

  // Grows in on ARRIVAL, not on mount. Reset on leave so coming back replays
  // it rather than showing a chart that is already over.
  useEffect(() => {
    if (!isCurrent) {
      grow.value = 0;
      return;
    }
    grow.value = withTiming(1, { duration: reducedMotion ? 0 : 900 });
  }, [isCurrent, reducedMotion, grow]);

  /** scaleY from the foot of the bar, so the growth costs no layout pass and
      the labels underneath cannot shift while it runs. */
  const otherStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: grow.value }] }));
  const loroStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: grow.value }] }));

  return (
    <Screen
      footer={<PrimaryButton label={PROGRESS_COMPARISON.cta} onPress={next} />}
    >
      <Title>{PROGRESS_COMPARISON.title}</Title>
      <Body>{PROGRESS_COMPARISON.body}</Body>

      <View style={styles.chart}>
        <View style={styles.column}>
          <Text style={styles.barValue}>{PROGRESS_COMPARISON.otherValue}</Text>
          <Animated.View style={[styles.bar, styles.barOther, otherStyle]} />
          <Text style={styles.barLabel}>{PROGRESS_COMPARISON.otherLabel}</Text>
        </View>

        <View style={styles.column}>
          <Text style={[styles.barValue, styles.barValueLoro]}>
            {PROGRESS_COMPARISON.loroValue}
          </Text>
          <Animated.View style={[styles.bar, styles.barLoro, loroStyle]} />
          <Text style={[styles.barLabel, styles.barLabelLoro]}>
            {PROGRESS_COMPARISON.loroLabel}
          </Text>
        </View>

        {/* Beside the tall bar, standing on the same baseline. */}
        <Image
          source={BRAND.parrot}
          style={styles.chartParrot}
          resizeMode="contain"
          accessibilityRole="image"
          accessibilityLabel="Loro the parrot"
        />
      </View>
    </Screen>
  );
}

// ------------------------------------------------------- 12. building plan

/** How long the loader runs, and how long each review card is up. */
const BUILD_MS = 4200;
const CARD_MS = 1400;

/**
 * The loading screen, and the one screen allowed to advance on its own.
 *
 * A RESULT SCREEN THAT AUTO-ADVANCES READS AS A GLITCH; a loader that does not
 * reads as a hang. That is the whole difference, and it is why the calibration
 * result ends in a tap (the web's 1900ms auto-advance there had a guided video
 * to land on) while this one does not.
 *
 * REDUCE MOTION SHORTENS THE ANIMATION, NOT THE WAIT. A progress bar is
 * information, not decoration: filling it instantly and then sitting still for
 * four seconds is exactly the broken-looking state the bar exists to prevent.
 * The cross-fade and the bar's growth are what get suppressed.
 */
function BuildingPlanStep({ isCurrent, next }: StepProps) {
  const reducedMotion = useReducedMotion();
  const [card, setCard] = useState(0);
  const fill = useSharedValue(0);
  const fade = useSharedValue(1);

  useEffect(() => {
    if (!isCurrent) {
      // Reset rather than freeze: coming back to a half-filled bar would look
      // like the plan half-built.
      fill.value = 0;
      setCard(0);
      return;
    }

    fill.value = withTiming(1, { duration: BUILD_MS });

    const rotate = setInterval(() => {
      setCard((current) => (current + 1) % BUILDING_PLAN.testimonials.length);
    }, CARD_MS);

    // The advance. Cleared on leave, so going back mid-load cannot leave a
    // timer alive that jumps the flow forward from another screen.
    const advance = setTimeout(next, BUILD_MS + 350);

    return () => {
      clearInterval(rotate);
      clearTimeout(advance);
    };
  }, [isCurrent, next, fill]);

  // Cross-fade on each swap. Driven from the card index rather than from the
  // interval so the two can never disagree about which card is showing.
  useEffect(() => {
    if (reducedMotion) return;
    fade.value = 0;
    fade.value = withTiming(1, { duration: 260 });
  }, [card, reducedMotion, fade]);

  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: fill.value }],
  }));
  const cardStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  const review = BUILDING_PLAN.testimonials[card];

  return (
    <Screen>
      <Title>{BUILDING_PLAN.title}</Title>
      <Body>{BUILDING_PLAN.body}</Body>

      <View style={styles.loaderTrack}>
        <Animated.View style={[styles.loaderFill, fillStyle]} />
      </View>

      <Animated.View style={[styles.review, cardStyle]}>
        <Text style={styles.reviewStars}>★★★★★</Text>
        <Text style={styles.reviewQuote}>“{review.quote}”</Text>
        <Text style={styles.reviewName}>
          {review.name} · {review.detail}
        </Text>
      </Animated.View>
    </Screen>
  );
}

// -------------------------------------------------------------- 13. paywall

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

// ------------------------------------------------------------- 14. handoff

function HandoffStep({ finish }: StepProps) {
  return (
    <Screen footer={<PrimaryButton label={HANDOFF.cta} onPress={finish} />}>
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
};

/** A 'zero' self-assessment has no grid to fill: the deck calibrates instead
    (and until it lands, nothing does — see the seam in SelfLevelStep). */
const zeroPath = (state: FlowState) => state.selfLevel === 'zero';

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
   * and "by when" are both the user setting their own stakes, and asking them
   * together is what lets buildingPlan look like it consumed both.
   *
   * progressComparison follows the goal rather than preceding it, so the chart
   * answers the question the goal has just raised ("can I actually do that?")
   * instead of arriving as an unprompted boast. Swap these two lines to try it
   * the other way round; nothing else depends on the order.
   *
   * buildingPlan is last of the three because it can only claim to be building
   * a plan once there are answers to build it from. It must stay after the
   * calibration block.
   */
  { id: 'fluencyGoal', Component: FluencyGoalStep },
  { id: 'progressComparison', Component: ProgressComparisonStep },
  { id: 'buildingPlan', Component: BuildingPlanStep },
  { id: 'paywall', Component: PaywallStep, skip: () => !PAYWALL_ENABLED },
  { id: 'handoff', Component: HandoffStep },
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
  chipOn: { backgroundColor: ACCENT },
  chipPressed: { opacity: 0.7 },
  chipText: { color: TEXT, fontSize: 17, fontWeight: '600' },
  chipTextOn: { color: '#06130d', fontWeight: '700' },
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
  steps: { gap: 14, marginTop: 26 },
  stepRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
  stepNumber: {
    alignItems: 'center',
    backgroundColor: 'rgba(94,230,168,0.14)',
    borderRadius: 999,
    height: 26,
    justifyContent: 'center',
    width: 26,
  },
  stepNumberText: { color: ACCENT, fontSize: 13, fontWeight: '800' },
  stepText: {
    color: 'rgba(242,245,243,0.75)',
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    paddingTop: 2,
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

  // ---- progress comparison ----
  chart: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 22,
    justifyContent: 'center',
    marginTop: 36,
  },
  column: { alignItems: 'center', gap: 8 },
  bar: { borderRadius: 12, transformOrigin: 'bottom', width: 62 },
  barOther: { backgroundColor: 'rgba(242,245,243,0.16)', height: BAR_OTHER },
  barLoro: { backgroundColor: ACCENT, height: BAR_LORO },
  barValue: {
    color: 'rgba(242,245,243,0.45)',
    fontSize: 15,
    fontWeight: '800',
  },
  barValueLoro: { color: ACCENT, fontSize: 19 },
  barLabel: { color: 'rgba(242,245,243,0.55)', fontSize: 13, fontWeight: '600' },
  barLabelLoro: { color: TEXT, fontWeight: '800' },
  chartParrot: { height: 104, marginBottom: 22, width: 70 },

  // ---- building plan ----
  loaderTrack: {
    backgroundColor: 'rgba(242,245,243,0.12)',
    borderRadius: 999,
    height: 6,
    marginTop: 30,
    overflow: 'hidden',
  },
  loaderFill: {
    backgroundColor: ACCENT,
    height: '100%',
    transformOrigin: 'left',
    width: '100%',
  },
  review: {
    backgroundColor: '#141a17',
    borderRadius: 18,
    marginTop: 30,
    padding: 18,
  },
  reviewStars: { color: '#f5c451', fontSize: 13, letterSpacing: 2 },
  reviewQuote: {
    color: TEXT,
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 24,
    marginTop: 8,
  },
  reviewName: {
    color: 'rgba(242,245,243,0.45)',
    fontSize: 13,
    marginTop: 10,
  },
});
