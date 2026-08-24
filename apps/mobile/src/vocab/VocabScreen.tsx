import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SavedWord, Video, WordState } from '@loro/core/types';
import { storage } from '@loro/core/storage';
import { formatDue, MAX_BOX } from '@loro/core/srs';
import { getCatalog } from '@loro/core/catalog';
import { pickReviewTarget, type WordOccurrence } from '@loro/core/occurrences';
import { enableRecallForSession } from '../feed/recall';
import { requestReviewTarget } from '../feed/reviewTarget';
import { SavePromptCard } from '../auth/SavePromptCard';
import { HearItPanel } from './HearItPanel';
import { WordDetailSheet } from './WordDetailSheet';

/**
 * VOCAB — port of the web's app/vocab/page.tsx.
 *
 * The organising idea is the web's and is worth restating because it is why
 * there are no filter chips: the list is bucketed into URGENCY SECTIONS that
 * read top-to-bottom — problems first, then the do-it-now pile, then the
 * pipeline, then the wins. "The section carries the organisation — no filter
 * controls required" (vocab/page.tsx:95-97).
 *
 * WHAT IS DELIBERATELY LEFT OUT, and it is not an oversight: the web's
 * per-word replay link and its "Review now" deep link both target
 * `/?v=…&t=…`, and this app has no deep-link handling until G. Rather than
 * render a button that silently does nothing, the per-word replay is absent
 * and the "N words ready" call to action switches to the Feed tab — the one
 * thing it can honestly do today.
 */

const wordKey = (w: SavedWord) => `${w.videoId}-${w.text}`;

type Tone = 'red' | 'muted' | 'accent';

const TONE_COLOR: Record<Tone, string> = {
  red: '#f87171',
  muted: 'rgba(242,245,243,0.55)',
  accent: '#5ee6a8',
};

/** Plain-language status a stranger understands (vocab/page.tsx:73-78). */
const STATE_META: Record<WordState, { human: string; tone: Tone }> = {
  lapsed: { human: 'Slipped — review soon', tone: 'red' },
  new: { human: 'Just saved', tone: 'muted' },
  learning: { human: 'Getting it', tone: 'accent' },
  known: { human: 'Learned ✓', tone: 'accent' },
};

type SectionKey = 'lapsed' | 'ready' | 'new' | 'learning' | 'known';

const SECTION_META: Record<SectionKey, { label: string; dot: string }> = {
  lapsed: { label: 'SLIPPED', dot: '#f87171' }, //   reserved red — most urgent
  ready: { label: 'READY', dot: '#5ee6a8' }, //      due now — do these
  new: { label: 'JUST SAVED', dot: 'rgba(242,245,243,0.55)' },
  learning: { label: 'LEARNING', dot: 'rgba(242,245,243,0.55)' },
  known: { label: 'LEARNED', dot: '#5ee6a8' }, //    accent green — the wins
};

/** Section order = urgency order. Empty sections are dropped before render. */
const SECTION_ORDER: SectionKey[] = ['lapsed', 'ready', 'new', 'learning', 'known'];

/**
 * How long to wait for the window's own dismissal callback before assuming it
 * is not coming. onDismiss is iOS-only and fires well inside this; the timer
 * exists so a review can never be swallowed by a callback that never arrives.
 */
const DISMISS_FALLBACK_MS = 600;

/**
 * Accent-and-case-insensitive haystack, so "cancion" finds "canción".
 *
 * Deliberately NOT core's normalizeAnswer: that trims punctuation from the
 * ends because it grades a typed answer, and a search box wants a substring
 * match rather than a graded one. Same fold as the web's own (vocab:117-122).
 */
function fold(text: string): string {
  return text
    .normalize('NFD')
    // Escaped rather than literal: these are COMBINING marks, and written
    // literally they are invisible in the source and merge with the bracket
    // in most editors. Same range core's normalizeAnswer uses.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** "Ready now" / "Review in 10 min" / "Review in 2 days". */
function friendlyDue(word: SavedWord, now: number): string {
  if (word.dueAt <= now) return 'Ready now';
  return `Review ${formatDue(word.dueAt, now)}`;
}

/** Leitner meter — one dot per box, read as "progress toward Learned". */
function BoxMeter({ word }: { word: SavedWord }) {
  const on = TONE_COLOR[STATE_META[word.state].tone];
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={`${word.box} of ${MAX_BOX} toward learned`}
      style={styles.meter}
    >
      {Array.from({ length: MAX_BOX }, (_, i) => (
        <View
          key={i}
          style={[
            styles.meterDot,
            { backgroundColor: i < word.box ? on : 'rgba(255,255,255,0.12)' },
          ]}
        />
      ))}
    </View>
  );
}

function WordRow({
  word,
  now,
  onOpen,
}: {
  word: SavedWord;
  now: number;
  onOpen: () => void;
}) {
  const meta = STATE_META[word.state];
  const isLapsed = word.state === 'lapsed';
  const isKnown = word.state === 'known';
  // Felt progress: known reads as complete; otherwise fill by Leitner box.
  const fillPct = isKnown ? 100 : (word.box / MAX_BOX) * 100;
  const edge = isLapsed ? '#f87171' : isKnown ? '#5ee6a8' : 'rgba(94,230,168,0.4)';
  const fill = isLapsed ? '#f87171' : TONE_COLOR[meta.tone];

  // The whole row opens the detail sheet; remove lives in the sheet's footer
  // now, which un-clutters the row and puts a destructive action one
  // deliberate step further from a scroll-past thumb.
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${word.text} — details`}
      style={({ pressed }) => [
        styles.row,
        isLapsed && styles.rowLapsed,
        pressed && styles.rowPressed,
      ]}
    >
      {/* left status edge — pulls the eye to lapsed words */}
      <View style={[styles.edge, { backgroundColor: edge }]} />

      <View style={styles.rowBody}>
        <View style={styles.rowHead}>
          <View style={styles.rowHeadText}>
            <Text style={styles.word}>{word.text}</Text>
            <Text style={styles.translation} numberOfLines={2}>
              {word.translation}
            </Text>
          </View>
        </View>

        <View style={styles.rowMeta}>
          <Text style={[styles.stateLabel, { color: TONE_COLOR[meta.tone] }]}>
            {meta.human}
          </Text>
          <BoxMeter word={word} />
          <Text
            style={[
              styles.due,
              word.dueAt <= now ? styles.dueNow : styles.dueLater,
            ]}
          >
            {friendlyDue(word, now)}
          </Text>
        </View>
      </View>

      {/* progress fill — grows toward Learned, felt not just read */}
      <View style={styles.fillTrack}>
        <View style={[styles.fillBar, { width: `${fillPct}%`, backgroundColor: fill }]} />
      </View>
    </Pressable>
  );
}

export function VocabScreen({
  active,
  onGoToFeed,
}: {
  active: boolean;
  onGoToFeed: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [words, setWords] = useState<SavedWord[]>(() => storage.getSavedWords());
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(() => Date.now());
  /**
   * THE ONE WINDOW, AND WHAT IS INSIDE IT.
   *
   * `detail` decides whether this screen presents a native window at all;
   * `hearing` decides which face it shows — the word sheet or the hear-it
   * player. That is the whole fix for the frozen Words list, and it is worth
   * spelling out because two gentler versions of it were not enough.
   *
   * An RN <Modal> is a separate native window that does not care what the
   * React tree behind it is doing. Give the sheet one and the player another
   * and they can be dismissed together, or dismissed while their screen is
   * being hidden, and iOS quietly leaves one of them in the window hierarchy:
   * invisible, and swallowing every touch that lands on Words. Nesting them
   * did it. Making them siblings did it too.
   *
   * So there is ONE window here and there will only ever be one. Moving
   * between the sheet and the player is a React re-render inside a window that
   * is already up — no dismissal, no presentation, nothing to strand.
   */
  const [detail, setDetail] = useState<SavedWord | null>(null);
  const [hearing, setHearing] = useState<{
    occurrence: WordOccurrence;
    video: Video;
  } | null>(null);
  /**
   * Dismissal in flight. `visible` goes false while the contents stay mounted,
   * so the slide-out has something to draw and whatever comes next waits for
   * onDismiss instead of racing it.
   */
  const [closing, setClosing] = useState(false);

  /**
   * ⚠️ NOTHING NAVIGATES WHILE THE WINDOW IS STILL ON SCREEN.
   *
   * "Review in the feed" used to dismiss the modal and switch tabs in the same
   * commit — so the window was being torn down at the exact moment its screen
   * went `display:'none'` underneath it. That is the second half of the freeze:
   * a dismissal that never completes leaves the window up forever.
   *
   * The intent is parked here instead and runs from onDismiss, when the window
   * is provably gone. The timer is the belt to that braces: onDismiss is an
   * iOS-only callback, and a review that silently never happened would be a
   * worse bug than the one being fixed.
   */
  const pendingReviewRef = useRef<{
    word: SavedWord;
    preferVideoId?: string;
  } | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Live in both directions: onWordsChanged catches saves and grades from the
   * feed, and the 60s tick keeps "Ready now" and every forecast honest without
   * a refresh. The tick only runs while the tab is visible — a clock nobody is
   * reading is just a wakeup.
   */
  useEffect(() => {
    const refresh = () => setWords(storage.getSavedWords());
    refresh();
    setNow(Date.now());
    const unsub = storage.onWordsChanged(refresh);
    if (!active) return unsub;
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      clearInterval(tick);
      unsub();
    };
  }, [active]);

  /**
   * NOTHING THIS SCREEN PRESENTS MAY OUTLIVE A TAB SWITCH.
   *
   * An RN <Modal> is its own native window and does not care that the React
   * view behind it went `display:'none'`. Leaving one up while the user walks
   * to the feed is how the Words tab came back "frozen": an invisible window
   * still on top, swallowing every touch.
   *
   * With the review path now waiting for onDismiss, the window is always gone
   * before a tab change starts — so this should never have anything to do. It
   * stays as the backstop for paths added later that forget to tidy up.
   */
  useEffect(() => {
    if (active) return;
    setDetail(null);
    setHearing(null);
    setClosing(false);
  }, [active]);

  // A pending review must not fire into an unmounted screen.
  useEffect(
    () => () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    },
    []
  );

  const filtered = useMemo(() => {
    const needle = fold(query.trim());
    if (!needle) return words;
    return words.filter(
      (w) => fold(w.text).includes(needle) || fold(w.translation).includes(needle)
    );
  }, [words, query]);

  /**
   * Bucket into urgency sections. A due, non-lapsed word surfaces in READY
   * instead of its state section, so every word appears exactly once and the
   * list reads most-urgent → least from top to bottom (vocab/page.tsx:356-378).
   */
  const sections = useMemo(() => {
    const buckets: Record<SectionKey, SavedWord[]> = {
      lapsed: [],
      ready: [],
      new: [],
      learning: [],
      known: [],
    };
    for (const w of filtered) {
      if (w.state === 'lapsed') buckets.lapsed.push(w);
      else if (w.dueAt <= now) buckets.ready.push(w);
      else buckets[w.state].push(w);
    }
    return SECTION_ORDER.map((key) => ({
      key,
      ...SECTION_META[key],
      words: buckets[key].sort((a, b) => a.dueAt - b.dueAt),
    })).filter((s) => s.words.length > 0);
  }, [filtered, now]);

  const dueTotal = useMemo(
    () => words.filter((w) => w.dueAt <= now).length,
    [words, now]
  );

  /**
   * ARM RECALL, THEN CHANGE TAB — in that order, always.
   *
   * The web needs no equivalent because it never gates recall at all: a due
   * word blanks in any video that speaks it, always. This port added a
   * dark-ship flag, and left alone that flag also disabled the one path a user
   * has into reviewing — the CTA switched tabs into a feed that would never
   * plan a blank. See isRecallActive.
   */
  const goToFeedForReview = () => {
    enableRecallForSession();
    onGoToFeed();
  };

  /**
   * THE "N WORDS READY" CARD. It promises a review, so it points the feed at
   * one rather than dropping the user wherever the feed happened to be parked
   * — which is what it did before, and which reads as "it threw me at a random
   * video".
   *
   * Most urgent first, in the list's own order (slipped, then earliest due),
   * and the first word the feed would ACTUALLY ask wins. The scan is capped
   * because each candidate costs a catalog fold: a handful is plenty to find a
   * good landing, and past that the honest fallback — the feed as it stands,
   * blanks armed — is no worse than it ever was.
   */
  const CANDIDATES_SCANNED = 5;
  const startReview = () => {
    const all = storage.getSavedWords();
    const at = Date.now();
    const due = all
      .filter((w) => w.dueAt <= at)
      .sort(
        (a, b) =>
          Number(b.state === 'lapsed') - Number(a.state === 'lapsed') ||
          a.dueAt - b.dueAt
      )
      .slice(0, CANDIDATES_SCANNED);
    for (const word of due) {
      const target = pickReviewTarget(getCatalog(), word, all, { now: at });
      if (target?.willBlank) {
        requestReviewTarget({ videoId: target.videoId, word: word.text });
        break;
      }
    }
    goToFeedForReview();
  };

  const handleRemove = (word: SavedWord) => {
    setWords(storage.removeWord(word.text, word.videoId));
  };

  const openDetail = (word: SavedWord) => setDetail(word);

  /**
   * REVIEW ONE SPECIFIC WORD — the Words tab pointing the feed at something,
   * which it could not do before.
   *
   * Two things have to be true or the button lies. The word must be DUE, or
   * computeBlankPlan will not blank it and the feed is just a video
   * (storage.reviewNow, which is why bringing it forward is honest); and the
   * feed must land somewhere the word is genuinely ASKED. "Speaks the word"
   * turned out not to be enough — the plan caps blanks per video, so a word
   * can be spoken on screen and never asked, which lands the user in the feed
   * with no visible reason for being there. pickReviewTarget runs the real
   * plan against each candidate and picks one that will blank it.
   *
   * If nothing in the catalog speaks it (a starter-deck word with no clip),
   * this degrades to the old behaviour: arm recall, switch tabs.
   */
  const reviewWord = (word: SavedWord, preferVideoId?: string) => {
    storage.reviewNow(word.text, word.videoId);
    // AFTER reviewNow: the plan check has to see the word as due.
    const target = pickReviewTarget(getCatalog(), word, storage.getSavedWords(), {
      preferVideoId,
    });
    if (target) requestReviewTarget({ videoId: target.videoId, word: word.text });
    goToFeedForReview();
  };

  /** The window is provably gone. Safe to reset, and safe to navigate. */
  const afterDismiss = () => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    setClosing(false);
    setDetail(null);
    setHearing(null);
    const pending = pendingReviewRef.current;
    pendingReviewRef.current = null;
    if (pending) reviewWord(pending.word, pending.preferVideoId);
  };

  /**
   * Take the window down. Anything that should happen afterwards is parked
   * first and runs from afterDismiss — never from here.
   */
  const closeWindow = (pending?: { word: SavedWord; preferVideoId?: string }) => {
    pendingReviewRef.current = pending ?? null;
    setClosing(true);
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(afterDismiss, DISMISS_FALLBACK_MS);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Text style={styles.title}>Words</Text>
        <View style={styles.search}>
          <Text style={styles.searchGlyph}>⌕</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search your words"
            placeholderTextColor="rgba(242,245,243,0.35)"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Search your saved words"
            style={styles.searchInput}
          />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {/* THE ONLY SURFACE THIS MAY EVER MOUNT ON. The feed is structurally
            uninterruptible; core enforces the same rule independently
            (savePromptVariant returns null unless surface === 'vocab'), so
            this placement and that guard have to agree. Above the list rather
            than over it: nothing is covered and nothing is trapping. It
            renders null until core says otherwise, which is almost always. */}
        <SavePromptCard />

        {words.length === 0 ? (
          // Honest empty state — no fabricated sample words.
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No words yet</Text>
            <Text style={styles.emptyBody}>
              Tap any word in a video to save it. Saved words come back as blanks
              you type from memory.
            </Text>
            <Pressable
              onPress={onGoToFeed}
              accessibilityRole="button"
              style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
            >
              <Text style={styles.ctaText}>Go to the feed</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {dueTotal > 0 && (
              <View style={styles.reviewCard}>
                <Text style={styles.reviewCount}>
                  {dueTotal} {dueTotal === 1 ? 'word' : 'words'} ready to review
                </Text>
                <Text style={styles.reviewBody}>
                  Recall them in context — Loro shows them as blanks in the video.
                </Text>
                <Pressable
                  onPress={startReview}
                  accessibilityRole="button"
                  accessibilityHint="Opens the feed with your due words armed as blanks"
                  style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
                >
                  <Text style={styles.ctaText}>Review in the feed</Text>
                </Pressable>
              </View>
            )}

            {sections.length === 0 ? (
              <Text style={styles.noMatch}>No words match “{query.trim()}”.</Text>
            ) : (
              sections.map((section) => (
                <View key={section.key} style={styles.section}>
                  <View style={styles.sectionHead}>
                    <View
                      style={[styles.sectionDot, { backgroundColor: section.dot }]}
                    />
                    <Text style={styles.sectionLabel}>{section.label}</Text>
                    <Text style={styles.sectionCount}>{section.words.length}</Text>
                  </View>
                  {section.words.map((word) => (
                    <WordRow
                      key={wordKey(word)}
                      word={word}
                      now={now}
                      onOpen={() => openDetail(word)}
                    />
                  ))}
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>

      {/* ONE WINDOW. Its contents swap; it never gains a sibling. `visible`
          drops before the contents do, so the slide-out has something to draw
          and afterDismiss can be the only thing that resets state. */}
      <Modal
        visible={detail !== null && !closing}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => closeWindow()}
        onDismiss={afterDismiss}
      >
        {detail !== null &&
          (hearing ? (
            <HearItPanel
              occurrence={hearing.occurrence}
              word={detail.text}
              video={hearing.video}
              onClose={() => setHearing(null)}
              // Land on the clip they just listened to, not a different one.
              onReview={() =>
                closeWindow({ word: detail, preferVideoId: hearing.occurrence.videoId })
              }
            />
          ) : (
            <WordDetailSheet
              word={detail}
              onClose={() => closeWindow()}
              onRemove={handleRemove}
              onReview={(word) => closeWindow({ word })}
              onHear={(occurrence, video) => setHearing({ occurrence, video })}
            />
          ))}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: '#0a0d0b', flex: 1 },
  header: {
    backgroundColor: '#0a0d0b',
    borderBottomColor: 'rgba(242,245,243,0.08)',
    borderBottomWidth: 1,
    paddingBottom: 10,
    paddingHorizontal: 16,
  },
  title: { color: '#f2f5f3', fontSize: 22, fontWeight: '800', marginBottom: 10 },
  search: {
    alignItems: 'center',
    backgroundColor: 'rgba(242,245,243,0.07)',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
  },
  searchGlyph: { color: 'rgba(242,245,243,0.4)', fontSize: 16 },
  searchInput: { color: '#f2f5f3', flex: 1, fontSize: 15, paddingVertical: 9 },
  scroll: { padding: 16, paddingBottom: 32 },
  empty: { alignItems: 'center', gap: 8, paddingTop: 48 },
  emptyTitle: { color: '#f2f5f3', fontSize: 17, fontWeight: '700' },
  emptyBody: {
    color: 'rgba(242,245,243,0.6)',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
    textAlign: 'center',
  },
  noMatch: { color: 'rgba(242,245,243,0.55)', fontSize: 14, paddingTop: 24 },
  reviewCard: {
    backgroundColor: 'rgba(94,230,168,0.12)',
    borderColor: 'rgba(94,230,168,0.25)',
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 18,
    padding: 18,
  },
  reviewCount: { color: '#f2f5f3', fontSize: 20, fontWeight: '800' },
  reviewBody: {
    color: 'rgba(242,245,243,0.7)',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  cta: {
    alignItems: 'center',
    backgroundColor: '#5ee6a8',
    borderRadius: 14,
    marginTop: 14,
    paddingVertical: 12,
  },
  ctaText: { color: '#06130d', fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.7 },
  section: { marginBottom: 20 },
  sectionHead: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  sectionDot: { borderRadius: 999, height: 7, width: 7 },
  sectionLabel: {
    color: 'rgba(242,245,243,0.55)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  sectionCount: {
    color: 'rgba(242,245,243,0.35)',
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 'auto',
  },
  row: {
    backgroundColor: '#141a17',
    borderRadius: 16,
    marginBottom: 8,
    overflow: 'hidden',
  },
  rowLapsed: { borderColor: 'rgba(248,113,113,0.4)', borderWidth: 1 },
  rowPressed: { opacity: 0.8 },
  edge: { bottom: 0, left: 0, position: 'absolute', top: 0, width: 3 },
  rowBody: { paddingBottom: 14, paddingLeft: 16, paddingRight: 10, paddingTop: 12 },
  rowHead: { flexDirection: 'row', gap: 8 },
  rowHeadText: { flex: 1 },
  word: { color: '#f2f5f3', fontSize: 17, fontWeight: '700' },
  translation: {
    color: 'rgba(242,245,243,0.6)',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 1,
  },
  rowMeta: { alignItems: 'center', flexDirection: 'row', gap: 10, marginTop: 10 },
  stateLabel: { fontSize: 12, fontWeight: '700' },
  meter: { flexDirection: 'row', gap: 3 },
  meterDot: { borderRadius: 999, height: 5, width: 5 },
  due: { fontSize: 12, marginLeft: 'auto' },
  dueNow: { color: '#5ee6a8', fontWeight: '700' },
  dueLater: { color: 'rgba(242,245,243,0.45)' },
  fillTrack: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    bottom: 0,
    height: 3,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  fillBar: { height: '100%' },
});
