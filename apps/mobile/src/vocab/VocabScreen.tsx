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
import { distinctWords, isLearned } from '@loro/core/progress';
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
  known: { human: 'Known ✓', tone: 'accent' },
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

/** "Ready now" / "Review in 10 min" / "Review in 2 days". */
function friendlyDue(word: SavedWord, now: number): string {
  if (word.dueAt <= now) return 'Ready now';
  return `Review ${formatDue(word.dueAt, now)}`;
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
 * "2 of 3" — how close this word is to Learned, in words a stranger reads on
 * the first pass.
 *
 * THIS REPLACED THE LEITNER DOT METER (2026-09-01, Radek: "we have like the
 * 5 dots but i don't think anybody gets that" — it was six, which is the
 * point). The dots measured box-of-MAX_BOX, so a word ONE correct answer
 * from flipping to Learned showed a third of a meter, and nothing anywhere
 * said what a dot was. Progress here is measured against KNOWN_BOX — the
 * exact threshold stateForBox flips on — so the number, the fill bar and
 * the "Learned ✓" flip all tell one story. Boxes past KNOWN_BOX keep
 * spacing reviews out (that is the schedule's business, shown by the due
 * line); they are not a ladder the user is asked to read.
 *
 * Rendered only for new/learning: a lapsed row already carries the one
 * message that matters ("Slipped"), and a learned row's count is over.
 */
function ProgressCount({ word }: { word: SavedWord }) {
  if (word.state !== 'new' && word.state !== 'learning') return null;
  return (
    <Text style={styles.progressCount}>
      {Math.min(word.box, KNOWN_BOX)} of {KNOWN_BOX}
    </Text>
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
  // Earned, not merely filed: core's isLearned. A starter-deck grant is
  // 'known' and says so; only a word the review loop earned says Learned.
  const human = isLearned(word) ? 'Learned ✓' : meta.human;
  // Felt progress toward LEARNED, not toward the top of the schedule: the
  // bar moves by thirds and hits full exactly when the row flips to
  // "Learned ✓". Measuring against MAX_BOX made a nearly-learned word look
  // a third done — see ProgressCount for the whole verdict.
  const fillPct = isKnown ? 100 : (Math.min(word.box, KNOWN_BOX) / KNOWN_BOX) * 100;
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
            {/* Radek, 2026-09-18: the Spanish should lead and the meaning
                should read as the meaning. A quiet box, not a second line
                of the same grey. */}
            <View style={styles.meaningBox}>
              <Text style={styles.translation} numberOfLines={2}>
                {word.translation}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.rowMeta}>
          <Text style={[styles.stateLabel, { color: TONE_COLOR[meta.tone] }]}>
            {human}
          </Text>
          <ProgressCount word={word} />
          <Text
            style={[
              styles.due,
              word.dueAt <= now ? styles.dueNow : styles.dueLater,
            ]}
          >
            {friendlyDue(word, now)}
          </Text>
          {/* The affordance the row was missing: a row that opens something
              should look like it opens something. */}
          <Text style={styles.rowChevron}>›</Text>
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
    () => words.filter((w) => w.dueAt <= now).length,
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
        .filter((w) => w.dueAt <= now)
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
            {dueTotal > 0 && (
              <View style={styles.reviewCard}>
                <Text style={styles.reviewCount}>
                  {dueTotal} {dueTotal === 1 ? 'word' : 'words'} ready to review
                </Text>
                <Text style={styles.reviewBody}>
                  Pick one and the feed opens just before it, as a blank to fill.
                  Or tap any word below to review it right here.
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
  word: { color: '#f2f5f3', fontSize: 21, fontWeight: '800', letterSpacing: -0.2 },
  meaningBox: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(242,245,243,0.07)',
    borderRadius: 8,
    marginTop: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  translation: {
    color: 'rgba(242,245,243,0.85)',
    fontSize: 14,
    lineHeight: 18,
  },
  rowMeta: { alignItems: 'center', flexDirection: 'row', gap: 10, marginTop: 10 },
  stateLabel: { fontSize: 12, fontWeight: '700' },
  /** Sits where the dot meter used to; muted so the state phrase leads. */
  progressCount: {
    color: 'rgba(242,245,243,0.45)',
    fontSize: 12,
    fontWeight: '600',
  },
  due: { fontSize: 12, marginLeft: 'auto' },
  rowChevron: { color: 'rgba(242,245,243,0.35)', fontSize: 18, fontWeight: '600', marginTop: -2 },
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
