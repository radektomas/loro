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
import { formatDue, KNOWN_BOX, normalizeAnswer } from '@loro/core/srs';
import type { WordOccurrence } from '@loro/core/occurrences';
import { distinctWords, isLearned, isReady } from '@loro/core/progress';
import { launchPracticeLearned, launchReview, launchReviewOfWord } from '../feed/launchReview';
import { takeRequestedWordsView, type WordsView } from './wordsView';
import { onLearnedFace } from '../feed/wordLearned';
import { ReviewPickerSheet } from '../progress/ReviewPicker';
import { SavePromptCard } from '../auth/SavePromptCard';
import { WordVideoPanel, type PanelMode } from './WordVideoPanel';
import { WordDetailSheet } from './WordDetailSheet';

/**
 * VOCAB — port of the web's app/vocab/page.tsx.
 *
 * The web bucketed the list into urgency sections with no filter controls.
 * This screen moved on (2026-09-18, Radek: 300 words "is such a chaos"): the
 * review card up top is where "ready" lives, and under it FOUR PILES the
 * user switches between — Saved, In practice, Slipped, Learned — each in
 * its own time order. See PILES.
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
  lapsed: { human: 'Missed, review soon', tone: 'red' },
  new: { human: 'Just saved', tone: 'muted' },
  learning: { human: 'Getting it', tone: 'accent' },
  known: { human: 'Known', tone: 'accent' },
};

/**
 * THE FOUR PILES (Radek, 2026-09-18: "saved / in practice / slipped /
 * learned ... show them based of the time the user saved / practiced /
 * slipped it"). Every word is in exactly one, and each pile is ordered by
 * its own moment: Saved by when it was saved, In practice and Slipped by
 * the last answer, Learned by when it was earned. No urgency sections, no
 * day log — the review card above the piles is where "ready" lives.
 */
const PILES: { key: WordsView; label: string }[] = [
  { key: 'saved', label: 'Saved' },
  { key: 'practice', label: 'In practice' },
  { key: 'missed', label: 'Missed' },
  { key: 'learned', label: 'Learned' },
];

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

/** "Saved 2 days ago" / "Ready now" / "Review in 10 min" / "Review in 2 days". */
function friendlyDue(word: SavedWord, now: number): string {
  // A fresh save is not "ready" (core isReady): it is waiting for a video
  // to say it. Its own moment is when it was saved.
  if (word.state === 'new') return `Saved ${ago(word.savedAt, now)}`;
  if (word.dueAt <= now) return 'Ready now';
  return `Review ${formatDue(word.dueAt, now)}`;
}

function ago(at: number, now: number): string {
  const min = Math.max(0, Math.round((now - at) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ${h === 1 ? 'hour' : 'hours'} ago`;
  const d = Math.round(h / 24);
  return `${d} ${d === 1 ? 'day' : 'days'} ago`;
}

/**
 * ONE ROW PER WORD (2026-09-07).
 *
 * Storage keys a word on (text, videoId), so "de" saved from three videos is
 * three entries — and the blank planner already treats them as one thing to
 * practise (srs.computeBlankPlan folds due words by normalizeAnswer and
 * asks the most urgent). The list shows what the feed will ask: the most
 * urgent entry per distinct word, slipped first, then lowest box, then
 * earliest due. Removing a row removes every entry behind it (handleRemove),
 * because "remove this word" means the word.
 */
function moreUrgent(a: SavedWord, b: SavedWord): boolean {
  const lapsed = Number(a.state === 'lapsed') - Number(b.state === 'lapsed');
  if (lapsed !== 0) return lapsed > 0;
  if (a.box !== b.box) return a.box < b.box;
  return a.dueAt < b.dueAt;
}

/** Search hit, on the word or its meaning. */
function matches(w: SavedWord, needle: string): boolean {
  return fold(w.text).includes(needle) || fold(w.translation).includes(needle);
}

function oneRowPerWord(words: readonly SavedWord[]): SavedWord[] {
  const byKey = new Map<string, SavedWord>();
  for (const w of words) {
    const key = normalizeAnswer(w.text) || w.text;
    const held = byKey.get(key);
    if (!held || moreUrgent(w, held)) byKey.set(key, w);
  }
  return [...byKey.values()];
}

/**
 * THE ROW — a card that reads top-down: the Spanish word, its meaning, then
 * one quiet line of status and timing. Radek, 2026-09-18: the old row's
 * green left edge and bottom fill bar were "super basic, AI tell". Both are
 * gone. Progress toward Learned is now a tiny three-segment meter in the
 * corner (the same "of 3" as before, felt not read), a learned word wears a
 * mint check, a missed word a soft red mark and a warmer card — nothing
 * striped, nothing bordered.
 */
function Meter({ word }: { word: SavedWord }) {
  if (word.state !== 'new' && word.state !== 'learning') return null;
  const have = Math.min(word.box, KNOWN_BOX);
  return (
    <View style={styles.meter} accessibilityLabel={`${have} of ${KNOWN_BOX}`}>
      {Array.from({ length: KNOWN_BOX }, (_, i) => (
        <View key={i} style={[styles.meterSeg, i < have && styles.meterSegOn]} />
      ))}
    </View>
  );
}

function Badge({ word }: { word: SavedWord }) {
  if (word.state === 'lapsed') {
    return (
      <View style={[styles.badge, styles.badgeMissed]}>
        <Text style={[styles.badgeText, styles.badgeTextMissed]}>!</Text>
      </View>
    );
  }
  if (word.state === 'known') {
    return (
      <View style={[styles.badge, styles.badgeLearned]}>
        <Text style={[styles.badgeText, styles.badgeTextLearned]}>✓</Text>
      </View>
    );
  }
  return <Meter word={word} />;
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
  // Earned, not merely filed: core's isLearned. A starter-deck grant is
  // 'known' and says so; only a word the review loop earned says Learned.
  const human = isLearned(word) ? 'Learned' : meta.human;

  // The whole row opens the detail sheet; remove lives in the sheet's footer
  // now, which un-clutters the row and puts a destructive action one
  // deliberate step further from a scroll-past thumb.
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${word.text}, ${word.translation}. ${human}. ${friendlyDue(word, now)}`}
      style={({ pressed }) => [styles.row, isLapsed && styles.rowMissed, pressed && styles.rowPressed]}
    >
      <View style={styles.rowTop}>
        <View style={styles.rowText}>
          <Text style={styles.word}>{word.text}</Text>
          <Text style={styles.translation} numberOfLines={2}>
            {word.translation}
          </Text>
        </View>
        <Badge word={word} />
      </View>

      <View style={styles.rowMeta}>
        <Text style={[styles.stateLabel, { color: TONE_COLOR[meta.tone] }]}>{human}</Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={[styles.due, word.dueAt <= now ? styles.dueNow : styles.dueLater]}>
          {friendlyDue(word, now)}
        </Text>
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
   * TWO FACES (Radek, 2026-09-18: the learned words felt "hidden and not
   * clear"). LEARNING is the urgency list this screen always was, minus the
   * words already earned; LEARNED is those words, newest first, with the
   * count up top and a way to practise them. A door elsewhere (the toast,
   * the Progress card) can ask for a face before switching here.
   */
  const [view, setView] = useState<WordsView>('saved');
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
  /**
   * THE THIRD FACE: the review picker, raised by the "N words ready" card.
   * It rides the SAME window as the sheet and the player — see the note
   * above for why it must not have a Modal of its own. It never shows at
   * the same time as `detail`: the card is only reachable with the window
   * down, and afterDismiss clears both.
   */
  const [picker, setPicker] = useState<false | 'due' | 'learned'>(false);
  /**
   * The video face of the window: the clip that says this word, either to
   * listen to ('listen') or to be quizzed on ('review'). Null means the word
   * sheet is showing.
   */
  const [playing, setPlaying] = useState<{
    occurrence: WordOccurrence;
    video: Video;
    mode: PanelMode;
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
    /** Null: the plain armed feed (nothing could land). */
    word: SavedWord | null;
    preferVideoId?: string;
    /** No word chosen from the LEARNED picker: practise a handful instead. */
    practice?: boolean;
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
    const unsub = storage.onWordsChanged(refresh);
    if (!active) return unsub;
    // Re-read on the way IN only. Leaving the tab used to re-read and
    // re-render a screen that was about to be hidden; the subscription
    // above keeps it current while it is.
    refresh();
    setNow(Date.now());
    const requested = takeRequestedWordsView();
    if (requested) setView(requested);
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
    setPlaying(null);
    setPicker(false);
    setClosing(false);
  }, [active]);

  // A pending review must not fire into an unmounted screen.
  useEffect(
    () => () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    },
    []
  );

  /**
   * The earned words, one per surface, freshest crossing first — the same
   * fold the Progress count and the toast use (core distinctWords +
   * isLearned), so all three say the same number.
   */
  const learnedAll = useMemo(
    () =>
      distinctWords(words)
        .filter(onLearnedFace)
        .sort(
          (a, b) =>
            Number(isLearned(b)) - Number(isLearned(a)) ||
            (b.learnedAt ?? b.lastReviewedAt ?? 0) - (a.learnedAt ?? a.lastReviewedAt ?? 0)
        ),
    [words]
  );
  const earnedCount = useMemo(() => learnedAll.filter(isLearned).length, [learnedAll]);
  const learnedKeys = useMemo(
    () => new Set(learnedAll.map((w) => normalizeAnswer(w.text) || w.text)),
    [learnedAll]
  );
  /** Everything not on the Learned pile, one row per surface. */
  const rest = useMemo(
    () => oneRowPerWord(words).filter((w) => !learnedKeys.has(normalizeAnswer(w.text) || w.text)),
    [words, learnedKeys]
  );
  const piles = useMemo<Record<WordsView, SavedWord[]>>(
    () => ({
      saved: rest.filter((w) => w.state === 'new').sort((a, b) => b.savedAt - a.savedAt),
      practice: rest
        .filter((w) => w.state === 'learning' || w.state === 'known')
        .sort((a, b) => (b.lastReviewedAt ?? b.savedAt) - (a.lastReviewedAt ?? a.savedAt)),
      missed: rest
        .filter((w) => w.state === 'lapsed')
        .sort((a, b) => (b.lastReviewedAt ?? b.savedAt) - (a.lastReviewedAt ?? a.savedAt)),
      learned: learnedAll,
    }),
    [rest, learnedAll]
  );
  const pileRows = useMemo(() => {
    const needle = fold(query.trim());
    const rows = piles[view];
    return needle ? rows.filter((w) => matches(w, needle)) : rows;
  }, [piles, view, query]);
  const onTheWay = piles.saved.length + piles.practice.length;

  const dueTotal = useMemo(
    () => words.filter((w) => isReady(w, now)).length,
    [words, now]
  );

  /**
   * THE "N WORDS READY" CARD opens the picker — the same sheet the Progress
   * tab's Review shows (Radek: "you forgot to apply it also to the words
   * cta") — as a face of this screen's one window. The launch runs from
   * afterDismiss, like every other review from this tab.
   */
  const startReview = () => setPicker('due');
  const dueWords = useMemo(
    () =>
      words
        .filter((w) => isReady(w, now))
        .sort(
          (a, b) =>
            Number(b.state === 'lapsed') - Number(a.state === 'lapsed') ||
            a.dueAt - b.dueAt
        ),
    [words, now]
  );

  /** Every entry behind the row — see oneRowPerWord. */
  const handleRemove = (word: SavedWord) => {
    const key = normalizeAnswer(word.text) || word.text;
    let next = storage.getSavedWords();
    for (const entry of next.filter((w) => (normalizeAnswer(w.text) || w.text) === key)) {
      next = storage.removeWord(entry.text, entry.videoId);
    }
    setWords(next);
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
  const reviewWord = (word: SavedWord | null, preferVideoId?: string, practice = false) => {
    if (word) launchReviewOfWord(word, 'words', { preferVideoId });
    else if (practice) launchPracticeLearned('words');
    else launchReview('words');
    onGoToFeed();
  };

  /**
   * The Learned face's button opens the picker over EVERY learned word
   * (Radek: "all of the learned words should come up and you choose"). A
   * chosen word goes through launchReviewOfWord, which brings it forward
   * and lands on it; "Open the feed" with nothing chosen practises a
   * handful (launchPracticeLearned).
   */
  const practise = () => setPicker('learned');

  /** The window is provably gone. Safe to reset, and safe to navigate. */
  const afterDismiss = () => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    setClosing(false);
    setDetail(null);
    setPlaying(null);
    setPicker(false);
    const pending = pendingReviewRef.current;
    pendingReviewRef.current = null;
    if (pending) reviewWord(pending.word, pending.preferVideoId, pending.practice);
  };

  /**
   * Take the window down. Anything that should happen afterwards is parked
   * first and runs from afterDismiss — never from here.
   */
  const closeWindow = (pending?: { word: SavedWord | null; preferVideoId?: string; practice?: boolean }) => {
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
        {/* Radek, on device: people do not know a word can be reviewed from
            this list. One line, where every eye passes on the way to the
            rows. */}
        {words.length > 0 && (
          <Text style={styles.headerHint}>
            Tap a word to hear it, or to review it right here in its video.
          </Text>
        )}
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
            {/* One line, not a billboard (Radek, 2026-09-18): the count is
                the schedule's returns only (core isReady), so it is small
                enough to clear, and the button is the whole call to action. */}
            {dueTotal > 0 && (
              <View style={styles.readyStrip}>
                <View style={styles.readyText}>
                  <Text style={styles.readyCount}>
                    {dueTotal} {dueTotal === 1 ? 'word' : 'words'} ready
                  </Text>
                  <Text style={styles.readyBody} numberOfLines={1}>
                    Pick one to review in its video
                  </Text>
                </View>
                <Pressable
                  onPress={startReview}
                  accessibilityRole="button"
                  accessibilityHint="Choose a word, then the feed opens on it"
                  style={({ pressed }) => [styles.readyCta, pressed && styles.pressed]}
                >
                  <Text style={styles.ctaText}>Review</Text>
                </Pressable>
              </View>
            )}

            {/* The piles, below the review card (Radek: "move them below
                the modal"). Four across, each its count. */}
            <View style={styles.segments} accessibilityRole="tablist">
              {PILES.map((pile) => {
                const on = view === pile.key;
                return (
                  <Pressable
                    key={pile.key}
                    onPress={() => setView(pile.key)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${pile.label}, ${piles[pile.key].length}`}
                    style={({ pressed }) => [
                      styles.segment,
                      on && styles.segmentOn,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.segmentCount, on && styles.segmentCountOn]}>
                      {piles[pile.key].length}
                    </Text>
                    <Text style={[styles.segmentText, on && styles.segmentTextOn]} numberOfLines={1}>
                      {pile.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {view === 'learned' && learnedAll.length > 0 && (
              <View style={styles.learnedCard}>
                <Text style={styles.reviewCount}>
                  {learnedAll.length} {learnedAll.length === 1 ? 'word' : 'words'} learned
                </Text>
                <Text style={styles.reviewBody}>
                  {learnedAll.length - earnedCount > 0
                    ? `${earnedCount} earned from memory, ${learnedAll.length - earnedCount} you already knew. `
                    : 'Right on different days, from memory. '}
                  They come back now and then so they stay yours, or bring a few
                  forward now.
                </Text>
                <Pressable
                  onPress={practise}
                  accessibilityRole="button"
                  accessibilityHint="Choose a learned word, then the feed opens on it"
                  style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
                >
                  <Text style={styles.ctaText}>Practise in the feed</Text>
                </Pressable>
              </View>
            )}

            {pileRows.length === 0 ? (
              query.trim() ? (
                <Text style={styles.noMatch}>No words here match “{query.trim()}”.</Text>
              ) : (
                <View style={styles.pileEmpty}>
                  <Text style={styles.emptyTitle}>
                    {view === 'saved' && 'Nothing waiting'}
                    {view === 'practice' && 'Nothing in practice yet'}
                    {view === 'missed' && 'Nothing missed'}
                    {view === 'learned' && 'Nothing learned yet'}
                  </Text>
                  <Text style={styles.emptyBody}>
                    {view === 'saved' && 'Tap a word in a video to save it.'}
                    {view === 'practice' &&
                      'Get a saved word right once, as a blank, and it moves here.'}
                    {view === 'missed' && 'A word you get wrong lands here until you get it back.'}
                    {view === 'learned' &&
                      `Get a word right on two different days, from memory, and it lands here for good.${onTheWay > 0 ? ` ${onTheWay} on the way.` : ''}`}
                  </Text>
                </View>
              )
            ) : (
              pileRows.map((word) => (
                <WordRow
                  key={wordKey(word)}
                  word={word}
                  now={now}
                  onOpen={() => openDetail(word)}
                />
              ))
            )}
          </>
        )}
      </ScrollView>

      {/* ONE WINDOW. Its contents swap; it never gains a sibling. `visible`
          drops before the contents do, so the slide-out has something to draw
          and afterDismiss can be the only thing that resets state. */}
      <Modal
        visible={(detail !== null || picker) && !closing}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => closeWindow()}
        onDismiss={afterDismiss}
      >
        {picker && detail === null && (
          <ReviewPickerSheet
            kind={picker}
            words={picker === 'learned' ? learnedAll : dueWords}
            onPick={(word) => closeWindow({ word })}
            onFeed={() => closeWindow({ word: null, practice: picker === 'learned' })}
            onClose={() => closeWindow()}
          />
        )}
        {detail !== null &&
          (playing ? (
            <WordVideoPanel
              word={detail}
              occurrence={playing.occurrence}
              video={playing.video}
              mode={playing.mode}
              onClose={() => setPlaying(null)}
              // Answered. Back to the list they were reading, which is still
              // scrolled exactly where they left it.
              onDone={() => closeWindow()}
              // The learned moment's bubble: the window goes down and the
              // list behind it shows the Learned face.
              onSeeLearned={() => {
                setView('learned');
                closeWindow();
              }}
            />
          ) : (
            <WordDetailSheet
              word={detail}
              onClose={() => closeWindow()}
              onRemove={handleRemove}
              /**
               * A word the catalog SPEAKS is reviewed right here, as a
               * flashcard over the clip that says it. A word it does not — a
               * starter-deck word with no clip — has nothing to play, so it
               * falls back to the old behaviour: arm a session and hand the
               * user to the feed.
               */
              onReview={(word, occurrence, video) => {
                if (occurrence && video) {
                  setPlaying({ occurrence, video, mode: 'review' });
                } else {
                  closeWindow({ word });
                }
              }}
              onHear={(occurrence, video) =>
                setPlaying({ occurrence, video, mode: 'listen' })
              }
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
  headerHint: {
    color: 'rgba(242,245,243,0.45)',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 8,
  },
  segments: {
    backgroundColor: 'rgba(242,245,243,0.07)',
    borderRadius: 14,
    flexDirection: 'row',
    marginBottom: 16,
    padding: 3,
  },
  segment: {
    alignItems: 'center',
    borderRadius: 11,
    flex: 1,
    paddingVertical: 7,
  },
  segmentOn: { backgroundColor: '#5ee6a8' },
  segmentCount: { color: '#f2f5f3', fontSize: 16, fontWeight: '800' },
  segmentCountOn: { color: '#06130d' },
  segmentText: { color: 'rgba(242,245,243,0.55)', fontSize: 11, fontWeight: '700', marginTop: 1 },
  segmentTextOn: { color: 'rgba(6,19,13,0.75)' },
  pileEmpty: { alignItems: 'center', gap: 6, paddingTop: 28 },
  learnedCard: {
    backgroundColor: '#141a17',
    borderColor: 'rgba(94,230,168,0.25)',
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 18,
    padding: 18,
  },
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
  readyStrip: {
    alignItems: 'center',
    backgroundColor: 'rgba(94,230,168,0.12)',
    borderRadius: 16,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 8,
  },
  readyText: { flex: 1 },
  readyCount: { color: '#f2f5f3', fontSize: 15, fontWeight: '800' },
  readyBody: { color: 'rgba(242,245,243,0.6)', fontSize: 12, marginTop: 1 },
  readyCta: {
    alignItems: 'center',
    backgroundColor: '#5ee6a8',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 9,
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
  row: {
    backgroundColor: '#151b18',
    borderRadius: 18,
    marginBottom: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowMissed: { backgroundColor: '#1d1717' },
  rowPressed: { opacity: 0.8, transform: [{ scale: 0.99 }] },
  rowTop: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
  rowText: { flex: 1 },
  word: { color: '#f2f5f3', fontSize: 21, fontWeight: '800', letterSpacing: -0.2 },
  translation: {
    color: 'rgba(242,245,243,0.62)',
    fontSize: 15,
    lineHeight: 20,
    marginTop: 2,
  },
  rowMeta: { alignItems: 'center', flexDirection: 'row', gap: 6, marginTop: 10 },
  stateLabel: { fontSize: 12, fontWeight: '700' },
  metaDot: { color: 'rgba(242,245,243,0.25)', fontSize: 12 },
  due: { fontSize: 12 },
  dueNow: { color: '#5ee6a8', fontWeight: '700' },
  dueLater: { color: 'rgba(242,245,243,0.45)' },
  /** Three short segments, the "of 3" felt not read. */
  meter: { flexDirection: 'row', gap: 3, marginTop: 8 },
  meterSeg: { backgroundColor: 'rgba(242,245,243,0.12)', borderRadius: 999, height: 4, width: 12 },
  meterSegOn: { backgroundColor: '#5ee6a8' },
  badge: {
    alignItems: 'center',
    borderRadius: 999,
    height: 24,
    justifyContent: 'center',
    marginTop: 2,
    width: 24,
  },
  badgeLearned: { backgroundColor: 'rgba(94,230,168,0.16)' },
  badgeMissed: { backgroundColor: 'rgba(248,113,113,0.16)' },
  badgeText: { fontSize: 13, fontWeight: '800' },
  badgeTextLearned: { color: '#5ee6a8' },
  badgeTextMissed: { color: '#f87171' },
});
