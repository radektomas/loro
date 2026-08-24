import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type { Video } from '@loro/core/types';
import type { WordOccurrence } from '@loro/core/occurrences';
import { AuthorLine } from '../feed/AuthorLine';
import { PLAYER_EMBED_ORIGIN } from '../platform/config';

/**
 * The embed must be an IFRAME INSIDE A DOCUMENT, not the WebView's top-level
 * page — and that distinction is a shipped bug, not a style preference.
 *
 * Pointing `source={{uri}}` straight at youtube-nocookie.com/embed/… loads the
 * embed as the top-level document with no embedding origin, and YouTube
 * refuses it: the player renders "Player configuration error" (localised — it
 * reached us as "chyba konfigurace přehrávače videí"). The production player
 * never hit this because it does the right thing already: an inline HTML
 * document served under a real https baseUrl, with the player in an iframe and
 * the SAME origin handed to YouTube (PlayerHost.tsx source={{html, baseUrl}},
 * player/page.ts's `origin` playerVar, and the note on PLAYER_EMBED_ORIGIN
 * explaining that the two must match).
 *
 * So this builds the same shape, minus the IFrame API and its command bridge:
 * the modal only needs "play from T with YouTube's own controls", which a
 * plain iframe src does, so there is nothing here to keep in sync with the
 * feed's clock model.
 */
function buildEmbedPage(youtubeId: string, startSeconds: number): string {
  const params = [
    `start=${startSeconds}`,
    'autoplay=1',
    'playsinline=1',
    'rel=0',
    'modestbranding=1',
    'fs=0',
    'iv_load_policy=3',
    `origin=${encodeURIComponent(PLAYER_EMBED_ORIGIN)}`,
  ].join('&amp;');
  return `<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;padding:0;background:#000;height:100%;overflow:hidden}
iframe{border:0;width:100%;height:100%;display:block}</style>
</head><body>
<iframe src="https://www.youtube-nocookie.com/embed/${youtubeId}?${params}"
  allow="autoplay; encrypted-media; picture-in-picture"
  allowfullscreen></iframe>
</body></html>`;
}

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
  // Narrowed to a local so the JSX below can depend on it being a string —
  // requireYoutube already filtered these out at pick time, so a null here
  // only means a video pruned between picking and opening.
  const youtubeId = occurrence?.youtubeId ?? null;
  const open = youtubeId !== null && video !== null;

  return (
    <Modal
      visible={open}
      transparent={false}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {open && occurrence && youtubeId && (
        <View style={[styles.root, { paddingTop: insets.top }]}>
          {/* 16:9 frame, sized by width — the standard embed shape. */}
          <View style={styles.playerBox}>
            <WebView
              // A new occurrence = a new source; RN reloads the WebView.
              key={`${occurrence.videoId}-${occurrence.cueIndex}`}
              source={{
                html: buildEmbedPage(
                  youtubeId,
                  Math.max(0, Math.floor(occurrence.start - 3))
                ),
                // The real https origin the document is served under. Must
                // match the `origin` param above — see buildEmbedPage.
                baseUrl: PLAYER_EMBED_ORIGIN,
              }}
              originWhitelist={['*']}
              style={styles.webview}
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
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
