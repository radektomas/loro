import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SavedWord, Video } from '@loro/core/types';
import { getCatalog } from '@loro/core/catalog';
import { normalizeSurface } from '@loro/core/dictionary';
import {
  EXPLANATION_LANGS,
  type ExplanationLang,
  type WordExplanation,
} from '@loro/core/explanations';
import {
  findWordOccurrences,
  pickReplayOccurrence,
  type WordOccurrence,
} from '@loro/core/occurrences';
import { formatDue, MAX_BOX } from '@loro/core/srs';
import { storage } from '@loro/core/storage';
import { getExplanations } from '../platform/explanations';
import { HearItModal } from './HearItModal';

/**
 * The word-detail sheet on the Words tab — tap a row, get everything the app
 * knows about that word: translation, schedule, the pregenerated explanation
 * (usage note, grammar, register — see core/explanations.ts), real example
 * sentences from the catalog, and the "hear it in a video" jump.
 *
 * THE SHELL IS feed/WordSheet.tsx's ModalShell, deliberately: RN's own
 * <Modal>, driven by `visible`, panel hugging its content with a max-height
 * cap and only the text scrolling. That shell shipped because it cannot
 * silently fail on device (the gorhom path did, twice) — this inherits the
 * verdict rather than re-litigating it.
 *
 * EXPLANATIONS ARE A NICETY, STRUCTURALLY. getExplanations() resolves null on
 * anything short of a validated blob (offline, not yet published, broken
 * publish) and the section simply does not render — the sheet is complete
 * without it. Never a spinner that blocks the words the user already owns.
 *
 * EXAMPLES ARE REAL CUES, resolved from the catalog by {videoId, cueIndex} at
 * render time. A reference can dangle — the blob and the catalog publish
 * independently, and videos get pruned — so a missing video or cue skips that
 * example silently (the renderer's case to handle, per explanations.ts).
 */

const WINDOW_HEIGHT = Dimensions.get('window').height;
const MAX_PANEL_HEIGHT = Math.round(WINDOW_HEIGHT * 0.8);

/** The user's gloss language if the explanations carry it, else English. */
function explanationLang(): ExplanationLang {
  const lang = storage.getLanguage();
  return (EXPLANATION_LANGS as readonly string[]).includes(lang)
    ? (lang as ExplanationLang)
    : 'en';
}

/** The spoken sentence of a cue — cues carry words, not a text field. */
function cueSentence(video: Video, cueIndex: number): string | null {
  const cue = video.cues[cueIndex];
  if (!cue || cue.words.length === 0) return null;
  return cue.words.map((w) => w.text).join(' ');
}

const REGISTER_LABEL: Record<string, string> = {
  informal: 'informal',
  formal: 'formal',
  slang: 'slang',
};

export function WordDetailSheet({
  word,
  onClose,
  onRemove,
  onReview,
}: {
  word: SavedWord | null;
  onClose: () => void;
  /** Called after the user confirms removal; the caller owns the storage call. */
  onRemove: (word: SavedWord) => void;
  /** Arm a review session and switch to the feed. The sheet closes first. */
  onReview: () => void;
}) {
  const insets = useSafeAreaInsets();

  const [explanations, setExplanations] =
    useState<ReadonlyMap<string, WordExplanation> | null>(null);
  const [loadingExplanations, setLoadingExplanations] = useState(false);
  const [hearing, setHearing] = useState<WordOccurrence | null>(null);

  // Lazy-load on first open of ANY word — one fetch/parse per process, then
  // every later open is a map lookup.
  useEffect(() => {
    if (!word || explanations !== null) return;
    let live = true;
    setLoadingExplanations(true);
    void getExplanations().then((map) => {
      if (!live) return;
      setLoadingExplanations(false);
      if (map) setExplanations(map);
    });
    return () => {
      live = false;
    };
  }, [word, explanations]);

  /**
   * Held-over content for the slide-out animation, exactly ModalShell's trick
   * (feed/WordSheet.tsx): `word` goes null and `visible` false in the same
   * commit, but the platform still plays the exit animation — drawing from
   * the live prop would collapse the panel mid-flight.
   */
  const lastShown = useRef<SavedWord | null>(null);
  if (word) lastShown.current = word;
  const shown = word ?? lastShown.current;

  /**
   * The word's catalog record + its explanation + the replay occurrence, all
   * derived from `shown` in one place. The catalog scan (findWordOccurrences)
   * is a per-open fold over ~39k word tokens — single-digit milliseconds, and
   * memoised for the sheet's lifetime, so no index to build or invalidate.
   */
  const derived = useMemo(() => {
    if (!shown) return null;
    const catalog = getCatalog();
    const sourceVideo = catalog.find((v) => v.id === shown.videoId) ?? null;
    const occurrences = findWordOccurrences(catalog, shown.text);
    const hearOccurrence = pickReplayOccurrence(
      occurrences,
      { videoId: shown.videoId, cueIndex: shown.cueIndex },
      { requireYoutube: true }
    );
    return { catalog, sourceVideo, hearOccurrence };
  }, [shown]);

  /**
   * Surface -> lemma, walked through the dictionaries the same way WordSheet
   * does (lookupGloss keys on normalizeSurface). The source video's dictionary
   * is authoritative; any other video that glosses the word is a fallback —
   * the same lemma by construction of the gloss pipeline.
   */
  const explanation = useMemo(() => {
    if (!shown || !explanations || !derived) return null;
    const key = normalizeSurface(shown.text);
    if (!key) return null;
    const videos = derived.sourceVideo
      ? [derived.sourceVideo, ...derived.catalog]
      : derived.catalog;
    for (const video of videos) {
      const gloss = video.dictionary?.[key];
      if (gloss) return explanations.get(gloss.lemma) ?? null;
    }
    return null;
  }, [shown, explanations, derived]);

  const lang = explanationLang();
  const now = Date.now();

  if (!shown) {
    // Nothing was ever shown — render the (closed) Modal so the first open
    // animates from a mounted component.
    return null;
  }

  const stateLabel: Record<SavedWord['state'], string> = {
    lapsed: 'Slipped — review soon',
    new: 'Just saved',
    learning: 'Getting it',
    known: 'Learned ✓',
  };

  return (
    <Modal
      visible={word !== null}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.panel, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.handleRow}>
          <View style={styles.handle} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
        >
          <Text style={styles.word}>{shown.text}</Text>
          <Text style={styles.translation}>{shown.translation}</Text>

          {/* The schedule, in the vocab list's own vocabulary. */}
          <View style={styles.srsRow}>
            <Text style={styles.srsState}>{stateLabel[shown.state]}</Text>
            <View style={styles.meter} accessibilityRole="image"
              accessibilityLabel={`${shown.box} of ${MAX_BOX} toward learned`}>
              {Array.from({ length: MAX_BOX }, (_, i) => (
                <View
                  key={i}
                  style={[
                    styles.meterDot,
                    i < shown.box ? styles.meterOn : styles.meterOff,
                  ]}
                />
              ))}
            </View>
            <Text style={styles.srsDue}>
              {shown.dueAt <= now ? 'Ready now' : `Review ${formatDue(shown.dueAt, now)}`}
            </Text>
          </View>

          {/* The pregenerated explanation — absent without comment when the
              blob has nothing (or has not arrived). */}
          {explanation && (
            <View style={styles.explainBlock}>
              <Text style={styles.explainUsage}>{explanation.usage[lang]}</Text>
              {explanation.grammar && (
                <Text style={styles.explainGrammar}>{explanation.grammar[lang]}</Text>
              )}
              <View style={styles.chipRow}>
                <Text style={styles.posChip}>{explanation.pos}</Text>
                {explanation.register && REGISTER_LABEL[explanation.register] && (
                  <Text style={styles.registerChip}>
                    {REGISTER_LABEL[explanation.register]}
                  </Text>
                )}
              </View>

              {/* Real spoken sentences, never invented ones. */}
              {explanation.examples.map((example, i) => {
                const video = derived?.catalog.find((v) => v.id === example.videoId);
                if (!video) return null;
                const sentence = cueSentence(video, example.cueIndex);
                if (!sentence) return null;
                const cueTranslation =
                  video.cues[example.cueIndex]?.translations[lang] ??
                  video.cues[example.cueIndex]?.translations.en ??
                  null;
                return (
                  <View key={`${example.videoId}-${example.cueIndex}-${i}`}
                    style={styles.example}>
                    <Text style={styles.exampleEs}>“{sentence}”</Text>
                    {cueTranslation && (
                      <Text style={styles.exampleTr}>{cueTranslation}</Text>
                    )}
                  </View>
                );
              })}
            </View>
          )}
          {!explanation && loadingExplanations && (
            <View style={styles.explainLoading}>
              <ActivityIndicator color="rgba(242,245,243,0.4)" size="small" />
            </View>
          )}
        </ScrollView>

        <View style={styles.footer}>
          {/* The primary action: practise it. Recall is what the app is FOR,
              so it leads — hearing the word is the warm-up, not the goal. */}
          <Pressable
            onPress={() => {
              onClose();
              onReview();
            }}
            accessibilityRole="button"
            accessibilityHint="Opens the feed with your due words as blanks"
            style={({ pressed }) => [styles.reviewButton, pressed && styles.pressed]}
          >
            <Text style={styles.reviewLabel}>Review in the feed</Text>
          </Pressable>

          {/* Jump to a video that speaks this word. Hidden, not disabled, when
              there is nowhere to jump: 67% of words occur in exactly one
              video, and a dead button teaches people to stop pressing live
              ones. */}
          {derived?.hearOccurrence && (
            <Pressable
              onPress={() => setHearing(derived.hearOccurrence)}
              accessibilityRole="button"
              accessibilityHint="Opens a video where this word is spoken"
              style={({ pressed }) => [styles.hearButton, pressed && styles.pressed]}
            >
              <Text style={styles.hearLabel}>▶ Hear it in a video</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => {
              if (word) onRemove(word);
              onClose();
            }}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${shown.text}`}
            style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
          >
            <Text style={styles.removeLabel}>Remove from my words</Text>
          </Pressable>
        </View>

        {/* Nested inside this Modal's hierarchy so iOS stacks them cleanly. */}
        <HearItModal
          occurrence={hearing}
          word={shown.text}
          video={
            hearing
              ? (derived?.catalog.find((v) => v.id === hearing.videoId) ?? null)
              : null
          }
          onClose={() => setHearing(null)}
          onReview={() => {
            onClose();
            onReview();
          }}
        />
      </View>
    </Modal>
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
  handleRow: { alignItems: 'center', paddingTop: 10, paddingBottom: 2 },
  handle: {
    backgroundColor: 'rgba(242,245,243,0.3)',
    borderRadius: 2,
    height: 4,
    width: 36,
  },
  scroll: { flexShrink: 1 },
  scrollContent: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 4 },
  footer: { paddingHorizontal: 24 },
  word: { color: '#f2f5f3', fontSize: 30, fontWeight: '700', letterSpacing: -0.5 },
  translation: { color: '#5ee6a8', fontSize: 20, fontWeight: '600', marginTop: 6 },
  srsRow: { alignItems: 'center', flexDirection: 'row', gap: 10, marginTop: 12 },
  srsState: { color: 'rgba(242,245,243,0.6)', fontSize: 12, fontWeight: '700' },
  meter: { flexDirection: 'row', gap: 3 },
  meterDot: { borderRadius: 999, height: 5, width: 5 },
  meterOn: { backgroundColor: '#5ee6a8' },
  meterOff: { backgroundColor: 'rgba(255,255,255,0.12)' },
  srsDue: { color: 'rgba(242,245,243,0.45)', fontSize: 12, marginLeft: 'auto' },
  explainBlock: {
    borderTopColor: 'rgba(242,245,243,0.08)',
    borderTopWidth: 1,
    marginTop: 16,
    paddingTop: 14,
  },
  explainUsage: { color: 'rgba(242,245,243,0.85)', fontSize: 14, lineHeight: 21 },
  explainGrammar: {
    color: 'rgba(242,245,243,0.55)',
    fontSize: 13,
    fontStyle: 'italic',
    lineHeight: 19,
    marginTop: 8,
  },
  chipRow: { flexDirection: 'row', gap: 6, marginTop: 10 },
  posChip: {
    backgroundColor: 'rgba(242,245,243,0.08)',
    borderRadius: 6,
    color: 'rgba(242,245,243,0.55)',
    fontSize: 11,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  registerChip: {
    backgroundColor: 'rgba(242,193,78,0.14)',
    borderRadius: 6,
    color: '#f2c14e',
    fontSize: 11,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  example: { marginTop: 12 },
  exampleEs: { color: 'rgba(242,245,243,0.85)', fontSize: 14, lineHeight: 20 },
  exampleTr: {
    color: 'rgba(242,245,243,0.5)',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  explainLoading: { alignItems: 'flex-start', marginTop: 16 },
  reviewButton: {
    alignItems: 'center',
    backgroundColor: '#5ee6a8',
    borderRadius: 16,
    justifyContent: 'center',
    marginTop: 20,
    paddingVertical: 14,
  },
  reviewLabel: { color: '#06130d', fontSize: 16, fontWeight: '800' },
  hearButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(242,245,243,0.10)',
    borderRadius: 16,
    justifyContent: 'center',
    marginTop: 8,
    paddingVertical: 13,
  },
  hearLabel: { color: '#f2f5f3', fontSize: 15, fontWeight: '700' },
  removeButton: { alignItems: 'center', marginTop: 6, paddingVertical: 12 },
  removeLabel: { color: 'rgba(248,113,113,0.85)', fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
