import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SavedWord, Video } from '@loro/core/types';
import { getCatalog } from '@loro/core/catalog';
import { collectionVideos } from '@loro/core/catalog/collectionVideos';
import { cleanWord, normalizeSurface } from '@loro/core/dictionary';
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
import { KNOWN_BOX, normalizeAnswer } from '@loro/core/srs';
import { isLocked } from '@loro/core/roadmap';
import { spokenSurfacesCached } from '@loro/core/occurrences';
import { whereItIs } from './whereItIs';
import { storage } from '@loro/core/storage';
import { getExplanations } from '../platform/explanations';
import { SentenceWithHit, TranslationWithHit } from '../feed/SentenceWithHit';

/**
 * The word-detail sheet on the Words tab — tap a row, get everything the app
 * knows about that word: translation, schedule, the pregenerated explanation
 * (usage note, grammar, register — see core/explanations.ts), real example
 * sentences from the catalog, and the "hear it in a video" jump.
 *
 * THE LOOK IS feed/WordSheet.tsx's ModalShell — a panel hugging its content
 * with a max-height cap, only the text scrolling, over a tappable dimmed
 * backdrop. That shell shipped because it cannot silently fail on device (the
 * gorhom path did, twice) and this inherits the verdict rather than
 * re-litigating it.
 *
 * ⚠️ THE <Modal> ITSELF LIVES IN VocabScreen, not here, and must stay there.
 * The Words screen presents exactly one native window and swaps its contents
 * between this sheet and the hear-it player; when each owned its own <Modal>,
 * one could outlive the other and an orphaned window swallows every touch —
 * the Words list came back frozen. This renders panel content, nothing more.
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

/** The spoken words of a cue — cues carry words, not a text field. */
function cueWords(video: Video, cueIndex: number): readonly { text: string }[] | null {
  const cue = video.cues[cueIndex];
  if (!cue || cue.words.length === 0) return null;
  return cue.words;
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
  onHear,
}: {
  word: SavedWord;
  onClose: () => void;
  /** Called after the user confirms removal; the caller owns the storage call. */
  onRemove: (word: SavedWord) => void;
  /**
   * Review this word. `occurrence` is the clip that says it — when there is
   * one, the review happens in this same window as a flashcard; when there is
   * not, the caller falls back to arming a session in the feed.
   *
   * This must NOT also call onClose: on the fallback path the dismissal and
   * the tab change would land in one commit, which is the shape that stranded
   * a native window before.
   */
  onReview: (
    word: SavedWord,
    occurrence: WordOccurrence | null,
    video: Video | null
  ) => void;
  /** Swap this window's contents to the hear-it player. */
  onHear: (occurrence: WordOccurrence, video: Video) => void;
}) {
  const insets = useSafeAreaInsets();

  const [explanations, setExplanations] =
    useState<ReadonlyMap<string, WordExplanation> | null>(null);
  const [loadingExplanations, setLoadingExplanations] = useState(false);

  // Lazy-load on first open of ANY word — one fetch/parse per process, then
  // every later open is a map lookup.
  useEffect(() => {
    if (explanations !== null) return;
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
   * The word's catalog record + its explanation + the replay occurrence, all
   * derived in one place. The catalog scan (findWordOccurrences) is a per-open
   * fold over ~39k word tokens — single-digit milliseconds, and memoised for
   * the sheet's lifetime, so no index to build or invalidate.
   *
   * There is no held-over copy of `word` for the exit animation any more: the
   * screen keeps this sheet mounted with its word intact until the window has
   * finished dismissing, so there is nothing to hold over.
   */
  const derived = useMemo(() => {
    // Reels AND the shelves: a word saved from Peppa is said in Peppa.
    const catalog = [...getCatalog(), ...collectionVideos];
    const sourceVideo = catalog.find((v) => v.id === word.videoId) ?? null;
    const occurrences = findWordOccurrences(catalog, word.text);
    const hearOccurrence = pickReplayOccurrence(
      occurrences,
      { videoId: word.videoId, cueIndex: word.cueIndex },
      { requireYoutube: true }
    );
    /**
     * WHERE TO REVIEW IT, which is a different question from where to hear it.
     * pickReplayOccurrence deliberately EXCLUDES the cue the word was saved
     * from — hearing it somewhere new is the point of that button. A review
     * wants the opposite: the sentence the user already has a memory of, and
     * only failing that, anywhere else that says it.
     */
    const reviewOccurrence =
      occurrences.find(
        (o) =>
          o.videoId === word.videoId &&
          o.cueIndex === word.cueIndex &&
          o.youtubeId !== null
      ) ??
      occurrences.find((o) => o.videoId === word.videoId && o.youtubeId !== null) ??
      occurrences.find((o) => o.youtubeId !== null) ??
      null;
    return { catalog, sourceVideo, hearOccurrence, reviewOccurrence };
  }, [word]);

  /**
   * Surface -> lemma, walked through the dictionaries the same way WordSheet
   * does (lookupGloss keys on normalizeSurface). The source video's dictionary
   * is authoritative; any other video that glosses the word is a fallback —
   * the same lemma by construction of the gloss pipeline.
   */
  const explanation = useMemo(() => {
    if (!explanations) return null;
    const key = normalizeSurface(word.text);
    if (!key) return null;
    const videos = derived.sourceVideo
      ? [derived.sourceVideo, ...derived.catalog]
      : derived.catalog;
    for (const video of videos) {
      const gloss = video.dictionary?.[key];
      if (gloss) return explanations.get(gloss.lemma) ?? null;
    }
    return null;
  }, [word, explanations, derived]);

  const lang = explanationLang();
  const now = Date.now();

  /**
   * WHERE IT IS (2026-11-24). The card used to lead with "Review it now":
   * since training left the road, the feed moves a word and this says
   * where it is on its way — the road's own line (whereItIs), plus the
   * two cases the road cannot show: a word waiting behind the open window
   * (locked) and a blue word, known from a video but never saved.
   */
  const where = useMemo(() => {
    const all = storage.getSavedWords();
    const key = normalizeAnswer(word.text);
    const saved = all.some((w) => normalizeAnswer(w.text) === key);
    if (!saved) return { saved, line: 'You knew it in a video ✓' };
    const line = whereItIs(word, now, spokenSurfacesCached(getCatalog()));
    // A learned word still comes back now and then, further apart each time.
    if (word.state === 'known') return { saved, line: `Learned ✓ · ${line.charAt(0).toLowerCase()}${line.slice(1)}` };
    if (isLocked(word, all)) return { saved, line: 'Waiting on your road. It opens as you learn the words before it.' };
    return { saved, line };
    // `now` is read at render; the card is short-lived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word]);

  const stateLabel: Record<SavedWord['state'], string> = {
    lapsed: 'Missed',
    new: 'Just saved',
    learning: 'Getting it',
    known: 'Learned',
  };
  /** Hear it: somewhere new first (pickReplayOccurrence), else where it was saved. */
  const listenOccurrence = derived.hearOccurrence ?? derived.reviewOccurrence;

  return (
    <>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.panel, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.handleRow}>
          <View style={styles.handle} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
        >
          <Text style={styles.word}>{cleanWord(word.text)}</Text>
          <Text style={styles.translation}>{word.translation}</Text>

          {/* The schedule, in the vocab list's own vocabulary. The dot meter
              that sat here went with the list's (2026-09-01, "nobody gets
              that" — see VocabScreen's ProgressCount): the sheet has room
              for the whole sentence, so it says it. Progress is measured
              against KNOWN_BOX, the exact threshold the state flips on. */}
          {where.saved && word.state !== 'known' && (
            <View style={styles.srsRow}>
              <Text style={styles.srsState}>{stateLabel[word.state]}</Text>
              {(word.state === 'new' || word.state === 'learning') && (
                <Text style={styles.srsCount}>
                  {Math.min(word.box, KNOWN_BOX)} of {KNOWN_BOX} right
                </Text>
              )}
            </View>
          )}
          <Text style={[styles.where, where.line.includes('in your videos now') || where.line.startsWith('In your videos') ? styles.whereNow : null]}>
            {where.line}
          </Text>

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
                const video = derived.catalog.find((v) => v.id === example.videoId);
                if (!video) return null;
                const words = cueWords(video, example.cueIndex);
                if (!words) return null;
                const key = normalizeSurface(word.text);
                const cueTranslation =
                  video.cues[example.cueIndex]?.translations[lang] ??
                  video.cues[example.cueIndex]?.translations.en ??
                  null;
                return (
                  <View key={`${example.videoId}-${example.cueIndex}-${i}`}
                    style={styles.example}>
                    <SentenceWithHit
                      words={words}
                      isHit={(w) => normalizeSurface(w.text) === key}
                      style={styles.exampleEs}
                    />
                    {cueTranslation && (
                      <TranslationWithHit
                        text={cueTranslation}
                        gloss={word.translation}
                        style={styles.exampleTr}
                      />
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
          {/* HEAR IT LEADS (2026-11-24). Practising here used to be the
              primary action; 11 of 210 store installs ever did it, and the
              feed now brings the word back on its own. Hidden, not
              disabled, when no video says it. */}
          {listenOccurrence && (
            <Pressable
              onPress={() => {
                const clip = derived.catalog.find((v) => v.id === listenOccurrence.videoId) ?? null;
                if (!clip) return;
                // A content swap inside the window that is already up —
                // no dismissal, no second presentation, nothing to race.
                onHear(listenOccurrence, clip);
              }}
              accessibilityRole="button"
              accessibilityHint="Opens a video where this word is spoken"
              style={({ pressed }) => [styles.hearButton, pressed && styles.pressed]}
            >
              <Text style={styles.hearLabel}>▶ Hear it in a video</Text>
            </Pressable>
          )}

          {/* Practice stays, small, for whoever wants it now: the clip that
              says it as a flashcard, then the set (PracticeDrill). One paid
              user ran 50 sets — it costs nothing to keep. */}
          {where.saved && (
            <Pressable
              onPress={() => {
                const occ = derived.reviewOccurrence;
                const clip = occ
                  ? (derived.catalog.find((v) => v.id === occ.videoId) ?? null)
                  : null;
                onReview(word, occ && clip ? occ : null, clip);
              }}
              accessibilityRole="button"
              accessibilityHint="Type it from memory, a few times"
              style={({ pressed }) => [styles.practiseButton, pressed && styles.pressed]}
            >
              <Text style={styles.practiseLabel}>Practise now</Text>
            </Pressable>
          )}
          {where.saved && (
            <Pressable
              onPress={() => {
                onRemove(word);
                onClose();
              }}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${cleanWord(word.text)}`}
              style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
            >
              <Text style={styles.removeLabel}>Remove from my words</Text>
            </Pressable>
          )}
        </View>

      </View>
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
  srsCount: { color: 'rgba(242,245,243,0.45)', fontSize: 12, fontWeight: '600' },
  where: { color: 'rgba(242,245,243,0.55)', fontSize: 13, fontWeight: '600', lineHeight: 18, marginTop: 8 },
  whereNow: { color: '#5ee6a8' },
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
  hearButton: {
    alignItems: 'center',
    backgroundColor: '#5ee6a8',
    borderRadius: 16,
    justifyContent: 'center',
    marginTop: 20,
    paddingVertical: 14,
  },
  hearLabel: { color: '#06130d', fontSize: 16, fontWeight: '800' },
  practiseButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(242,245,243,0.10)',
    borderRadius: 16,
    justifyContent: 'center',
    marginTop: 8,
    paddingVertical: 12,
  },
  practiseLabel: { color: '#f2f5f3', fontSize: 14, fontWeight: '700' },
  removeButton: { alignItems: 'center', marginTop: 6, paddingVertical: 12 },
  removeLabel: { color: 'rgba(248,113,113,0.85)', fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
