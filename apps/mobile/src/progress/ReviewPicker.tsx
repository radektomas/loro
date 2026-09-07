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
 * FeedScreen's PlayerDriver); this puts a list in front of it. The first
 * row keeps the old behaviour — whatever is most urgent — for the user who
 * does not want to choose.
 *
 * ⚠️ NOTHING NAVIGATES WHILE THE WINDOW IS STILL ON SCREEN. An RN <Modal> is
 * a separate native window, and tearing it down in the same commit as the
 * tab switch underneath it is how the Words tab once came back frozen — an
 * invisible window still up, swallowing every touch (VocabScreen carries the
 * full account). So a tap PARKS its choice, drops `visible`, and the choice
 * runs from onDismiss, when the window is provably gone; the timer is the
 * belt to those braces, because onDismiss is iOS-only.
 *
 * WORDS NO VIDEO SPEAKS ARE SHOWN, GREYED, AT THE BOTTOM. Hiding them would
 * make the list disagree with the "N ready" count on the card; greying them
 * says why they cannot be picked. Computed in one catalog pass
 * (spokenSurfaces), not one fold per word.
 */

/** How long to wait for onDismiss before assuming it is not coming. */
const DISMISS_FALLBACK_MS = 600;

type Choice = { kind: 'urgent' } | { kind: 'word'; word: SavedWord };

export function ReviewPicker({
  open,
  words,
  onClose,
  onLaunch,
}: {
  open: boolean;
  /** Due words, most urgent first — the caller's ordering is kept. */
  words: SavedWord[];
  /** The window is gone. Parent drops `open`. */
  onClose: () => void;
  /** Runs AFTER the window is gone: null means "most urgent", else the word. */
  onLaunch: (word: SavedWord | null) => void;
}) {
  const insets = useSafeAreaInsets();
  const [closing, setClosing] = useState(false);
  const pendingRef = useRef<Choice | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  /** One catalog pass per opening; the catalog can refresh between them. */
  const spoken = useMemo(() => (open ? spokenSurfaces(getCatalog()) : null), [open]);
  const rows = useMemo(() => {
    if (!spoken) return { playable: [] as SavedWord[], silent: [] as SavedWord[] };
    const playable: SavedWord[] = [];
    const silent: SavedWord[] = [];
    for (const w of words) (spoken.has(normalizeSurface(w.text)) ? playable : silent).push(w);
    return { playable, silent };
  }, [words, spoken]);

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
      <View style={styles.backdrop}>
        {/* The dim above the sheet closes it — the same gesture every sheet
            in the app answers to. */}
        <Pressable
          style={styles.dismissArea}
          onPress={() => closeWindow()}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.grabber} />
          <Text style={styles.title}>Which word?</Text>
          <Text style={styles.subtitle}>
            {words.length} ready · most urgent first. The video opens just before
            the word.
          </Text>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            <Pressable
              onPress={() => closeWindow({ kind: 'urgent' })}
              accessibilityRole="button"
              style={({ pressed }) => [styles.row, styles.rowUrgent, pressed && styles.pressed]}
            >
              <View style={styles.rowText}>
                <Text style={styles.rowWord}>Whatever is most urgent</Text>
                <Text style={styles.rowGloss}>Slipped words first, then the longest waiting</Text>
              </View>
              <Text style={styles.rowChevron}>›</Text>
            </Pressable>

            {rows.playable.map((word) => (
              <Pressable
                key={`${word.videoId}:${word.text}`}
                onPress={() => closeWindow({ kind: 'word', word })}
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

            {rows.silent.length > 0 && (
              <>
                <Text style={styles.silentHead}>Not in a video yet</Text>
                {rows.silent.map((word) => (
                  <View
                    key={`${word.videoId}:${word.text}`}
                    style={[styles.row, styles.rowSilent]}
                    accessibilityLabel={`${word.text}, not spoken in any video yet`}
                  >
                    <View style={styles.rowText}>
                      <Text style={[styles.rowWord, styles.rowWordSilent]}>{word.text}</Text>
                      <Text style={styles.rowGloss} numberOfLines={1}>
                        {word.translation}
                      </Text>
                    </View>
                  </View>
                ))}
              </>
            )}
          </ScrollView>

          <Pressable
            onPress={() => closeWindow()}
            accessibilityRole="button"
            style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
          >
            <Text style={styles.cancelText}>Not now</Text>
          </Pressable>
        </View>
      </View>
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
  rowUrgent: {
    backgroundColor: 'rgba(94,230,168,0.12)',
    borderColor: 'rgba(94,230,168,0.3)',
    borderWidth: 1,
  },
  rowSilent: { opacity: 0.45 },
  rowText: { flex: 1 },
  rowWord: { color: '#f2f5f3', fontSize: 16, fontWeight: '700' },
  rowWordSilent: { fontWeight: '600' },
  rowGloss: { color: 'rgba(242,245,243,0.55)', fontSize: 12, marginTop: 1 },
  rowSlipped: { color: '#f87171', fontSize: 12, fontWeight: '700' },
  rowChevron: { color: 'rgba(242,245,243,0.4)', fontSize: 20, fontWeight: '600' },
  silentHead: {
    color: 'rgba(242,245,243,0.4)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 2,
    marginTop: 10,
    paddingHorizontal: 2,
    textTransform: 'uppercase',
  },
  cancel: { alignItems: 'center', marginTop: 8, paddingVertical: 12 },
  cancelText: { color: 'rgba(242,245,243,0.55)', fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
