import type { ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
import {
  BLANKS,
  CALIBRATION_INTRO,
  FREQUENCY,
  GRID,
  HANDOFF,
  HOOK,
  HOW_IT_WORKS,
  MOTIVATION,
  PAYWALL,
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
  motivation: string | null;
  selfLevel: SelfLevel | null;
  /** Surfaces tapped in the grid. The Set is the web's shape and feeds
      deriveLevel directly. */
  known: Set<string>;
  derived: Level | null;
  frequency: string | null;
};

export const INITIAL_FLOW: FlowState = {
  motivation: null,
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
      {/* The mascot's slot. Deliberately type, not an image: the web's
          LoroMascot is an SVG component, react-native-svg is NOT installed and
          is a native module, so porting it would cost a rebuild. A bundled
          PNG/WebP drops in here whenever the art exists. */}
      <Text style={styles.mark}>loro</Text>
      <Title>{HOOK.title}</Title>
    </Screen>
  );
}

// ------------------------------------------------------------ 2. motivation

function MotivationStep({ state, update, next }: StepProps) {
  return (
    <Screen>
      <Title>{MOTIVATION.title}</Title>
      <Body>{MOTIVATION.body}</Body>
      <View style={styles.choices} accessibilityRole="radiogroup">
        {MOTIVATION.options.map((option) => (
          <ChoiceCard
            key={option.id}
            label={option.label}
            body={option.body}
            selected={state.motivation === option.id}
            onPress={() => {
              setMotivation(option.id);
              update({ motivation: option.id });
              next();
            }}
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

// ------------------------------------------------------------- 10. paywall

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

// ------------------------------------------------------------- 11. handoff

function HandoffStep({ finish }: StepProps) {
  return (
    <Screen footer={<PrimaryButton label={HANDOFF.cta} onPress={finish} />}>
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
  { id: 'paywall', Component: PaywallStep, skip: () => !PAYWALL_ENABLED },
  { id: 'handoff', Component: HandoffStep },
];

/** The steps actually in play for this answer set, in order. */
export function visibleSteps(state: FlowState): StepDef[] {
  return STEPS.filter((step) => !step.skip?.(state));
}

const styles = StyleSheet.create({
  mark: {
    color: ACCENT,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 3,
    marginBottom: 18,
    textTransform: 'uppercase',
  },
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
});
