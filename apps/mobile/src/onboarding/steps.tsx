import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { HookHero } from './HookHero';
import { LessonIntroStep, TapWordStep, WordBackStep } from './WordLesson';
import { FrequencyPicker } from './FrequencyPicker';
import { LoroSays } from './LoroSays';
import { MotiveGrid, MotiveTile, PillCloud, TopicPill } from './PickCards';
import { BoardingPass, PlanCheck, PlanRing } from './PlanArt';
import { TRIP } from '@loro/core/roadmap';
import { Image, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import type { Level, SelfLevel } from '@loro/core/types';
import { getCatalog } from '@loro/core/catalog';
import { storage } from '@loro/core/storage';
import {
  ACCENT,
  CARD,
  Body,
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
  BarsIcon,
  IconTile,
  type Tint,
} from './art';
import {
  FLUENCY_GOAL,
  FREQUENCY,
  HANDOFF,
  HOOK,
  LORO_LINES,
  MOTIVATION,
  PAYWALL,
  TOPICS,
  PLAN_BUILD,
  PLAN_READY,
  SELF_LEVEL,
} from './copy';
import { planFor } from '../progress/plan';
import { PAYWALL_ENABLED, olog, setFrequency, setMotivation } from './flow';
import { TasteStep } from './TasteStep';
import { setLikedTopics } from '../feed/topics';
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
  /** What they like watching — several allowed; the feed leans that way. */
  topics: string[];
  selfLevel: SelfLevel | null;
  derived: Level | null;
  frequency: string | null;
  /** The fluency slider's months. IN FLOW STATE FOR DISPLAY ONLY — the plan
      screen draws the A→B journey from it. It is still never persisted:
      no storage key holds it and nothing after onboarding reads it. */
  goalMonths: number | null;
};

export const INITIAL_FLOW: FlowState = {
  motivation: [],
  topics: [],
  selfLevel: null,
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
  | 'topics'
  | 'selfLevel'
  | 'lessonIntro'
  | 'tapWord'
  | 'wordBack'
  | 'frequency'
  | 'fluencyGoal'
  | 'planBuild'
  | 'planReady'
  | 'handoff'
  | 'taste'
  | 'paywall';

/** The start level each self-assessment sets, now that there is no grid. */
const SELF_LEVEL_START: Record<SelfLevel, Level> = {
  zero: 'A1',
  some: 'A2',
  confident: 'B1',
};

// ------------------------------------------------------------------ 1. hook

function HookStep({ next, isCurrent }: StepProps) {
  /**
   * FITS THE WINDOW, NEVER SCROLLS (Radek: "the first page cannot be able
   * to scroll"). Logo, title, body, button and chrome are known heights, so
   * the lyrics take what is left, between a floor that still shows three
   * lines and a ceiling that keeps them from drifting apart.
   *
   * THE DRAWN PHONE IS GONE (Radek, 2026-10-27: "the weird screen is
   * horrible"). The sun, the hill and Loro inside a fake video said "app
   * for kids"; Spanish lines rolling like lyrics, each one lit and
   * explained, say what the app does to a sentence. See HookHero.
   */
  const { height } = useWindowDimensions();
  const fixed = 56 + 64 + 92 + 52 + 100 + 60 + 24; // logo, title, body, footer, chrome, paddings
  const heroHeight = Math.max(230, Math.min(400, height - fixed));
  return (
    <Screen footer={<PrimaryButton label={HOOK.cta} onPress={next} />}>
      <Image
        source={BRAND.logo}
        style={styles.logo}
        resizeMode="contain"
        accessibilityRole="image"
        accessibilityLabel="Loro"
      />
      <HookHero active={isCurrent} height={heroHeight} />
      <Text style={styles.hookTitle}>{HOOK.title}</Text>
      {HOOK.body ? <Text style={styles.hookBody}>{HOOK.body}</Text> : null}
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
function MotivationStep({ state, update, next, isCurrent }: StepProps) {
  /**
   * PICKED LOCALLY, COMMITTED ON CONTINUAR. Every onboarding screen is
   * mounted at once, so patching the flow state on each tap re-rendered all
   * of them and the card animation stuttered (Radek, 2026-10-06: "janky").
   */
  const [picked, setPicked] = useState<string[]>(state.motivation);
  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]));
  // Loro reacts to the newest answer still ticked; none ticked, his opener.
  const lines = LORO_LINES.motivation;
  const latest = picked[picked.length - 1];

  const commit = () => {
    update({ motivation: picked });
    if (picked.length > 0) setMotivation(picked);
    next();
  };

  return (
    <Screen footer={<PrimaryButton label={MOTIVATION.cta} onPress={commit} />}>
      <LoroSays line={(latest && lines[latest]) || lines.open} active={isCurrent} />
      <Title>{MOTIVATION.title}</Title>
      <Body>{MOTIVATION.body}</Body>
      {/* Four tiles, English first, an icon each (PickCards.tsx). */}
      <MotiveGrid>
        {MOTIVATION.options.map((option) => (
          <MotiveTile
            key={option.id}
            id={option.id}
            en={option.label}
            es={option.es}
            on={picked.includes(option.id)}
            onPress={() => toggle(option.id)}
          />
        ))}
      </MotiveGrid>
    </Screen>
  );
}

// ---------------------------------------------------------------- 2b. topics

/**
 * WHAT THEY LOVE WATCHING. Six topic tiles in a 2×3 grid (TopicTile), placed
 * after the screens that show how Loro works. Saved on Continuar (an empty
 * answer saves nothing: the feed simply does not lean), read by the feed's
 * ranking on its next ordering (feed/topics.ts, core feedRank).
 */
function TopicsStep({ state, update, next, isCurrent }: StepProps) {
  // Picked locally for the same reason as MotivationStep.
  const [picked, setPicked] = useState<string[]>(state.topics);
  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]));
  const commit = () => {
    update({ topics: picked });
    if (picked.length > 0) setLikedTopics(picked);
    olog(`topics=[${picked.join(', ')}]`);
    next();
  };
  return (
    <Screen footer={<PrimaryButton label={TOPICS.cta} onPress={commit} />}>
      <LoroSays
        line={(picked.length > 0 && LORO_LINES.topics[picked[picked.length - 1]]) || LORO_LINES.topics.open}
        active={isCurrent}
      />
      <Title>{TOPICS.title}</Title>
      <Body>{TOPICS.body}</Body>
      {/* A cloud of Spanish words (PickCards.tsx, 2026-10-27), replacing
          the 2×3 grid of tinted icon tiles. */}
      <PillCloud>
        {TOPICS.options.map((option) => (
          <TopicPill
            key={option.id}
            en={option.pill}
            es={option.es}
            glyph={(TOPIC_ART[option.id] ?? { glyph: '✦' }).glyph}
            on={picked.includes(option.id)}
            onPress={() => toggle(option.id)}
          />
        ))}
      </PillCloud>
    </Screen>
  );
}

/** Text-presentation symbols, never emoji — the motivation cards' rule. */
const TOPIC_ART: Record<string, { glyph: string; tint: Tint }> = {
  travel: { glyph: '✈︎', tint: 'sky' },
  food: { glyph: '☕︎', tint: 'amber' },
  love: { glyph: '♥︎', tint: 'rose' },
  money: { glyph: '€', tint: 'mint' },
  funny: { glyph: '☺︎', tint: 'violet' },
  mind: { glyph: '✿︎', tint: 'mint' },
};

/** Drawn bars: one lit for zero, two for a bit, three for comfortable. */
const SELF_LEVEL_ART: Record<string, { level: 1 | 2 | 3; tint: Tint }> = {
  zero: { level: 1, tint: 'mint' },
  some: { level: 2, tint: 'sky' },
  confident: { level: 3, tint: 'amber' },
};


// ----------------------------------------------------------- 3. self-assess

/**
 * How long a single-answer screen shows the tapped card lit before it slides
 * on. Advancing in the same frame as the tap meant the card never visibly
 * selected and the slide started under the finger (Radek, 2026-10-27).
 * Long enough for Loro's reaction to be read before the screen moves.
 */
const CHOSEN_HOLD_MS = 650;

function SelfLevelStep({ state, update, next, isCurrent }: StepProps) {
  /** Lit at once; the answer itself commits after CHOSEN_HOLD_MS. */
  const [chosen, setChosen] = useState<SelfLevel | null>(state.selfLevel);
  const leaving = useRef(false);
  const choose = (level: SelfLevel) => {
    if (leaving.current) return;
    leaving.current = true;
    setChosen(level);
    setTimeout(() => {
      leaving.current = false;
      pick(level);
    }, CHOSEN_HOLD_MS);
  };
  /** The web's pickSelfLevel, app/welcome/page.tsx:150-162. */
  const pick = (level: SelfLevel) => {
    storage.setSelfLevel(level);
    /**
     * THE WORD CHECK IS GONE (Radek, 2026-10-27: "I want the word check
     * away"). The fifteen-word grid used to derive the start level; now
     * the answer here sets it, at the bottom of each band so the feed
     * starts easy and moves up from there: zero A1, a bit A2, comfortable
     * B1. No calibration words are written, which core reads as "none".
     */
    const derived = SELF_LEVEL_START[level];
    storage.setStartLevel(derived);
    olog(`selfLevel=${level} -> startLevel=${derived} (no word check)`);
    update({ selfLevel: level, derived });
    next();
  };

  return (
    <Screen>
      <LoroSays line={(chosen && LORO_LINES.selfLevel[chosen]) || LORO_LINES.selfLevel.open} active={isCurrent} />
      <Title>{SELF_LEVEL.title}</Title>
      <Body>{SELF_LEVEL.body}</Body>
      <View style={styles.choices} accessibilityRole="radiogroup">
        {SELF_LEVEL.options.map((option) => {
          const on = chosen === option.id;
          const art = SELF_LEVEL_ART[option.id];
          return (
            <ChoiceCard
              key={option.id}
              label={option.label}
              es={option.es}
              body={option.body}
              selected={on}
              icon={
                art && (
                  <IconTile tint={art.tint} on={on}>
                    <BarsIcon level={art.level} tint={art.tint} on={on} />
                  </IconTile>
                )
              }
              onPress={() => choose(option.id)}
            />
          );
        })}
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

/** The lesson's two screens adapt StepProps to what they need. */
function LessonIntroScreen({ next, isCurrent }: StepProps) {
  return <LessonIntroStep next={next} isCurrent={isCurrent} />;
}
function TapWordScreen({ next, isCurrent }: StepProps) {
  return <TapWordStep next={next} isCurrent={isCurrent} />;
}
function WordBackScreen({ next, isCurrent }: StepProps) {
  return <WordBackStep next={next} isCurrent={isCurrent} />;
}

// ------------------------------------------------------------ 9. frequency

function FrequencyStep({ state, update, next, isCurrent }: StepProps) {
  /**
   * PICK, THEN CONTINUE. It used to advance on tap, which slid the screen
   * away under the finger; now the week fills in to show the choice and
   * the button moves on (Radek, 2026-10-27). Picked locally and committed
   * once, like the multi-selects, so a change of mind writes nothing.
   */
  const [picked, setPicked] = useState<string | null>(state.frequency);
  const commit = () => {
    if (!picked) return;
    setFrequency(picked);
    // The number core grades the streak day against (Shell.tsx).
    storage.setDailyGoal(planFor(picked).wordsPerDay);
    update({ frequency: picked });
    next();
  };
  return (
    <Screen footer={<PrimaryButton label={FREQUENCY.cta} onPress={commit} disabled={!picked} />}>
      <LoroSays line={(picked && LORO_LINES.frequency[picked]) || LORO_LINES.frequency.open} active={isCurrent} />
      <Title>{FREQUENCY.title}</Title>
      <Body>{FREQUENCY.body}</Body>
      <FrequencyPicker picked={picked} onPick={setPicked} weeklyMinutes={WEEKLY_MINUTES} />
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

/** How long the ring takes. The four lines tick inside this window, and the
    button unlocks just after it. */
const PLAN_BUILD_MS = 3000;

/**
 * Minutes per week each frequency answer amounts to, FOR THE SUM LINE AND
 * THE WEEK PICTURE ONLY. Each figure is the option's own copy turned into
 * arithmetic — change the copy in FREQUENCY.options and these must move:
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

/** The pace as a short checklist line. */
function paceShort(frequency: string | null): string | null {
  switch (frequency) {
    case 'light':
      return '5 minutes, a few times a week';
    case 'daily':
      return '10 minutes, every day';
    case 'serious':
      return '20+ minutes, every day';
    default:
      return null;
  }
}

/**
 * The plan assembling: a ring to 100%, four lines ticking as it passes them,
 * then the one number. Every line is TRUE, the condition this slot exists
 * under (see the history in copy.ts: a fake loader with invented
 * testimonials once stood here and was deleted). The level is the grid's (or
 * the zero path's A1), the pace is their frequency answer, the feed line is
 * their topics, and the last line is shipped behaviour. The hours are their
 * pace × their window, nothing else.
 *
 * Redrawn 2026-10-27 (Radek: "good page, but the visual is bad, a lot of
 * text"): the A→B polyline, the labelled sheet and the verdict paragraph are
 * gone. Keyed off isCurrent, runs once.
 */
function PlanBuildStep({ state, next, isCurrent }: StepProps) {
  const reduced = useReducedMotion();
  const started = useRef(false);
  const [done, setDone] = useState(false);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!isCurrent || started.current) return;
    started.current = true;
    if (reduced) {
      progress.value = 1;
      setDone(true);
      return;
    }
    progress.value = withTiming(1, { duration: PLAN_BUILD_MS, easing: Easing.inOut(Easing.cubic) });
    const timer = setTimeout(() => setDone(true), PLAN_BUILD_MS + 150);
    return () => clearTimeout(timer);
  }, [isCurrent, reduced, progress]);

  const level = state.derived ?? 'A1';
  const goalMonths = state.goalMonths ?? DEFAULT_MONTHS;
  const goalDate = targetLabel(goalMonths);
  const feedFor = topicPhrase(state.topics);
  const pace = paceShort(state.frequency);
  const lines = [
    `Starting at ${level}`,
    pace ?? PLAN_BUILD.paceFallback,
    feedFor ? `More ${feedFor}` : 'Clips at your level',
    PLAN_BUILD.recallShort,
  ];
  const hours = state.frequency ? planHours(WEEKLY_MINUTES[state.frequency] ?? 0, goalMonths) : 0;

  return (
    <Screen footer={<PrimaryButton label={PLAN_BUILD.cta} onPress={next} disabled={!done} />}>
      <Text style={styles.planTitle}>{done ? PLAN_BUILD.titleDone : PLAN_BUILD.title}</Text>
      <View style={styles.planRingSeat}>
        <PlanRing progress={progress} />
      </View>
      <View style={styles.planChecks}>
        {lines.map((text, i) => (
          <PlanCheck key={i} progress={progress} at={0.22 + i * 0.24} text={text} />
        ))}
      </View>
      {hours > 0 && (
        <Reveal active={done} delay={0}>
          <View style={styles.planTotal}>
            <Text style={styles.planTotalValue}>
              ≈ {hours} <Text style={styles.planTotalUnit}>{PLAN_BUILD.totalUnit}</Text>
            </Text>
            <Text style={styles.planTotalBody}>
              {PLAN_BUILD.totalBodyPrefix}
              {goalDate}
            </Text>
          </View>
        </Reveal>
      )}
    </Screen>
  );
}

// ----------------------------------------------------------- 11b. plan ready

/** The picked topics as a phrase — "food", "food and travel", "food, travel and money and work". */
function topicPhrase(topics: string[]): string | null {
  const names = TOPICS.options.filter((o) => topics.includes(o.id)).map((o) => TOPICS.short[o.id] ?? o.label.toLowerCase());
  if (names.length === 0) return null;
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Up to two answers, capitalised, for a pass field that has two lines. */
function shortList(labels: string[], fallback: string): string {
  if (labels.length === 0) return fallback;
  const head = labels.slice(0, 2).join(' & ');
  const text = labels.length > 2 ? `${head} +${labels.length - 2}` : head;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The pace as a pass field. */
const PASS_PACE: Record<string, string> = {
  light: '5 min, 3× a week',
  daily: '10 min a day',
  serious: '20+ min a day',
};

/**
 * The plan, finished, as a BOARDING PASS (Radek, 2026-10-27: "Enhorabuena
 * page I hate, the colourful squares don't make any sense"). The app is a
 * trip, Madrid first, so the plan is the ticket: from their level today to
 * fluent by their month, with pace, focus, why and the first stop. Every
 * field is their own answer, or the trip's real first city.
 */
function PlanReadyStep({ state, next, finish, isLast, isCurrent }: StepProps) {
  const leave = isLast ? finish : next;
  const goalDate = targetLabel(state.goalMonths ?? DEFAULT_MONTHS);
  const why = MOTIVATION.options.filter((o) => state.motivation.includes(o.id)).map((o) => o.label);
  const focus = TOPICS.options.filter((o) => state.topics.includes(o.id)).map((o) => TOPICS.short[o.id] ?? o.label);
  return (
    <Screen footer={<PrimaryButton label={PLAN_READY.cta} onPress={leave} />}>
      <View style={styles.readyHero}>
        <Image
          source={BRAND.parrotWaving}
          style={styles.readyParrot}
          resizeMode="contain"
          accessibilityRole="image"
          accessibilityLabel="Loro the parrot, waving"
        />
        <View style={styles.readyTitles}>
          <Title>{PLAN_READY.title}</Title>
          <Text style={styles.planReadyGloss}>{PLAN_READY.gloss}</Text>
          <Text style={styles.readySub}>{PLAN_READY.sub}</Text>
        </View>
      </View>
      <BoardingPass
        active={isCurrent}
        fields={{
          from: state.derived ?? 'A1',
          to: 'Fluent',
          toDate: goalDate,
          pace: (state.frequency && PASS_PACE[state.frequency]) || 'Your pace',
          focus: shortList(focus, 'Everything'),
          why: shortList(why, 'For me'),
          firstStop: TRIP[0]?.city ?? 'Madrid',
        }}
      />
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
  /**
   * THE LESSON (2026-10-27): tap a word and save it, then type it back into
   * a gap — the old "how it works" animation and the looping blank mock,
   * replaced by the user doing both (WordLesson.tsx). New step ids on
   * purpose, so the funnel compares these screens against the old ones
   * instead of blending them.
   */
  { id: 'lessonIntro', Component: LessonIntroScreen },
  { id: 'tapWord', Component: TapWordScreen },
  { id: 'wordBack', Component: WordBackScreen },
  /**
   * WHAT THEY LOVE WATCHING sits here, not beside motivation (Radek,
   * 2026-10-06: not right after "the same looking page of taps"). The two
   * screens before it have just shown that Loro is real videos with blanks
   * in them, so "what do you love watching?" is the natural next question —
   * and it is a different shape (a tile grid) from the motivation cards.
   */
  { id: 'topics', Component: TopicsStep },
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
   * THE PLAN, SAID BACK — and the last screen before the wall while the reel
   * is benched. Congratulations, the date, then four lines: pace and goal,
   * why, level, recall. PaywallScreen's header ("Your plan is set") is the
   * next thing they read, so the two are one beat.
   */
  { id: 'planReady', Component: PlanReadyStep },
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
  /**
   * SKIPPED WHILE THE REEL IS BENCHED (2026-09-07). Its copy is the reel's
   * instructions and its promise ("Your feed is ready") is broken by the
   * wall that actually follows; planReady above now owns the goodbye. Flip
   * TASTE_BENCHED and it returns as the reel's lead-in, exactly as before.
   */
  { id: 'handoff', Component: HandoffStep, skip: () => TASTE_BENCHED },
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
  logo: { alignSelf: 'center', height: 56, marginBottom: 4, width: 113 },
  hookTitle: {
    color: TEXT,
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.6,
    lineHeight: 38,
    marginTop: 8,
    textAlign: 'center',
  },
  hookBody: {
    color: MUTED,
    fontSize: 16,
    lineHeight: 23,
    marginTop: 10,
    paddingHorizontal: 8,
    textAlign: 'center',
  },

  // ---- calibration intro ----
  introStage: {
    backgroundColor: 'rgba(20,26,23,0.85)',
    borderColor: 'rgba(242,245,243,0.08)',
    borderRadius: 22,
    borderWidth: 1,
    marginBottom: 24,
    overflow: 'hidden',
    padding: 18,
    paddingRight: 110,
  },
  introFacts: { alignItems: 'center', flexDirection: 'row', gap: 16 },
  introFact: { alignItems: 'flex-start' },
  introNumber: { color: ACCENT, fontSize: 40, fontWeight: '800', letterSpacing: -1, lineHeight: 44 },
  introUnit: { color: MUTED, fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  introFactDivider: { backgroundColor: 'rgba(242,245,243,0.12)', height: 36, width: 1 },
  introChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 16 },
  introChip: {
    backgroundColor: 'rgba(242,245,243,0.07)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  introChipOn: { backgroundColor: ACCENT },
  introChipText: { color: 'rgba(242,245,243,0.7)', fontSize: 13, fontWeight: '600' },
  introChipTextOn: { color: ON_ACCENT, fontWeight: '800' },
  introParrot: { bottom: -6, position: 'absolute', right: -14 },

  // ---- how it works ----
  stepCard: {
    backgroundColor: 'rgba(20,26,23,0.9)',
    borderColor: 'rgba(242,245,243,0.08)',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
    padding: 14,
  },
  stepNumber: {
    alignItems: 'center',
    backgroundColor: 'rgba(94,230,168,0.16)',
    borderRadius: 999,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  stepNumberText: { color: ACCENT, fontSize: 13, fontWeight: '800' },
  stepBody: { flex: 1 },
  stepArt: { marginTop: 10 },
  howStage: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(20,26,23,0.9)',
    borderColor: 'rgba(242,245,243,0.08)',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  stepLine: { alignItems: 'flex-start', flexDirection: 'row', gap: 14, paddingVertical: 11 },
  /** The numeral in a soft mint bubble — round, bold, the app's own
      vibe (Radek: "make them more bubbly or smooth"). A thin light
      numeral was the cut before. */
  stepNumeral: {
    backgroundColor: 'rgba(94,230,168,0.18)',
    borderRadius: 999,
    color: ACCENT,
    fontSize: 15,
    fontWeight: '800',
    height: 32,
    lineHeight: 32,
    marginTop: -4,
    overflow: 'hidden',
    textAlign: 'center',
    width: 32,
  },
  stepTapRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  stepArrow: { color: MUTED, fontSize: 16, fontWeight: '800' },
  stepSavedTag: {
    backgroundColor: 'rgba(94,230,168,0.14)',
    borderColor: 'rgba(94,230,168,0.35)',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  stepSavedText: { color: ACCENT, fontSize: 12, fontWeight: '800' },
  parrot: { height: 168, marginBottom: 18, width: 113 },
  parrotWaving: { alignSelf: 'flex-start', height: 150, marginBottom: 20, width: 134 },
  choices: { marginTop: 18 },
  topicGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 20 },
  topicCell: { width: '48.5%' },
  /** One fixed size for every tile: a two-line label must not make its square taller than its neighbour. */
  topicTile: { alignItems: 'flex-start', borderRadius: 20, borderWidth: 1, height: 132, justifyContent: 'space-between', padding: 14 },
  topicTick: {
    alignItems: 'center',
    borderRadius: 999,
    height: 20,
    justifyContent: 'center',
    position: 'absolute',
    right: 10,
    top: 10,
    width: 20,
  },
  topicTickMark: { color: ON_ACCENT, fontSize: 11, fontWeight: '900' },
  topicLabel: { fontSize: 15, fontWeight: '800', lineHeight: 19 },
  topicEs: { color: 'rgba(94,230,168,0.7)', fontSize: 12, fontStyle: 'italic', fontWeight: '600', marginTop: 2 },
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
  steps: { marginTop: 14 },
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
  stepText: { color: TEXT, flex: 1, fontSize: 17, fontWeight: '700', lineHeight: 23 },
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
  planReadyGloss: { color: MUTED, fontSize: 13, fontWeight: '600', marginTop: -6, marginBottom: 10 },
  // ---- plan ready ----
  readyHero: { alignItems: 'center', flexDirection: 'row', gap: 14 },
  readyParrot: { height: 104, width: 93 },
  readyTitles: { flex: 1 },
  readySub: { color: TEXT, fontSize: 15, fontWeight: '600', lineHeight: 21 },
  readyDate: { color: MUTED, fontSize: 16, marginTop: 6 },
  readyDateStrong: { color: TEXT, fontWeight: '800' },
  readyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 22 },
  readyCell: { width: '48%' },
  readyTile: { borderRadius: 18, borderWidth: 1, minHeight: 96, padding: 14 },
  readyTileLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  readyTileHead: { color: TEXT, fontSize: 15, fontWeight: '700', lineHeight: 20, marginTop: 6 },
  planReadyText: { flex: 1, gap: 2 },
  planReadyHead: { color: TEXT, fontSize: 15, fontWeight: '700', lineHeight: 21 },
  planReadyBody: { color: MUTED, fontSize: 13, lineHeight: 19 },
  planTitle: {
    color: TEXT,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.4,
    lineHeight: 33,
    textAlign: 'center',
  },
  planRingSeat: { alignItems: 'center', marginTop: 22 },
  planChecks: { alignSelf: 'stretch', marginTop: 20, paddingHorizontal: 12 },
  planTotal: { alignItems: 'center', marginTop: 18 },
  planTotalLead: { color: MUTED, fontSize: 13, fontWeight: '600' },
  planTotalValue: {
    color: TEXT,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginTop: 4,
  },
  planTotalUnit: { color: ACCENT, fontSize: 22, fontWeight: '800' },
  planTotalBody: { color: MUTED, fontSize: 14, lineHeight: 19, marginTop: 2, textAlign: 'center' },
  planVerdict: {
    color: TEXT,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 19,
    marginTop: 10,
  },
  planSheet: {
    backgroundColor: CARD,
    borderColor: 'rgba(242,245,243,0.08)',
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 26,
    overflow: 'hidden',
  },
  planSheetRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  planSheetRowNext: { borderTopColor: 'rgba(242,245,243,0.08)', borderTopWidth: 1 },
  /** The row's name, in the accent, small caps, a fixed column so the text
      lines up down the sheet. */
  planLabel: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    lineHeight: 21,
    textTransform: 'uppercase',
    width: 58,
  },
  planText: {
    color: TEXT,
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 21,
  },
});
