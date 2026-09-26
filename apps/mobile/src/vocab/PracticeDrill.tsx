import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SavedWord } from '@loro/core/types';
import type { AnswerMatch } from '@loro/core/srs';
import { normalizeAnswer } from '@loro/core/srs';
import { isDoneOnPath } from '@loro/core/roadmap';
import { getCatalog } from '@loro/core/catalog';
import { collectionVideos } from '@loro/core/catalog/collectionVideos';
import { normalizeSurface } from '@loro/core/dictionary';
import { storage } from '@loro/core/storage';
import { gradeAnswer, recallHaptic } from '../feed/recall';
import { openedByLearn } from '../feed/wordLearned';
import { track } from '../platform/analytics';
import { BRAND } from '../onboarding/brand';

/**
 * THE PRACTICE SET — how a word is TRAINED in the Words tab (Radek,
 * 2026-09-26: "i thought you will click the word and have the 3 practises";
 * "when he trains the word by exercise in the words tab it becomes learned
 * and then he practises in the feed").
 *
 * Three exercises, never the feed:
 *   with a clip:    1. hear it, type it (WordVideoPanel)  2. meaning  3. say it
 *   without a clip: 1. meaning  2. which one is it  3. say it
 *
 * A WRONG ANSWER IS ASKED AGAIN until it is right ("when user has one wrong
 * even in the practise tell him to do it again till he gets it right") — the
 * right answer is shown first, then the same exercise comes back reshuffled.
 * So finishing the set means every exercise was answered right, and that
 * trains the word (storage.trainWord: learned, live in the feed in ten
 * minutes). A word already learned is practice; nothing is written.
 *
 * THE FINISH is a moment, not a card: "¡Eso es!" pops, then Loro and the
 * word's week in the feed — the schedule srs.trainWord + isEarlyAnswer
 * actually produce (10 min, then daily for three days, then about a week).
 */

const MINT = '#5ee6a8';
const INK = '#f2f5f3';
const ALMOST = '#f2c14e';
const WRONG = '#ff8b7a';

type Step = 'meaning' | 'pick' | 'produce' | 'summary';

/** When the feed will ask a freshly trained word (see the header). */
const FEED_WEEK = ['Later today', 'Tomorrow', 'Day 3', 'Next week'];

function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Parts of speech worth being a wrong answer — "de" or "la" would be a giveaway. */
const CONTENT_POS = new Set(['noun', 'verb', 'adj', 'adv']);

/**
 * THREE WRONG ANSWERS, ALWAYS (Radek, 2026-09-26: a new user "is choosing
 * from 4 hes actually choosing just from one"). A first-day user has one or
 * two saved words, so their own list cannot fill a multiple choice. In
 * order, until there are three:
 *   1. their own other saved words — the most plausible to THEM;
 *   2. words from the video this word was saved from, same part of speech
 *      first (a verb among verbs is a real question), content words only;
 *   3. the same from any other video in the catalog.
 * Never this word, never a twin of it or of each other.
 */
function others(word: SavedWord, all: readonly SavedWord[], field: 'text' | 'translation'): string[] {
  const language = storage.getLanguage();
  const seen = new Set<string>([normalizeAnswer(word[field]), normalizeAnswer(word.text)]);
  const out: string[] = [];
  const take = (text: string, translation: string) => {
    if (out.length >= 3) return;
    const value = (field === 'text' ? text : translation).trim();
    const key = normalizeAnswer(value);
    if (!key || seen.has(key) || seen.has(normalizeAnswer(text))) return;
    seen.add(key);
    seen.add(normalizeAnswer(text));
    out.push(value);
  };

  for (const w of shuffle(all)) take(w.text, w.translation);
  if (out.length >= 3) return out;

  const videos = [...getCatalog(), ...collectionVideos];
  const source = videos.find((v) => v.id === word.videoId);
  const pos = source?.dictionary[normalizeSurface(word.text)]?.pos ?? null;
  const fromVideo = (videoList: typeof videos, samePos: boolean) => {
    for (const video of videoList) {
      for (const [surface, gloss] of shuffle(Object.entries(video.dictionary))) {
        if (out.length >= 3) return;
        if (!CONTENT_POS.has(gloss.pos)) continue;
        if (samePos && pos && gloss.pos !== pos) continue;
        const meaning = gloss.glosses[language] ?? gloss.glosses.en;
        if (meaning) take(surface, meaning);
      }
    }
  };
  if (source) {
    fromVideo([source], true);
    fromVideo([source], false);
  }
  // Any other video, a handful at random: enough to finish, cheap to scan.
  if (out.length < 3) fromVideo(shuffle(videos).slice(0, 6), true);
  if (out.length < 3) fromVideo(shuffle(videos).slice(0, 6), false);
  return out;
}

function Progress({ done }: { done: number }) {
  return (
    <View style={styles.progress}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.progressSeg, i < done && styles.progressSegOn]} />
      ))}
    </View>
  );
}

/**
 * A multiple choice. A right pick lights and moves on; a wrong one goes red,
 * the right one lights so it can be read, and the parent remounts this
 * (new key) to ask again, reshuffled.
 */
function Choices({
  options,
  right,
  onRight,
  onWrong,
}: {
  options: string[];
  right: string;
  onRight: () => void;
  onWrong: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <View style={styles.options}>
      {options.map((option) => {
        const state =
          picked === null ? null : option === right ? 'right' : option === picked ? 'wrong' : 'idle';
        return (
          <Pressable
            key={option}
            onPress={() => {
              if (picked !== null) return;
              setPicked(option);
              if (option === right) onRight();
              else onWrong();
            }}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.option,
              state === 'right' && styles.optionRight,
              state === 'wrong' && styles.optionWrong,
              state === 'idle' && styles.optionIdle,
              pressed && picked === null && styles.pressed,
            ]}
          >
            <Text style={[styles.optionText, state === 'right' && { color: MINT }]} numberOfLines={2}>
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Springs its children in: scale from `from`, fade from 0, after `delay`. */
function PopIn({
  children,
  delay = 0,
  from = 0.6,
  style,
}: {
  children: ReactNode;
  delay?: number;
  from?: number;
  style?: object;
}) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.delay(delay),
      Animated.spring(v, { toValue: 1, friction: 6, tension: 90, useNativeDriver: true }),
    ]).start();
  }, [v, delay]);
  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [from, 1] });
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ scale }] }]}>{children}</Animated.View>
  );
}

/** The word's week in the feed: four stops that light one by one. */
function FeedWeek() {
  return (
    <View style={styles.week}>
      <View style={styles.weekRail} />
      {FEED_WEEK.map((label, i) => (
        <PopIn key={label} delay={900 + i * 220} from={0.2} style={styles.weekStop}>
          <View style={styles.weekDot} />
          <Text style={styles.weekLabel}>{label}</Text>
        </PopIn>
      ))}
    </View>
  );
}

export function PracticeDrill({
  word,
  stepOne,
  onDone,
}: {
  word: SavedWord;
  /** How the clip went, when there was one. Absent: three exercises here. */
  stepOne?: AnswerMatch;
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  const steps: Step[] = stepOne ? ['meaning', 'produce'] : ['meaning', 'pick', 'produce'];
  const offset = stepOne ? 1 : 0;
  const [index, setIndex] = useState(0);
  const step: Step = index < steps.length ? steps[index] : 'summary';
  /** Wrong answers along the way — asked again, and counted for analytics. */
  const misses = useRef(0);
  /** Bumped to ask a multiple choice again, reshuffled. */
  const [round, setRound] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const [typed, setTyped] = useState('');
  const [produced, setProduced] = useState<AnswerMatch | null>(null);
  const inputRef = useRef<TextInput>(null);
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => setKeyboard(e.endCoordinates.height)
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboard(0)
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const all = useMemo(() => storage.getSavedWords(), []);
  // `round` reshuffles on a retry, so the right answer is not where it was.
  const meaningOptions = useMemo(
    () => (round >= 0 ? shuffle([word.translation, ...others(word, all, 'translation')]) : []),
    [word, all, round]
  );
  const wordOptions = useMemo(
    () => (round >= 0 ? shuffle([word.text, ...others(word, all, 'text')]) : []),
    [word, all, round]
  );

  const next = () => {
    setRound(0);
    setIndex((i) => i + 1);
  };
  const right = () => {
    recallHaptic();
    timer.current = setTimeout(next, 700);
  };
  const wrong = () => {
    misses.current++;
    // Long enough to read the right one, then the same question again.
    timer.current = setTimeout(() => setRound((r) => r + 1), 1600);
  };

  const check = (textNow?: string) => {
    if (produced !== null) return;
    const answer = textNow ?? typed;
    if (textNow !== undefined) setTyped(textNow);
    const match = gradeAnswer(answer, word);
    setProduced(match);
    if (match === 'wrong') {
      misses.current++;
      return;
    }
    recallHaptic();
    Keyboard.dismiss();
    // The last one right: "¡Eso es!" has its beat, then the finish.
    timer.current = setTimeout(next, 1100);
  };
  const tryAgain = () => {
    setProduced(null);
    setTyped('');
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  /** The one write, on arrival at the finish. */
  const [finish, setFinish] = useState<null | {
    already: boolean;
    next: { text: string; translation: string } | null;
  }>(null);
  useEffect(() => {
    if (step !== 'summary' || finish) return;
    const row = storage
      .getSavedWords()
      .find((w) => w.text === word.text && w.videoId === word.videoId);
    const already = row !== undefined && isDoneOnPath(row);
    if (!already) storage.trainWord(word.text, word.videoId);
    track('practice_set', {
      misses: misses.current,
      clip: stepOne !== undefined,
      outcome: already ? 'practice' : 'trained',
    });
    setFinish({ already, next: already ? null : openedByLearn(storage.getSavedWords()) });
  }, [step, finish, word, stepOne]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.topRow}>
        <Progress done={Math.min(3, offset + index)} />
        {step !== 'summary' && (
          <Pressable onPress={onDone} accessibilityRole="button" accessibilityLabel="Stop practising" hitSlop={12}>
            <Text style={styles.close}>✕</Text>
          </Pressable>
        )}
      </View>

      {step === 'meaning' && (
        <View style={styles.body}>
          <Text style={styles.kicker}>{round > 0 ? 'ONE MORE TIME' : 'WHAT DOES IT MEAN?'}</Text>
          <Text style={styles.big}>{word.text}</Text>
          <Choices key={`m${round}`} options={meaningOptions} right={word.translation} onRight={right} onWrong={wrong} />
        </View>
      )}

      {step === 'pick' && (
        <View style={styles.body}>
          <Text style={styles.kicker}>{round > 0 ? 'ONE MORE TIME' : 'WHICH ONE IS IT?'}</Text>
          <Text style={styles.big}>{word.translation}</Text>
          <Choices key={`p${round}`} options={wordOptions} right={word.text} onRight={right} onWrong={wrong} />
        </View>
      )}

      {step === 'produce' && (
        <View style={[styles.body, { paddingBottom: Platform.OS === 'ios' ? keyboard : 0 }]}>
          <Text style={styles.kicker}>SAY IT IN SPANISH</Text>
          <Text style={styles.big}>{word.translation}</Text>
          <View style={styles.inputRow}>
            <TextInput
              ref={inputRef}
              value={typed}
              onChangeText={setTyped}
              onSubmitEditing={(e) => check(e.nativeEvent.text)}
              editable={produced === null}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              returnKeyType="done"
              placeholder="Type it in Spanish"
              placeholderTextColor="rgba(242,245,243,0.3)"
              accessibilityLabel={`Type the Spanish for ${word.translation}`}
              style={[
                styles.input,
                produced === 'correct' && { borderColor: MINT },
                produced === 'almost' && { borderColor: ALMOST },
                produced === 'wrong' && { borderColor: WRONG },
              ]}
            />
            {produced === null && (
              <Pressable
                onPress={() => check()}
                accessibilityRole="button"
                style={({ pressed }) => [styles.check, pressed && styles.pressed]}
              >
                <Text style={styles.checkLabel}>Check</Text>
              </Pressable>
            )}
          </View>
          {produced !== null && produced !== 'wrong' && (
            <PopIn from={0.4} style={styles.esoWrap}>
              <Text style={[styles.eso, produced === 'almost' && { color: ALMOST }]}>
                {produced === 'correct' ? '¡Eso es!' : `¡Casi! «${word.text}»`}
              </Text>
            </PopIn>
          )}
          {produced === 'wrong' && (
            <>
              <Text style={[styles.verdict, { color: WRONG }]}>
                It's «{word.text}». Type it once more.
              </Text>
              <Pressable
                onPress={tryAgain}
                accessibilityRole="button"
                style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
              >
                <Text style={styles.primaryLabel}>Try again</Text>
              </Pressable>
            </>
          )}
        </View>
      )}

      {step === 'summary' && finish && (
        <View style={styles.body}>
          <PopIn from={0.3} style={styles.loroWrap}>
            <Animated.Image source={BRAND.parrotWaving} style={styles.loro} resizeMode="contain" />
          </PopIn>
          <PopIn delay={250} from={0.8}>
            <Text style={styles.kicker}>{finish.already ? 'PRACTICE DONE' : 'LEARNED'}</Text>
            <Text style={styles.big}>{finish.already ? '¡Muy bien!' : '¡Aprendida!'}</Text>
          </PopIn>
          <PopIn delay={500} from={0.95}>
            <Text style={styles.summaryBody}>
              {finish.already
                ? `«${word.text}» is already yours. Your videos keep bringing it back.`
                : `«${word.text}» will now pop up in your videos over the next week. Answer it there and it sticks for good.`}
            </Text>
          </PopIn>
          {!finish.already && <FeedWeek />}
          {finish.next && (
            <PopIn delay={1900} from={0.9} style={styles.nextCard}>
              <Text style={styles.nextLabel}>NEXT UP</Text>
              <Text style={styles.nextWord}>
                {finish.next.text}
                <Text style={styles.nextMeaning}>  {finish.next.translation}</Text>
              </Text>
            </PopIn>
          )}
          <PopIn delay={finish.already ? 700 : 2100} from={0.9}>
            <Pressable
              onPress={onDone}
              accessibilityRole="button"
              style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            >
              <Text style={styles.primaryLabel}>Continue</Text>
            </Pressable>
          </PopIn>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: '#0a0d0b',
    bottom: 0,
    left: 0,
    paddingHorizontal: 20,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  pressed: { opacity: 0.7 },
  topRow: { alignItems: 'center', flexDirection: 'row', gap: 14 },
  close: { color: 'rgba(242,245,243,0.5)', fontSize: 18, fontWeight: '700' },
  progress: { flex: 1, flexDirection: 'row', gap: 6 },
  progressSeg: { backgroundColor: 'rgba(242,245,243,0.1)', borderRadius: 999, flex: 1, height: 6 },
  progressSegOn: { backgroundColor: MINT },
  body: { flex: 1, justifyContent: 'center' },
  kicker: { color: MINT, fontSize: 12, fontWeight: '900', letterSpacing: 1.4 },
  big: { color: INK, fontSize: 34, fontWeight: '900', marginBottom: 22, marginTop: 8 },
  options: { gap: 10 },
  option: {
    backgroundColor: '#151b18',
    borderColor: 'rgba(242,245,243,0.08)',
    borderRadius: 16,
    borderWidth: 2,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  optionRight: { backgroundColor: 'rgba(94,230,168,0.14)', borderColor: MINT },
  optionWrong: { backgroundColor: 'rgba(255,139,122,0.12)', borderColor: WRONG },
  optionIdle: { opacity: 0.45 },
  optionText: { color: INK, fontSize: 17, fontWeight: '700' },
  inputRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  input: {
    backgroundColor: 'rgba(242,245,243,0.08)',
    borderColor: 'transparent',
    borderRadius: 14,
    borderWidth: 2,
    color: INK,
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  check: {
    alignItems: 'center',
    backgroundColor: MINT,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 15,
  },
  checkLabel: { color: '#06130d', fontSize: 15, fontWeight: '800' },
  verdict: { fontSize: 16, fontWeight: '800', marginTop: 14 },
  esoWrap: { alignSelf: 'flex-start', marginTop: 18 },
  eso: { color: MINT, fontSize: 30, fontWeight: '900' },
  loroWrap: { alignSelf: 'center', marginBottom: 14 },
  loro: { height: 140, width: 125 },
  summaryBody: { color: 'rgba(242,245,243,0.72)', fontSize: 16, lineHeight: 23, marginTop: -8 },
  week: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 24 },
  weekRail: {
    backgroundColor: 'rgba(94,230,168,0.25)',
    height: 2,
    left: 36,
    position: 'absolute',
    right: 36,
    top: 6,
  },
  weekStop: { alignItems: 'center', width: 76 },
  weekDot: {
    backgroundColor: MINT,
    borderColor: '#0a0d0b',
    borderRadius: 999,
    borderWidth: 3,
    height: 14,
    width: 14,
  },
  weekLabel: {
    color: 'rgba(242,245,243,0.7)',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 6,
    textAlign: 'center',
  },
  nextCard: {
    backgroundColor: 'rgba(94,230,168,0.1)',
    borderRadius: 14,
    marginTop: 22,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  nextLabel: { color: MINT, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  nextWord: { color: INK, fontSize: 18, fontWeight: '900', marginTop: 3 },
  nextMeaning: { color: 'rgba(242,245,243,0.6)', fontSize: 14, fontWeight: '600' },
  primary: {
    alignItems: 'center',
    backgroundColor: MINT,
    borderRadius: 16,
    marginTop: 22,
    paddingVertical: 15,
  },
  primaryLabel: { color: '#06130d', fontSize: 16, fontWeight: '800' },
});
