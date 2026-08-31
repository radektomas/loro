import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { SavedWord, Video } from '@loro/core/types';
import type { AnswerMatch } from '@loro/core/srs';
import { storage } from '@loro/core/storage';
import type { WordOccurrence } from '@loro/core/occurrences';
import { AuthorLine } from '../feed/AuthorLine';
import {
  CELEBRATE_MS,
  LoroCelebrationCenter,
  FeatherBurst,
} from '../feed/Celebration';
import { gradeAnswer, recallHaptic } from '../feed/recall';
import { noteCorrectRecall } from '../platform/notifications';
import { PLAYER_EMBED_ORIGIN } from '../platform/config';
import { buildHearItPage } from './hearItPage';

/**
 * THE WORD, IN A REAL VIDEO — hear it said, then recall it, without leaving
 * the Words tab.
 *
 * WHY THE REVIEW HAPPENS HERE RATHER THAN IN THE FEED. "Review in the feed"
 * used to arm a session and jump tabs, and it was the wrong shape twice over:
 * it worked only for words the feed could plan a blank for, and even then it
 * asked the user to leave the list they were reading to answer one word. This
 * is the same recall mechanic — hear it in context, type it from memory, get
 * the same hop from Loro — collapsed into the window they already have open.
 * Answer it and the window closes, leaving them exactly where they were.
 *
 * ⚠️ IT IS A PANEL, NOT A MODAL. The Words screen presents exactly ONE native
 * window and swaps its contents; a second <Modal> here is what left an
 * invisible window swallowing every touch and froze the Words list. Never wrap
 * this in one.
 *
 * THE PLAYER IS GONE WHILE THEY TYPE, and that is deliberate rather than a
 * layout defeat. With a keyboard up there is no room for a 9:16 frame AND a
 * subtitle line AND an input; the feed reaches the same conclusion from the
 * same corner (recall.ts HIDE_PLAYER_WHILE_TYPING). The word has already been
 * heard by then, so what matters on screen is the sentence with the hole in it.
 * "Play again" brings the player back.
 *
 * EMBED TERMS, unchanged: YouTube's own player with its own controls, nothing
 * of Loro's drawn over the frame, and the attribution line always below it.
 */

/** Lead-in before the word — enough speech to hear it in context. */
const LEAD_IN_S = 3;
/** The beat after the word before the video stops. */
const TAIL_S = 0.5;

/** What the panel is doing. The player exists in the first two only. */
type Phase = 'loading' | 'listening' | 'answering' | 'graded';

export type PanelMode = 'listen' | 'review';

export function WordVideoPanel({
  word,
  occurrence,
  video,
  mode,
  onClose,
  onDone,
}: {
  /** The saved word — its translation is the prompt, and it is what gets graded. */
  word: SavedWord;
  occurrence: WordOccurrence;
  /** The occurrence's catalog record: the cue to render, and the attribution. */
  video: Video;
  /** 'review' goes to the answer as soon as the word has been said. */
  mode: PanelMode;
  /** Back to the word sheet — nothing was answered. */
  onClose: () => void;
  /** Answered. The caller closes the window and returns to the list. */
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [phase, setPhase] = useState<Phase>('loading');
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<AnswerMatch | null>(null);
  /** Raised once the user has committed to answering — 'listen' mode asks. */
  const [reviewing, setReviewing] = useState(mode === 'review');
  /** Bumped to remount the player for "play again". */
  const [take, setTake] = useState(0);

  /**
   * The keyboard's height, so the sentence can centre in the space that is
   * actually VISIBLE while answering — the panel is full-screen and absolute,
   * so the keyboard is not part of its layout and flex alone would centre
   * against the covered bottom half. Same listener split as RecallHost: `will`
   * events on iOS so the content moves with the keyboard's animation; Android
   * only emits `did` — and only iOS feeds the padding below, because Expo's
   * default `resize` mode already shrinks the Android window under a keyboard
   * and padding on top of that would compensate twice.
   */
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (event) =>
      setKeyboardHeight(event.endCoordinates.height)
    );
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const keyboardInset = Platform.OS === 'ios' ? keyboardHeight : 0;

  const cue = video.cues[occurrence.cueIndex];
  const spoken = cue?.words[occurrence.wordIndex]?.text ?? word.text;
  const language = storage.getLanguage();
  const cueTranslation = cue
    ? (cue.translations[language] ?? cue.translations.en ?? null)
    : null;

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    []
  );

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let parsed: { type?: string } = {};
      try {
        parsed = JSON.parse(event.nativeEvent.data) as { type?: string };
      } catch {
        return; // Not ours; the page posts nothing else.
      }
      if (parsed.type === 'playing') setPhase('listening');
      else if (parsed.type === 'error') setPhase('listening');
      else if (parsed.type === 'heard') {
        // THE MOMENT THE WORD HAS BEEN SAID is the moment to ask for it —
        // which is the whole reason this page stops the video at all.
        setPhase(reviewing ? 'answering' : 'listening');
      }
    },
    [reviewing]
  );

  const playAgain = useCallback(() => {
    setPhase('loading');
    setTake((n) => n + 1);
  }, []);

  /**
   * Grade once, exactly the way the feed grades a recall blank — same core
   * comparison, same SRS write, same half-credit on the level meter, same
   * haptic and the same note to the notification scheduler. A review that
   * counted for less here than in the feed would be a different feature
   * wearing the same name.
   */
  const submit = () => {
    if (phase === 'graded') return;
    Keyboard.dismiss();
    const match = gradeAnswer(answer, word);
    const wasCorrect = match !== 'wrong';
    storage.gradeWord(word.text, word.videoId, wasCorrect);
    if (wasCorrect) {
      storage.applyRecallLevelCredit();
      recallHaptic();
      noteCorrectRecall();
    }
    setResult(match);
    setPhase('graded');
    // A near-miss counts as correct (core's matchAnswer), so it earns the same
    // exit — only slower, because the corrected spelling is worth reading.
    if (wasCorrect) {
      closeTimer.current = setTimeout(
        onDone,
        match === 'correct' ? CELEBRATE_MS : CELEBRATE_MS + 700
      );
    }
  };

  const showPlayer = phase === 'loading' || phase === 'listening';

  /**
   * The frame: 9:16, as tall as what sits under it allows. BOTTOM_BAND covers
   * the subtitle line, the attribution and the buttons; the player takes the
   * rest, capped by width so a narrow phone letterboxes sideways rather than
   * cropping.
   */
  const BOTTOM_BAND = 296;
  const available = height - insets.top - insets.bottom - BOTTOM_BAND;
  const frameHeight = Math.max(200, Math.min(available, (width * 16) / 9));
  const frameWidth = Math.min(width, (frameHeight * 9) / 16);

  const youtubeId = occurrence.youtubeId;
  if (!youtubeId || !cue) return null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {showPlayer && (
        <View style={[styles.playerBox, { height: frameHeight, width: frameWidth }]}>
          <WebView
            key={`${occurrence.videoId}-${occurrence.cueIndex}-${take}`}
            source={{
              html: buildHearItPage({
                videoId: youtubeId,
                startSeconds: Math.max(0, occurrence.start - LEAD_IN_S),
                stopSeconds: occurrence.end + TAIL_S,
                embedOrigin: PLAYER_EMBED_ORIGIN,
              }),
              // Must match the page's `origin` playerVar — the IFrame API
              // handshake compares them.
              baseUrl: PLAYER_EMBED_ORIGIN,
            }}
            originWhitelist={['*']}
            style={styles.webview}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
            domStorageEnabled={false}
            allowsBackForwardNavigationGestures={false}
            onMessage={onMessage}
          />
          {phase === 'loading' && (
            <View style={styles.loading} pointerEvents="none">
              <ActivityIndicator color="rgba(242,245,243,0.6)" />
            </View>
          )}
        </View>
      )}

      {/* Everything of Loro's lives BELOW the frame, never over it. */}
      <View
        style={[
          styles.below,
          { paddingBottom: Math.max(insets.bottom, keyboardInset) + 12 },
        ]}
      >
        {showPlayer && (
          <View style={styles.attribution}>
            <AuthorLine video={video} />
          </View>
        )}

        {/* THE PLAYER GONE, THE SENTENCE TAKES THE STAGE. With the frame on
            screen the sentence reads as a subtitle and belongs right under it;
            once the player yields, a line hugging the top of an empty screen
            reads as a leftover. These spacers float the question group to the
            optical middle of whatever is visible — the keyboard padding above
            keeps "visible" honest while typing — with slightly more room below
            so it sits a touch above true centre. Spacers, not justifyContent:
            the actions row must stay pinned at the bottom either way. */}
        {!showPlayer && <View style={styles.stageAbove} />}

        {/* THE SENTENCE, WITH THE HOLE IN IT. Present from the first frame:
            it is the context while the clip plays and the question the moment
            it stops. */}
        <ScrollView
          style={styles.cueScroll}
          contentContainerStyle={styles.cueContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.line}>
            {cue.words.map((cueWord, index) =>
              index === occurrence.wordIndex ? (
                <View key={index} style={styles.slotWrap}>
                  <View
                    style={[
                      styles.slot,
                      result === 'correct' && styles.slotCorrect,
                      result === 'almost' && styles.slotAlmost,
                      result === 'wrong' && styles.slotWrong,
                    ]}
                  >
                    <Text
                      style={[
                        styles.wordText,
                        result === 'correct' && styles.textCorrect,
                        result === 'almost' && styles.textAlmost,
                        result === 'wrong' && styles.textWrong,
                      ]}
                    >
                      {result ? spoken : '____'}
                    </Text>
                  </View>
                  {/* Sibling of the clipping box, so the feathers can leave it. */}
                  {(result === 'correct' || result === 'almost') && (
                    <FeatherBurst variant={result} />
                  )}
                </View>
              ) : (
                <Text key={index} style={[styles.wordText, styles.plainWord]}>
                  {cueWord.text}
                </Text>
              )
            )}
          </View>
          {cueTranslation && (
            <Text style={styles.cueTranslation}>{cueTranslation}</Text>
          )}
        </ScrollView>

        {phase === 'answering' && (
          <View style={styles.answerBlock}>
            <Text style={styles.prompt}>{word.translation}</Text>
            <View style={styles.inputRow}>
              <TextInput
                value={answer}
                onChangeText={setAnswer}
                onSubmitEditing={submit}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                returnKeyType="done"
                placeholder="Type the word"
                placeholderTextColor="rgba(242,245,243,0.3)"
                accessibilityLabel={`Type the Spanish for ${word.translation}`}
                style={styles.input}
              />
              <Pressable
                onPress={submit}
                accessibilityRole="button"
                style={({ pressed }) => [styles.check, pressed && styles.pressed]}
              >
                <Text style={styles.checkLabel}>Check</Text>
              </Pressable>
            </View>
          </View>
        )}

        {phase === 'graded' && result === 'wrong' && (
          <Text style={styles.wrongNote}>
            It was «{spoken}» — you typed «{answer.trim() || '—'}».
          </Text>
        )}

        {/* The other half of the centring — see stageAbove. */}
        {!showPlayer && <View style={styles.stageBelow} />}

        {/* ⚠️ While the keyboard is up, `marginTop: auto` would push these
            under it — the panel is full-screen and the keyboard is not part of
            its layout. Answering pins them directly below the input instead. */}
        <View
          style={[
            styles.actions,
            phase === 'answering' && styles.actionsTight,
          ]}
        >
          {/* Shown in BOTH modes, and in review mode it is the escape hatch
              rather than a nicety: if the page's stop watcher never reports —
              a blocked autoplay, a user who paused the clip — this is the only
              way to reach the answer. */}
          {phase === 'listening' && (
            <Pressable
              onPress={() => {
                setReviewing(true);
                setPhase('answering');
              }}
              accessibilityRole="button"
              accessibilityHint="Type the word from memory"
              style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            >
              <Text style={styles.primaryLabel}>
                {reviewing ? 'Answer now' : 'Review it now'}
              </Text>
            </Pressable>
          )}
          <View style={styles.secondaryRow}>
            {(phase === 'listening' || phase === 'answering' ||
              (phase === 'graded' && result === 'wrong')) && (
              <Pressable
                onPress={playAgain}
                accessibilityRole="button"
                style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
              >
                <Text style={styles.secondaryLabel}>Play again</Text>
              </Pressable>
            )}
            <Pressable
              onPress={phase === 'graded' ? onDone : onClose}
              accessibilityRole="button"
              accessibilityLabel="Back to your words"
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            >
              <Text style={styles.secondaryLabel}>
                {phase === 'graded' ? 'Done' : 'Back to the word'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* Loro takes centre stage, not the feed's corner hop: by grading time
          the frame is gone and the panel is closing, so the reward is the
          screen — see LoroCelebrationCenter's header for why the feed keeps
          the small one. */}
      {(result === 'correct' || result === 'almost') && (
        <LoroCelebrationCenter variant={result} />
      )}
    </View>
  );
}

const ACCENT = '#5ee6a8';
const ALMOST = '#f2c14e';
const WRONG = '#ff8b7a';

const styles = StyleSheet.create({
  /** Opaque and full-bleed: the host window is transparent (it also carries
      the dimmed word sheet), so this panel paints its own ground. */
  root: {
    alignItems: 'center',
    backgroundColor: '#0a0d0b',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  playerBox: { backgroundColor: '#000' },
  webview: { backgroundColor: '#000', flex: 1 },
  loading: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  below: { flex: 1, paddingHorizontal: 20, paddingTop: 12, width: '100%' },
  attribution: { marginBottom: 10 },
  /** Capped so a long line cannot push the input off the top of the
      keyboard; it scrolls inside instead. */
  cueScroll: { flexGrow: 0, flexShrink: 1, maxHeight: 240 },
  cueContent: { paddingBottom: 4 },
  line: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap' },
  wordText: { fontSize: 22, fontWeight: '700', lineHeight: 30 },
  plainWord: { color: '#f2f5f3', paddingHorizontal: 3 },
  slotWrap: { marginHorizontal: 3 },
  slot: {
    borderBottomColor: ACCENT,
    borderBottomWidth: 2,
    minWidth: 64,
    overflow: 'hidden',
    paddingHorizontal: 6,
  },
  slotCorrect: { borderBottomColor: ACCENT },
  slotAlmost: { borderBottomColor: ALMOST },
  slotWrong: { borderBottomColor: WRONG },
  textCorrect: { color: ACCENT },
  textAlmost: { color: ALMOST },
  textWrong: { color: WRONG },
  cueTranslation: {
    color: 'rgba(242,245,243,0.55)',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  answerBlock: { marginTop: 14 },
  prompt: { color: 'rgba(242,245,243,0.7)', fontSize: 15, marginBottom: 8 },
  inputRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  input: {
    backgroundColor: 'rgba(242,245,243,0.08)',
    borderRadius: 14,
    color: '#f2f5f3',
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  check: {
    alignItems: 'center',
    backgroundColor: ACCENT,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  checkLabel: { color: '#06130d', fontSize: 15, fontWeight: '800' },
  wrongNote: {
    color: 'rgba(242,245,243,0.7)',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 12,
  },
  actions: { marginTop: 'auto', paddingTop: 12 },
  actionsTight: { marginTop: 16 },
  primary: {
    alignItems: 'center',
    backgroundColor: ACCENT,
    borderRadius: 16,
    paddingVertical: 15,
  },
  primaryLabel: { color: '#06130d', fontSize: 16, fontWeight: '800' },
  secondaryRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  secondary: {
    alignItems: 'center',
    backgroundColor: 'rgba(242,245,243,0.10)',
    borderRadius: 16,
    flex: 1,
    paddingVertical: 13,
  },
  secondaryLabel: { color: '#f2f5f3', fontSize: 14, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  /** The centring pair — grow-only, so a tall sentence plus keyboard simply
      collapses them back to today's top-anchored layout. */
  stageAbove: { flexGrow: 1, flexShrink: 0 },
  stageBelow: { flexGrow: 1.25, flexShrink: 0 },
});
