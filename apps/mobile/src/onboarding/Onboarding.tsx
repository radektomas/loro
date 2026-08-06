import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { storage } from '@loro/core/storage';
import { CHROME } from './copy';
import { SLIDE_MS, olog } from './flow';
import {
  INITIAL_FLOW,
  visibleSteps,
  type FlowState,
  type StepId,
} from './steps';

/**
 * CHECKPOINT H — the onboarding host.
 *
 * HAND-ROLLED, AND THE SHAPE IS WHY. This is a LINE, not a graph: no back
 * stack to preserve, no deep links, no route params, no tabs. A navigation
 * library would model it as a stack it does not have, and both
 * @react-navigation/* and expo-router pull react-native-screens — a native
 * module, so an EAS rebuild, and specifically the module Shell.tsx already
 * documents as the one thing that would destroy the persistent WebView, since
 * detaching inactive screens natively is exactly what it exists to do. What a
 * library would buy is the slide below (Reanimated is already installed) and a
 * swipe-back gesture (not offered here). That is the whole trade.
 *
 * POSITION KEYED BY ID, NOT BY NUMBER. `currentId` is a StepId rather than an
 * index because the step list is not fixed: answering "starting from zero"
 * removes three screens from it. An index into a list that changes underneath
 * points at a different screen after the change; an id does not.
 *
 * THE ROW IS ONE TRANSFORM. Every in-play step is rendered side by side in a
 * row `n * width` wide and the row is translated — so a transition is a single
 * shared value with a single withTiming, entirely on the UI thread, with no
 * mount or unmount mid-animation. Eleven static screens cost nothing to keep
 * mounted; the feed's FlashList and the tab bar are NOT among them, because
 * this component renders instead of Shell rather than inside it (App.tsx).
 */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();

  const [state, setState] = useState<FlowState>(INITIAL_FLOW);
  const [currentId, setCurrentId] = useState<StepId>('hook');

  /**
   * A synchronous mirror of the flow state.
   *
   * The screens patch and advance in ONE handler — pick "starting from zero",
   * then move on. React state does not update until the next render, so a
   * `next()` reading it would compute the step list from the PREVIOUS answer
   * and land on the calibration grid the answer just removed. The ref is
   * written before setState, so navigation always sees the answer that caused
   * it.
   */
  const stateRef = useRef(state);

  const steps = useMemo(() => visibleSteps(state), [state]);
  const index = Math.max(
    0,
    steps.findIndex((step) => step.id === currentId)
  );

  const x = useSharedValue(0);
  useEffect(() => {
    x.value = withTiming(-index * width, {
      duration: reducedMotion ? 0 : SLIDE_MS,
    });
  }, [index, width, reducedMotion, x]);
  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  const update = useCallback((patch: Partial<FlowState>) => {
    stateRef.current = { ...stateRef.current, ...patch };
    setState(stateRef.current);
  }, []);

  /** Mirrors currentId for the same reason stateRef mirrors state. */
  const currentIdRef = useRef<StepId>(currentId);

  const goBy = useCallback((delta: number) => {
    // Recomputed from the ref rather than from `steps`: the same handler may
    // have just changed which steps are in play.
    const live = visibleSteps(stateRef.current);
    const at = live.findIndex((step) => step.id === currentIdRef.current);
    const target = live[Math.min(Math.max(at + delta, 0), live.length - 1)];
    if (!target || target.id === currentIdRef.current) return false;
    currentIdRef.current = target.id;
    setCurrentId(target.id);
    olog(`step -> ${target.id}`);
    return true;
  }, []);

  const next = useCallback(() => {
    goBy(1);
  }, [goBy]);
  const back = useCallback(() => goBy(-1), [goBy]);

  /**
   * The web's finish(), app/welcome/page.tsx:131-134: commit the flag, then
   * leave. Skip lands here too — that is the web's behaviour, and it is the
   * right one: a user who skips has still been offered the intro, and showing
   * it again on every launch would be a nag rather than a flow.
   *
   * Note what finishing does NOT write: no startLevel if they skipped before
   * the grid, and that is correct. Feed order falls back to catalog order when
   * the level is null rather than guessing one.
   */
  const finish = useCallback(() => {
    storage.setOnboarded();
    olog(
      `finished — onboarded=1 selfLevel=${storage.getSelfLevel() ?? 'none'} ` +
        `startLevel=${storage.getStartLevel() ?? 'none'} ` +
        `calibrationKnown=${storage.getCalibrationKnown().length}`
    );
    onDone();
  }, [onDone]);

  /**
   * Android's hardware back walks the flow instead of closing the app —
   * returning true swallows the event. At screen 1 it returns false, so the
   * OS does its default thing (exit), which is what a user pressing back on
   * the first screen of an intro means.
   *
   * BackHandler is React Native core. iOS has no hardware back and the
   * subscription is a no-op there, but the listener is registered on both
   * rather than branching — RN's own guidance, and one code path is one thing
   * to be wrong.
   */
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () =>
      back()
    );
    return () => subscription.remove();
  }, [back]);

  const canGoBack = index > 0;

  return (
    <View style={styles.root}>
      {/* Chrome sits ABOVE the row and does not move with it: a progress bar
          that slid off screen with its own screen would be a strange thing. */}
      <View style={[styles.chrome, { paddingTop: insets.top + 8 }]}>
        <View style={styles.chromeSide}>
          {canGoBack && (
            <Pressable
              onPress={back}
              accessibilityRole="button"
              accessibilityLabel={CHROME.back}
              hitSlop={10}
              style={({ pressed }) => [styles.chromeButton, pressed && styles.pressed]}
            >
              <Text style={styles.chromeButtonText}>‹</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.track}>
          {/* Width in percent, so it needs no measurement and stays right on
              rotation. Steps, not screens: the bar reflects the flow the user
              is actually in, which is three shorter on the 'zero' path. */}
          <View
            style={[
              styles.trackFill,
              { width: `${((index + 1) / steps.length) * 100}%` },
            ]}
          />
        </View>

        <View style={[styles.chromeSide, styles.chromeSideEnd]}>
          <Pressable
            onPress={finish}
            accessibilityRole="button"
            accessibilityLabel={CHROME.skip}
            hitSlop={10}
            style={({ pressed }) => [styles.chromeButton, pressed && styles.pressed]}
          >
            <Text style={styles.skipText}>{CHROME.skip}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.viewport}>
        <Animated.View style={[styles.row, { width: width * steps.length }, rowStyle]}>
          {steps.map((step, i) => (
            <View
              key={step.id}
              style={{ width }}
              // Only the screen on stage takes touches. The viewport clips the
              // others, but a clipped subview is still hit-testable on iOS.
              pointerEvents={i === index ? 'auto' : 'none'}
              accessibilityElementsHidden={i !== index}
              importantForAccessibility={
                i === index ? 'auto' : 'no-hide-descendants'
              }
            >
              <step.Component
                state={state}
                update={update}
                next={next}
                finish={finish}
                // Anything animated or timed keys off this rather than off
                // mount — see StepProps.isCurrent. Every screen is mounted
                // from the start, so without it the building-plan loader
                // would run, finish and advance the flow from off-stage.
                isCurrent={i === index}
              />
            </View>
          ))}
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: '#0a0d0b', flex: 1 },
  chrome: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingBottom: 10,
    paddingHorizontal: 16,
  },
  /** Fixed side widths so the bar between them is centred and does not jump
      when the back button appears on screen 2. */
  chromeSide: { justifyContent: 'center', width: 52 },
  chromeSideEnd: { alignItems: 'flex-end' },
  chromeButton: { paddingVertical: 4 },
  chromeButtonText: {
    color: 'rgba(242,245,243,0.6)',
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 26,
  },
  skipText: { color: 'rgba(242,245,243,0.45)', fontSize: 14, fontWeight: '600' },
  track: {
    backgroundColor: 'rgba(242,245,243,0.10)',
    borderRadius: 999,
    flex: 1,
    height: 4,
    overflow: 'hidden',
  },
  trackFill: { backgroundColor: '#5ee6a8', borderRadius: 999, height: '100%' },
  /** overflow:'hidden' is what keeps the off-stage screens off screen — the
      row is wider than the window by design. */
  viewport: { flex: 1, overflow: 'hidden' },
  row: { flex: 1, flexDirection: 'row' },
  pressed: { opacity: 0.6 },
});
