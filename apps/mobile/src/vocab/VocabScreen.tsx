import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SavedWord, WordState } from '@loro/core/types';
import { storage } from '@loro/core/storage';
import { formatDue, MAX_BOX } from '@loro/core/srs';
import { enableRecallForSession } from '../feed/recall';
import { SavePromptCard } from '../auth/SavePromptCard';
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
  const [detail, setDetail] = useState<SavedWord | null>(null);

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
   * THE REVIEW ENTRY POINT — it has to ARM recall, not merely change tab.
   *
   * The web needs no equivalent because it never gates recall at all: a due
   * word blanks in any video that speaks it, always. This port added a
   * dark-ship flag, and left alone that flag also disabled the one path a user
   * has into reviewing — the CTA switched tabs into a feed that would never
   * plan a blank. See isRecallActive.
   *
   * NO JUMP TO A SPECIFIC VIDEO, and that is deliberate rather than missing.
   * The web's reviewHref deep-links to the video with the most due words
   * (vocab/page.tsx:34-37); deep links are checkpoint G. Faking a jump we
   * cannot make would be worse than the honest behaviour, which the card's own
   * copy already promises: blanks appear in context, as you watch.
   */
  const startReview = () => {
    enableRecallForSession();
    onGoToFeed();
  };

  const handleRemove = (word: SavedWord) => {
    setWords(storage.removeWord(word.text, word.videoId));
  };

  const openDetail = (word: SavedWord) => setDetail(word);

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

      <WordDetailSheet
        word={detail}
        onClose={() => setDetail(null)}
        onRemove={handleRemove}
      />
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
