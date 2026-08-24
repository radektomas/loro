import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type { Video } from '@loro/core/types';
import type { WordOccurrence } from '@loro/core/occurrences';
import { AuthorLine } from '../feed/AuthorLine';

/**
 * "Hear it in a video" — a modal player seeked to just before a word is
 * spoken, opened from the word-detail sheet on the Words tab.
 *
 * A FRESH, MODAL-SCOPED WEBVIEW, NOT THE SHARED PlayerHost — decided, with
 * reasons: the feed OWNS the persistent player's geometry and lifecycle
 * (FeedScreen pushes its box and only loads on active-video CHANGE), so
 * borrowing it from another tab would leave it holding this modal's video
 * when the user returns to the feed, and would fight the feed's box effect.
 * The one-persistent-player premise guards feed-swap boot cost and web
 * autoplay blessing; neither applies to a user-initiated modal in RN, where
 * gesture-free playback is configuration (docs/rn-port-map.md §5e). The
 * plain embed URL is the exact precedent of the web's dev starter-clip
 * browser. Cold boot costs ~1-2s — the poster-dark backdrop and the chip
 * below are the loading state.
 *
 * START A BEAT EARLY: occurrence.start minus 3s ("a bit of speech
 * beforehand"), floored at 0 — context is the point, the word is the payoff.
 * The `start` param is integer seconds; ±0.5s embed seek precision is noise
 * against a deliberate 3s lead-in.
 *
 * EMBED TERMS, SAME AS THE FEED: YouTube's own iframe with native controls
 * (fs=0 only — the modal is the fullscreen), NOTHING drawn over the frame,
 * and the attribution line (channel link, licence chip, watch-on-YouTube)
 * rendered below it via the feed's own AuthorLine.
 */
export function HearItModal({
  occurrence,
  word,
  video,
  onClose,
}: {
  occurrence: WordOccurrence | null;
  /** The word being listened for — the chip under the player names it. */
  word: string;
  /** The occurrence's catalog record, for attribution. Null closes the modal
      (a pruned video between pick and open — vanishingly rare, handled). */
  video: Video | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const open = occurrence !== null && occurrence.youtubeId !== null && video !== null;

  return (
    <Modal
      visible={open}
      transparent={false}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {open && (
        <View style={[styles.root, { paddingTop: insets.top }]}>
          {/* 16:9 frame, sized by width — the standard embed shape. */}
          <View style={styles.playerBox}>
            <WebView
              // A new occurrence = a new source; RN reloads the WebView.
              key={`${occurrence.videoId}-${occurrence.cueIndex}`}
              source={{
                uri:
                  `https://www.youtube-nocookie.com/embed/${occurrence.youtubeId}` +
                  `?start=${Math.max(0, Math.floor(occurrence.start - 3))}` +
                  '&autoplay=1&playsinline=1&rel=0&modestbranding=1&fs=0&iv_load_policy=3',
              }}
              style={styles.webview}
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              // The page is YouTube's own; nothing of ours runs inside it.
              javaScriptEnabled
              domStorageEnabled={false}
              allowsBackForwardNavigationGestures={false}
            />
          </View>

          {/* Everything of Loro's lives BELOW the frame, never over it. */}
          <View style={styles.below}>
            <Text style={styles.listenChip}>
              Listen for <Text style={styles.listenWord}>«{word}»</Text>
            </Text>
            <View style={styles.attribution}>
              <AuthorLine video={video} />
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close and go back to your words"
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
            >
              <Text style={styles.closeLabel}>Back to Words</Text>
            </Pressable>
          </View>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: '#0a0d0b', flex: 1 },
  playerBox: { aspectRatio: 16 / 9, backgroundColor: '#000', width: '100%' },
  webview: { backgroundColor: '#000', flex: 1 },
  below: { flex: 1, paddingHorizontal: 20, paddingTop: 18 },
  listenChip: { color: 'rgba(242,245,243,0.7)', fontSize: 15 },
  listenWord: { color: '#5ee6a8', fontWeight: '800' },
  attribution: { marginTop: 12 },
  close: {
    alignItems: 'center',
    backgroundColor: 'rgba(242,245,243,0.10)',
    borderRadius: 16,
    marginTop: 'auto',
    marginBottom: 24,
    paddingVertical: 14,
  },
  closeLabel: { color: '#f2f5f3', fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});
