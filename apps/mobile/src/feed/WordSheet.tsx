import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Dimensions,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import type { Gloss, Video, Word } from '@loro/core/types';
import { glossText, lookupGloss, normalizeSurface } from '@loro/core/dictionary';
import { storage } from '@loro/core/storage';
import { usePlayerApi } from '../player/PlayerHost';

/**
 * The tap-a-word save sheet — the RN half of components/WordSheet.tsx.
 *
 * CONTENT IS A PORT, NOT A REDESIGN. The same four-way branch the web renders:
 * a per-word gloss when the dictionary has one, the `surface → lemma · pos`
 * line only when the lemma actually differs, the learner note, and the sentence
 * translation as labelled context. When there is NO dictionary entry it falls
 * back to the sentence translation marked "≈ approximate" rather than posing a
 * whole-line translation as a word gloss — that marking is the honest part and
 * is why this is copied rather than simplified.
 *
 * PAUSE ON OPEN, RESUME ON CLOSE — matched to the web's VideoSlide, where
 * handleWordTap pauses and handleSheetClose resumes if the slide is still
 * active. Owned here rather than by the caller so the two can never drift: the
 * sheet that paused is the sheet that resumes.
 *
 * WHAT THE WEB DOES NOT DO, and this does: show a word the user ALREADY has as
 * saved. The web resets `sheetSaved` to false on every tap, so a re-tap offers
 * "Save word" again — harmless there because storage.saveWord() is idempotent
 * (an existing text+videoId keeps its SRS schedule rather than resetting it).
 * Reading the real answer is a one-line synchronous lookup on RN and stops the
 * sheet inviting an action that does nothing.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * TWO SHELLS, ONE BODY, AND A FLAG. Read this before changing either shell.
 *
 * The content and the save path are in ONE place (WordSheetBody +
 * useWordSheetController). What differs is only how the panel gets on screen:
 *
 *   ModalShell   React Native's own <Modal>. Presents in its own native window,
 *                above every sibling view including the player WebView, with no
 *                dependence on measurement, portals, reanimated or the gesture
 *                handler. Driven declaratively by `visible` — there is no
 *                imperative present() that can silently no-op.
 *   SheetShell   @gorhom/bottom-sheet, kept because it is the nicer interaction
 *                (pan-down, backdrop fade) and is what the rest of the app will
 *                want. Not yet proven to present on this device.
 *
 * ModalShell is ACTIVE. Two fixes to the gorhom path have now failed on device,
 * and the failure mode is invisible-and-silent rather than an error, so the
 * shell that cannot fail that way is the one that ships. Flip USE_BOTTOM_SHEET
 * once the trace in the checkpoint notes shows the sheet reaching PRESENTED.
 * ───────────────────────────────────────────────────────────────────────────
 */
const USE_BOTTOM_SHEET = false;

/**
 * The gorhom sheet's height, in POINTS, resolved from the window at module
 * scope. THE RN MODAL NO LONGER USES THIS — it hugs its content (see
 * MAX_PANEL_HEIGHT below). This is the SheetShell's detent and nothing else.
 *
 * NOT a percentage, and that is the fix for a measured bug. A '55%' snap point
 * is a percentage of the SHEET'S CONTAINER, not of the window
 * (@gorhom/bottom-sheet utilities/normalizeSnapPoint.ts), and for a modal that
 * container height is published by a single empty measuring view mounted by
 * BottomSheetModalProvider. Until that view reports a height, the library
 * refuses to animate at all — useAnimatedDetents returns no detents, and
 * BottomSheet's isLayoutCalculated stays false, so the sheet sits at its
 * initial position of one full window height (i.e. entirely below the fold)
 * with no error and no dismissal. A number in points cannot express that bug.
 *
 * ⚠️ AND A PIXEL SNAP POINT IS NOT ON ITS OWN A FIX FOR IT. isLayoutCalculated
 * checks the container height SEPARATELY from the snap points (BottomSheet.tsx
 * "isContainerHeightCalculated"), and useAnimatedDetents early-exits on an
 * unmeasured container BEFORE it looks at the snap point at all. This removes
 * one of the two dependencies. App.tsx's initialMetrics fix removes the other.
 *
 * WHY 55%, CLAMPED. The tallest realistic content is the with-gloss case
 * carrying a note and a three-line sentence translation: ~314pt. The 360pt
 * floor keeps the save button above the fold on a 667pt SE; the window-80
 * ceiling keeps the handle reachable on any device. Content scrolls, so this
 * is a floor on what is visible, never a ceiling on what is reachable.
 */
const WINDOW_HEIGHT = Dimensions.get('window').height;
const SHEET_HEIGHT = Math.round(
  Math.min(Math.max(WINDOW_HEIGHT * 0.55, 360), WINDOW_HEIGHT - 80)
);
// Module scope, so the identity is stable across renders without a useMemo.
// Not `as const` — the prop's type is a mutable (string | number)[].
const SNAP_POINTS: number[] = [SHEET_HEIGHT];

/**
 * The RN Modal panel's CEILING, not its height.
 *
 * The panel is absolutely positioned with left/right/bottom pinned and no
 * `top` and no `height`, so Yoga sizes it to its content — "salida / exit"
 * gets a ~245pt panel instead of a 464pt one with 220pt of empty space under
 * the button. This cap is what stops a pathological translation growing the
 * panel to fill the screen: past it the TEXT area shrinks and scrolls (see
 * modalScroll's flexShrink) while the button stays pinned.
 *
 * 70% rather than something tighter because the cap should be unreachable by
 * real content — the tallest realistic shape (gloss + lemma line + note + a
 * three-line sentence) computes to ~319pt on an 844pt device, barely half of
 * the 591pt cap. A cap that engaged routinely would be a height in disguise.
 */
const MAX_PANEL_HEIGHT = Math.round(WINDOW_HEIGHT * 0.7);

export type WordSheetData = {
  video: Video;
  word: Word;
  /** Which cue the tapped word belongs to — the SRS replay anchor. */
  cueIndex: number;
};

type WordSheetProps = {
  data: WordSheetData | null;
  language: string;
  onClose: () => void;
  /**
   * Y of the band's top edge — i.e. the first pixel below the player area.
   * Measured by the feed (area.y + area.height) rather than guessed, because
   * the player box is sized from what the band leaves and the split moves with
   * the device. Null until the first layout lands.
   */
  bandTop: number | null;
};

/** What a shell needs on top of the public props: how to report a save. */
type ShellProps = WordSheetProps & {
  /** Called ONLY after saveWord() has returned a verified ok. */
  onSaved: (word: string) => void;
};

export function WordSheet(props: WordSheetProps) {
  /**
   * The saved-word confirmation, owned HERE rather than in a shell.
   *
   * It has to outlive the panel — the whole point is that it appears after the
   * panel has gone — and this component is mounted for the life of the feed
   * (FeedScreen renders it unconditionally), so the toast survives the
   * dismissal without any of the shells staying on screen for it. Owning it at
   * this level also means both shells get the confirmation, so flipping
   * USE_BOTTOM_SHEET does not quietly lose it.
   */
  const [savedWord, setSavedWord] = useState<string | null>(null);
  const handleSaved = useCallback((word: string) => setSavedWord(word), []);
  const handleToastDone = useCallback(() => setSavedWord(null), []);

  return (
    <>
      {/* A component swap, not a hook branch: each shell owns its own hooks, so
          flipping the flag cannot produce a changed hook order. */}
      {USE_BOTTOM_SHEET ? (
        <SheetShell {...props} onSaved={handleSaved} />
      ) : (
        <ModalShell {...props} onSaved={handleSaved} />
      )}
      <SavedBadge word={savedWord} bandTop={props.bandTop} onDone={handleToastDone} />
    </>
  );
}

/**
 * ~1010ms end to end, none of it blocking — the panel has already closed and
 * the video is already playing when this starts.
 *
 * Compare the recall celebration it is derived from: 350ms snap + 600ms bloom +
 * 650ms feather burst, held for 1200ms (SubtitleTrack.tsx celebrationTimer).
 */
const BADGE_IN_MS = 140;
const BADGE_SNAP_MS = 180;
const BADGE_SETTLE_MS = 120;
const BADGE_HOLD_MS = 650;
const BADGE_OUT_MS = 200;
/** The overshoot peak. The web's loro-snap starts at 1.25; this is a quarter of
    that excursion, which is the whole "scaled down, not ported" decision in one
    number. */
const BADGE_PEAK = 1.04;
const BADGE_FROM = 0.86;

/**
 * The save confirmation.
 *
 * DRIVEN BY THE VERIFIED RESULT, NEVER BY THE TAP. It is rendered only from
 * `savedWord`, which is only ever set on the true branch of `saveWord()` — and
 * that returns true only after core has read the key back out of MMKV
 * (storage.ts saveWord: `ok = wrote && getSavedWords().some(…)`). A failed save
 * takes the other branch, where the panel stays open and shows the existing
 * failure line; there is no path from a tap to this component.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THE TOP OF THE BAND AND NOT THE BOTTOM OF THE SCREEN.
 *
 * The previous version was anchored above the home indicator. That kept it
 * clear of the player, which was the point, but it put the confirmation exactly
 * where the panel had just slid away to — the eye has already left. The top of
 * the band is the first thing crossed coming back off the video, and it is
 * still structurally below the player, so the embed rule holds for the same
 * reason the band itself does rather than by arithmetic.
 *
 * `bandTop` is MEASURED, not derived from the player box. Sitting a fixed
 * offset under box.top + box.height would put this in the letterbox gap on a
 * device where the 9:16 box is narrower than its area — technically not over
 * the WebView, but inside the region reserved for it, which is not a line worth
 * standing near. If the measurement has not landed yet, nothing renders.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * THE MOTION IS THE RECALL CELEBRATION, SCALED DOWN. Kept: the overshoot snap
 * (Easing.back is loro-snap's cubic-bezier(0.3,1.4,0.4,1) in RN terms) and the
 * accent + check. Dropped: the seven-feather burst, the mascot hop, the
 * text-shadow bloom. Those mark a moment the user earned; a save is lighter and
 * far more frequent, and spending the celebration on it devalues the one that
 * matters.
 *
 * REDUCED MOTION DEGRADES TO A FADE, matching what globals.css does for
 * .animate-correct under prefers-reduced-motion — colour and copy carry the
 * message, the scale drops out entirely.
 *
 * pointerEvents="none" so it cannot eat a tap on the chips underneath; it is a
 * readout, not a control, and there is nothing to dismiss.
 */
function SavedBadge({
  word,
  bandTop,
  onDone,
}: {
  word: string | null;
  bandTop: number | null;
  onDone: () => void;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(BADGE_FROM)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (alive) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion
    );
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!word) return;
    opacity.setValue(0);
    scale.setValue(reduceMotion ? 1 : BADGE_FROM);

    const entrance = reduceMotion
      ? Animated.timing(opacity, {
          toValue: 1,
          duration: BADGE_IN_MS,
          useNativeDriver: true,
        })
      : Animated.parallel([
          Animated.timing(opacity, {
            toValue: 1,
            duration: BADGE_IN_MS,
            useNativeDriver: true,
          }),
          // Easing.back overshoots past the target and settles — the RN
          // expression of loro-snap's spring curve, at a quarter the excursion.
          Animated.sequence([
            Animated.timing(scale, {
              toValue: BADGE_PEAK,
              duration: BADGE_SNAP_MS,
              easing: Easing.out(Easing.back(2)),
              useNativeDriver: true,
            }),
            Animated.timing(scale, {
              toValue: 1,
              duration: BADGE_SETTLE_MS,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
          ]),
        ]);

    const animation = Animated.sequence([
      entrance,
      Animated.delay(BADGE_HOLD_MS),
      Animated.timing(opacity, {
        toValue: 0,
        duration: BADGE_OUT_MS,
        useNativeDriver: true,
      }),
    ]);
    // Clearing the word on completion is what unmounts this — the timer is the
    // animation's own, so there is no setTimeout to leak. `finished` is false
    // when stop() ran below, and clearing then would fight the save that
    // interrupted us.
    animation.start(({ finished }) => {
      if (finished) onDone();
    });
    return () => animation.stop();
  }, [word, opacity, scale, reduceMotion, onDone]);

  if (!word || bandTop === null) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.badgeLayer, { top: bandTop + 8, opacity }]}
    >
      <Animated.View style={[styles.badgePill, { transform: [{ scale }] }]}>
        <Text style={styles.badgeCheck}>✓</Text>
        <Text style={styles.badgeText} numberOfLines={1}>
          Saved · {word}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

// ------------------------------------------------------------- shared logic

/**
 * Everything that is not "how does the panel get on screen": the pause/resume
 * pairing, the already-saved lookup, and the verified write.
 *
 * Shared by both shells so the save path cannot drift between them — the whole
 * point of the split is that only the presentation differs.
 */
function useWordSheetController(
  data: WordSheetData | null,
  language: string,
  onClose: () => void
) {
  const api = usePlayerApi();

  /**
   * Whether the tapped word is already in the SRS.
   *
   * Seeded from storage on open and flipped locally on a verified save, rather
   * than re-read on every render: getSavedWords() parses the whole word list
   * out of MMKV, and the answer cannot change while the sheet is the only
   * thing on screen.
   */
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);

  const gloss = useMemo<Gloss | null>(
    () => (data ? lookupGloss(data.video, data.word.text) : null),
    [data]
  );

  useEffect(() => {
    if (!data) return;
    // The dedupe key is core's, exactly: text + videoId, NOT cueIndex. The same
    // word from a different cue is the same card (storage.ts saveWord).
    setSaved(
      storage
        .getSavedWords()
        .some((w) => w.text === data.word.text && w.videoId === data.video.id)
    );
    setFailed(false);
    // Pause BEFORE the panel appears so the frame the user is reading is the
    // frame the word was spoken in.
    api.pause();
  }, [data, api]);

  /** Resume and clear. The one path out, whichever shell called it. */
  const close = useCallback(() => {
    api.play();
    onClose();
  }, [api, onClose]);

  /** Returns true only on a VERIFIED write, so the shell can then dismiss. */
  const saveWord = useCallback((): boolean => {
    if (!data || saved) return false;
    const cue = data.video.cues[data.cueIndex];
    const wordGloss = gloss ? glossText(gloss, language) : null;
    // IDENTICAL to the web's handleSave: the per-word gloss becomes the recall
    // prompt in checkpoint F's blanks, and the sentence translation is only a
    // last-resort fallback. Saving the sentence as a word's translation would
    // make the SRS prompt unanswerable.
    const { ok } = storage.saveWord({
      text: data.word.text,
      translation:
        wordGloss ?? cue?.translations[language] ?? cue?.translations.en ?? '',
      videoId: data.video.id,
      cueIndex: data.cueIndex,
    });
    // Only a VERIFIED write reports success — saveWord returns ok only after
    // reading the key back. A failed save must look failed.
    if (ok) {
      setSaved(true);
      return true;
    }
    setFailed(true);
    return false;
  }, [data, saved, gloss, language]);

  return { saved, failed, gloss, close, saveWord };
}

// ------------------------------------------------------------- the RN Modal

/**
 * The shell that cannot silently fail.
 *
 * <Modal> is presented by the platform in its own window, so it is above the
 * player WebView by construction rather than by sibling order, and `visible` is
 * a prop rather than an imperative call — there is no ref that can be null, no
 * requestAnimationFrame to miss, and no measurement to wait on. onShow is a
 * REAL presentation confirmation from the platform, which is exactly the signal
 * the gorhom path never produced.
 */
function ModalShell({ data, language, onClose, onSaved }: ShellProps) {
  const insets = useSafeAreaInsets();
  const { saved, failed, gloss, close, saveWord } = useWordSheetController(
    data,
    language,
    onClose
  );

  /**
   * The content to DRAW, which is not the same as the content that is live.
   *
   * `data` goes null and `visible` goes false in the same commit, but the
   * platform still has a slide-out animation to play. Drawing from `data` would
   * empty the panel mid-flight, and now that the panel hugs its content that
   * shows as a collapse to a bare handle strip rather than as a fixed-height
   * rectangle nobody notices. Holding the last non-null value keeps the panel
   * the size it was while it leaves.
   *
   * Presentation only: every interaction still runs off the controller's real
   * `data`, and nothing is interactive once `visible` is false.
   */
  /**
   * THE GLOSS IS HELD OVER WITH IT, and leaving it out defeated the hold.
   *
   * `gloss` is memoised on `data` in the controller, so it goes null in the
   * same commit `data` does — while `shown` keeps the word. WordSheetText
   * branches on the gloss, so for the length of the slide-out the panel
   * switched from the with-gloss shape (word + gloss + lemma + note + labelled
   * context) to the no-entry fallback (word + "≈ …" + one label). The panel
   * hugs its content, so that is not just a text swap: it is a visible
   * collapse of ~100pt WHILE the panel is sliding away, which reads as the
   * sheet jumping. Exactly the failure the note above says holding `shown`
   * exists to prevent — it just fixed one of the two inputs.
   *
   * The controller's live `gloss` is untouched and still what saveWord reads;
   * only what is DRAWN is held. Both refs are written in the same branch, so
   * the word and its gloss can never be a frame out of step.
   */
  const lastShown = useRef<WordSheetData | null>(null);
  const lastGloss = useRef<Gloss | null>(null);
  if (data) {
    lastShown.current = data;
    lastGloss.current = gloss;
  }
  const shown = data ?? lastShown.current;
  const shownGloss = data ? gloss : lastGloss.current;

  return (
    <Modal
      visible={data !== null}
      transparent
      animationType="slide"
      // Android's hardware back. Harmless on iOS, required for parity.
      onRequestClose={close}
      statusBarTranslucent
    >
      {/* Tap-outside-to-close, and the dim. Behind the panel, so it never
          intercepts a press meant for the save button. */}
      <Pressable style={styles.backdrop} onPress={close} />
      <View style={[styles.panel, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.handleRow}>
          <View style={styles.handle} />
        </View>
        {/* ONLY THE TEXT SCROLLS. The button is a sibling below, so it is
            visible without scrolling in every content shape — including the
            one that overflows the cap, which is the shape a button at the end
            of a scroll view would hide. */}
        <ScrollView
          style={styles.modalScroll}
          contentContainerStyle={styles.modalScrollContent}
        >
          <WordSheetText data={shown} language={language} gloss={shownGloss} />
        </ScrollView>
        {shown && (
          <View style={styles.modalFooter}>
            <WordSheetAction
              saved={saved}
              failed={failed}
              onSave={() => {
                // The false branch is the failure path and must stay untouched:
                // no toast, no close, panel keeps showing the failure line.
                if (!saveWord()) return;
                if (data) onSaved(data.word.text);
                close();
              }}
            />
          </View>
        )}
      </View>
    </Modal>
  );
}

// -------------------------------------------------------- the gorhom sheet

/** The nicer interaction, kept and fixed but not yet proven on device. */
function SheetShell({ data, language, onClose, onSaved }: ShellProps) {
  const sheetRef = useRef<BottomSheetModal>(null);
  const { saved, failed, gloss, close, saveWord } = useWordSheetController(
    data,
    language,
    onClose
  );

  useEffect(() => {
    if (!data) {
      sheetRef.current?.dismiss();
      return;
    }
    sheetRef.current?.present();
  }, [data]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
      />
    ),
    []
  );

  return (
    <BottomSheetModal
      ref={sheetRef}
      onDismiss={close}
      // POINTS, not a percentage — see SHEET_HEIGHT.
      snapPoints={SNAP_POINTS}
      // MUST be explicit. enableDynamicSizing defaults to TRUE in v5, so
      // passing snapPoints alone does not switch it off.
      enableDynamicSizing={false}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handle}
    >
      <BottomSheetScrollView contentContainerStyle={styles.content}>
        <WordSheetBody
          data={data}
          language={language}
          gloss={gloss}
          saved={saved}
          failed={failed}
          onSave={() => {
            if (!saveWord()) return;
            if (data) onSaved(data.word.text);
            sheetRef.current?.dismiss();
          }}
        />
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

// -------------------------------------------------------------- the content

/**
 * The body is split in two, and the split is what makes the panel hug.
 *
 *   WordSheetText     everything that can grow without bound — the four-way
 *                     branch. The Modal puts this, and only this, in a
 *                     ScrollView.
 *   WordSheetAction   the save button and its failure line. Fixed height, and
 *                     it must never be the thing that scrolls out of reach.
 *
 * The gorhom shell keeps rendering both inside one BottomSheetScrollView via
 * WordSheetBody below, because its height is a fixed detent (SNAP_POINTS) and
 * a pinned footer there would need the library's own footerComponent. Nothing
 * about that path changes.
 */
function WordSheetText({
  data,
  language,
  gloss,
}: {
  data: WordSheetData | null;
  language: string;
  gloss: Gloss | null;
}) {
  if (!data) return null;

  const cue = data.video.cues[data.cueIndex];
  const contextTranslation =
    cue?.translations[language] ?? cue?.translations.en ?? '';
  const wordGloss = gloss ? glossText(gloss, language) : null;
  const surface = normalizeSurface(data.word.text);
  const showLemma = Boolean(gloss && wordGloss && gloss.lemma !== surface);

  return (
    <>
      <Text style={styles.word}>{data.word.text}</Text>

      {wordGloss ? (
        <>
          <Text style={styles.gloss}>{wordGloss}</Text>
          {showLemma && (
            <Text style={styles.lemma}>
              {surface} → {gloss?.lemma} · {gloss?.pos}
            </Text>
          )}
          {gloss?.note ? <Text style={styles.note}>{gloss.note}</Text> : null}
          <Text style={styles.context}>
            In this sentence:{' '}
            <Text style={styles.contextBody}>{contextTranslation}</Text>
          </Text>
        </>
      ) : (
        <>
          <Text style={styles.approxBody}>≈ {contextTranslation}</Text>
          <Text style={styles.approxLabel}>
            approximate — whole-sentence translation
          </Text>
        </>
      )}
    </>
  );
}

function WordSheetAction({
  saved,
  failed,
  onSave,
}: {
  saved: boolean;
  failed: boolean;
  onSave: () => void;
}) {
  return (
    <>
      <Pressable
        onPress={onSave}
        disabled={saved}
        style={({ pressed }) => [
          styles.saveButton,
          saved && styles.saveButtonSaved,
          pressed && !saved && styles.saveButtonPressed,
        ]}
      >
        <Text style={[styles.saveLabel, saved && styles.saveLabelSaved]}>
          {saved ? '✓ Saved' : 'Save word'}
        </Text>
      </Pressable>

      {failed && (
        <Text style={styles.failed}>Could not save — storage unavailable</Text>
      )}
    </>
  );
}

/** Text + action in one scrollable run — the shape the gorhom shell wants. */
function WordSheetBody({
  data,
  language,
  gloss,
  saved,
  failed,
  onSave,
}: {
  data: WordSheetData | null;
  language: string;
  gloss: Gloss | null;
  saved: boolean;
  failed: boolean;
  onSave: () => void;
}) {
  if (!data) return null;
  return (
    <>
      <WordSheetText data={data} language={language} gloss={gloss} />
      <WordSheetAction saved={saved} failed={failed} onSave={onSave} />
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  /**
   * NO `height`, and NO `top`. left/right/bottom pinned with both vertical
   * sizes unset is what makes Yoga measure the panel from its children — the
   * hug. maxHeight is the only bound.
   */
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: MAX_PANEL_HEIGHT,
    backgroundColor: '#121814',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  /**
   * flexShrink IS LOAD-BEARING. RN children default to flexShrink: 0, so once
   * the content exceeds MAX_PANEL_HEIGHT this ScrollView would keep its full
   * content height and overflow the clamped panel — pushing the footer off the
   * bottom of the screen instead of scrolling. Allowing it to shrink is what
   * turns the cap into "the text scrolls" rather than "the button is gone".
   */
  modalScroll: { flexShrink: 1 },
  /** paddingBottom is small: the footer's button carries marginTop 24. */
  modalScrollContent: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 4 },
  modalFooter: { paddingHorizontal: 24 },
  handleRow: { alignItems: 'center', paddingTop: 10, paddingBottom: 2 },
  handle: {
    backgroundColor: 'rgba(242,245,243,0.3)',
    borderRadius: 2,
    height: 4,
    width: 36,
  },
  sheetBackground: { backgroundColor: '#121814' },
  content: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 40 },
  word: { color: '#f2f5f3', fontSize: 30, fontWeight: '700', letterSpacing: -0.5 },
  gloss: { color: '#5ee6a8', fontSize: 20, fontWeight: '600', marginTop: 6 },
  lemma: { color: 'rgba(242,245,243,0.5)', fontSize: 12, marginTop: 6 },
  note: {
    color: 'rgba(242,245,243,0.5)',
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 4,
  },
  context: { color: 'rgba(242,245,243,0.4)', fontSize: 12, lineHeight: 18, marginTop: 12 },
  contextBody: { color: 'rgba(242,245,243,0.7)' },
  approxBody: { color: 'rgba(242,245,243,0.85)', fontSize: 16, lineHeight: 23, marginTop: 6 },
  approxLabel: { color: 'rgba(251,191,36,0.9)', fontSize: 12, marginTop: 4 },
  saveButton: {
    alignItems: 'center',
    backgroundColor: '#5ee6a8',
    borderRadius: 16,
    justifyContent: 'center',
    marginTop: 24,
    paddingVertical: 14,
  },
  saveButtonSaved: { backgroundColor: 'rgba(94,230,168,0.16)' },
  saveButtonPressed: { opacity: 0.85 },
  saveLabel: { color: '#06130d', fontSize: 16, fontWeight: '700' },
  saveLabelSaved: { color: '#5ee6a8' },
  failed: {
    color: 'rgba(251,191,36,0.9)',
    fontSize: 13,
    marginTop: 10,
    textAlign: 'center',
  },
  /** Full-width row so the pill centres itself; `top` is set inline from the
      MEASURED band edge — never a constant, and never derived from the player
      box. See the note on SavedBadge. */
  badgeLayer: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  badgePill: {
    alignItems: 'center',
    backgroundColor: 'rgba(10,13,11,0.94)',
    borderColor: 'rgba(94,230,168,0.55)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    maxWidth: '86%',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  badgeCheck: { color: '#5ee6a8', fontSize: 15, fontWeight: '800' },
  badgeText: { color: '#5ee6a8', fontSize: 14, fontWeight: '700' },
});
