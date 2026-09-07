import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SavedWord } from '@loro/core/types';
import { getCatalog } from '@loro/core/catalog';
import { normalizeSurface } from '@loro/core/dictionary';
import { spokenSurfaces } from '@loro/core/occurrences';

/**
 * THE REVIEW PICKER — "which word?", asked before the feed opens.
 *
 * Radek, 2026-09-07: "after you click the button a modal comes and you can
 * choose which word you want to review, the app throws you on a video with
 * that word 3 seconds before it". The jump itself already existed behind
 * the Words tab's detail sheet (launchReviewOfWord, three-second lead-in in
 * FeedScreen's PlayerDriver); this puts a list in front of it.
 *
 * TWO PIECES, ON PURPOSE. ReviewPickerSheet is the CONTENT — a bottom sheet
 * that assumes it is already inside a window. ReviewPicker wraps it in its
 * own <Modal> for the Progress tab, which presents nothing else. The Words
 * tab does NOT use the wrapper: that screen keeps exactly one native window
 * and swaps faces inside it (VocabScreen's ONE WINDOW note — two Modals on
 * one screen is how that tab once came back frozen), so it renders the sheet
 * as another face of the window it already has.
 *
 * ⚠️ NOTHING NAVIGATES WHILE THE WINDOW IS STILL ON SCREEN. A tap PARKS its
 * choice, drops `visible`, and the choice runs from onDismiss, when the
 * window is provably gone; the timer is the belt to those braces, because
 * onDismiss is iOS-only. The wrapper does this itself; the Words tab's own
 * dismissal dance does it there.
 *
 * WORDS NO VIDEO SPEAKS ARE NOT LISTED (Radek, on device: a word the feed
 * cannot land on "definitely shouldn't be there"). A footnote carries the
 * count so the list still reconciles with the card's "N ready". "Spoken" is
 * the PLANNER's definition (spokenSurfaces) — the same one the landing
 * logic uses — so a word listed here is a word the tap can deliver.
 *
 * RANDOM, NOT "MOST URGENT". The first version put a "whatever is most
 * urgent" row on top and Radek did not like it: the list is the user's own
 * words and the top row was the app's opinion. So the escape hatch for
 * someone who cannot be bothered to choose is a Random button at the
 * bottom, drawn from the words that can actually land.
 */

/** How long to wait for onDismiss before assuming it is not coming. */
const DISMISS_FALLBACK_MS = 600;

export function ReviewPickerSheet({
  words,
  onPick,
  onFeed,
  onClose,
}: {
  /** Due words, most urgent first — the caller's ordering is kept. */
  words: SavedWord[];
  /** A word was chosen (by tap or by Random). The caller parks it and
      launches AFTER its window is gone. */
  onPick: (word: SavedWord) => void;
  /** Nothing can land, but the user still wants the feed. */
  onFeed: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  /** One catalog pass per mount; the sheet is mounted per opening. */
  const spoken = useMemo(() => spokenSurfaces(getCatalog()), []);
  const rows = useMemo(() => {
    const playable: SavedWord[] = [];
    let silent = 0;
    for (const w of words) {
      if (spoken.has(normalizeSurface(w.text))) playable.push(w);
      else silent++;
    }
    return { playable, silent };
  }, [words, spoken]);

  const random = () => {
    const pool = rows.playable;
    if (pool.length === 0) return;
    onPick(pool[Math.floor(Math.random() * pool.length)]);
  };

  return (
    <View style={styles.backdrop}>
      {/* The dim above the sheet closes it — the same gesture every sheet
          in the app answers to. */}
      <Pressable
        style={styles.dismissArea}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
      />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.grabber} />
        <Text style={styles.title}>Which word?</Text>
        <Text style={styles.subtitle}>
          {rows.playable.length} ready · most urgent first. The video opens just
          before the word.
        </Text>

        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {rows.playable.map((word) => (
            <Pressable
              key={`${word.videoId}:${word.text}`}
              onPress={() => onPick(word)}
              accessibilityRole="button"
              accessibilityLabel={`Review ${word.text}`}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <View style={styles.rowText}>
                <Text style={styles.rowWord}>{word.text}</Text>
                <Text style={styles.rowGloss} numberOfLines={1}>
                  {word.translation}
                </Text>
              </View>
              {word.state === 'lapsed' && <Text style={styles.rowSlipped}>Slipped</Text>}
              <Text style={styles.rowChevron}>›</Text>
            </Pressable>
          ))}

          {rows.silent > 0 && (
            <Text style={styles.silentNote}>
              {rows.playable.length === 0 ? 'Your ' : `${rows.silent} more `}
              {rows.silent === 1 && rows.playable.length > 0 ? 'word is' : 'words are'}{' '}
              ready but not in any video right now. They come back as blanks when
              a video says them.
            </Text>
          )}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
          >
            <Text style={styles.cancelText}>Not now</Text>
          </Pressable>
          {rows.playable.length > 0 ? (
            <Pressable
              onPress={random}
              accessibilityRole="button"
              accessibilityLabel="Review a random word"
              style={({ pressed }) => [styles.random, pressed && styles.pressed]}
            >
              <Text style={styles.randomText}>🎲 Random</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={onFeed}
              accessibilityRole="button"
              style={({ pressed }) => [styles.random, pressed && styles.pressed]}
            >
              <Text style={styles.randomText}>Open the feed</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

type Choice = { kind: 'word'; word: SavedWord } | { kind: 'feed' };

/** The Progress tab's window around the sheet. See the header note. */
export function ReviewPicker({
  open,
  words,
  onClose,
  onLaunch,
}: {
  open: boolean;
  words: SavedWord[];
  /** The window is gone. Parent drops `open`. */
  onClose: () => void;
  /** Runs AFTER the window is gone: the word, or null for the plain feed. */
  onLaunch: (word: SavedWord | null) => void;
}) {
  const [closing, setClosing] = useState(false);
  const pendingRef = useRef<Choice | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const afterDismiss = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setClosing(false);
    onClose();
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) onLaunch(pending.kind === 'word' ? pending.word : null);
  };

  const closeWindow = (choice?: Choice) => {
    pendingRef.current = choice ?? null;
    setClosing(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(afterDismiss, DISMISS_FALLBACK_MS);
  };

  return (
    <Modal
      visible={open && !closing}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={() => closeWindow()}
      onDismiss={afterDismiss}
    >
      {open && (
        <ReviewPickerSheet
          words={words}
          onPick={(word) => closeWindow({ kind: 'word', word })}
          onFeed={() => closeWindow({ kind: 'feed' })}
          onClose={() => closeWindow()}
        />
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(10,13,11,0.7)', flex: 1, justifyContent: 'flex-end' },
  dismissArea: { flex: 1 },
  sheet: {
    backgroundColor: '#141a17',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '82%',
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  grabber: {
    alignSelf: 'center',
    backgroundColor: 'rgba(242,245,243,0.2)',
    borderRadius: 999,
    height: 4,
    marginBottom: 14,
    width: 36,
  },
  title: { color: '#f2f5f3', fontSize: 20, fontWeight: '800' },
  subtitle: {
    color: 'rgba(242,245,243,0.55)',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
    marginTop: 4,
  },
  /** flexGrow 0 so a short list does not stretch the sheet to maxHeight. */
  list: { flexGrow: 0 },
  listContent: { gap: 6, paddingBottom: 4 },
  row: {
    alignItems: 'center',
    backgroundColor: '#1b2420',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  rowText: { flex: 1 },
  rowWord: { color: '#f2f5f3', fontSize: 16, fontWeight: '700' },
  rowGloss: { color: 'rgba(242,245,243,0.55)', fontSize: 12, marginTop: 1 },
  rowSlipped: { color: '#f87171', fontSize: 12, fontWeight: '700' },
  rowChevron: { color: 'rgba(242,245,243,0.4)', fontSize: 20, fontWeight: '600' },
  silentNote: {
    color: 'rgba(242,245,243,0.4)',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
    paddingHorizontal: 2,
  },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    marginTop: 10,
  },
  cancel: { paddingVertical: 12 },
  cancelText: { color: 'rgba(242,245,243,0.55)', fontSize: 14, fontWeight: '600' },
  /** The lazy path, styled as a real button: it is the one most people will
      take, and it must not read as a footnote. */
  random: {
    backgroundColor: '#5ee6a8',
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  randomText: { color: '#06130d', fontSize: 14, fontWeight: '800' },
  pressed: { opacity: 0.7 },
});
