import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { Video } from '@loro/core/types';
import type { WordOccurrence } from '@loro/core/occurrences';
import { AuthorLine } from '../feed/AuthorLine';
import { PLAYER_EMBED_ORIGIN } from '../platform/config';
import { buildHearItPage } from './hearItPage';

/**
 * "Hear it in a video" — play the stretch of a real video where a saved word
 * is spoken, stop just after it, and offer the obvious next step: review it.
 *
 * THE SHAPE IS THE FEED'S. Loro's catalog is vertical video, which is why the
 * feed sizes its player 9:16 (FeedScreen PLAYER_ASPECT). This screen shipped
 * at 16:9 and the result was exactly what it sounds like — a letterboxed strip
 * in the top corner with the actual speaker cropped out of it. The frame is
 * sized from the window here for the same reason the feed measures rather than
 * hardcodes: the split between player and controls moves with the device.
 *
 * IT ENDS ON THE WORD, WHICH IS THE POINT. A plain embed can start at a
 * timestamp but never stops, so the listen ran on into whatever came next and
 * the moment was lost. hearItPage.ts watches the clock and pauses half a
 * second after the word, and that pause is what earns the call to action: the
 * user has just heard the word in real speech, which is the best moment there
 * will ever be to ask them to recall it. Tapping through arms a review session
 * and drops them in the feed.
 *
 * EMBED TERMS, unchanged: YouTube's own player with its own controls, nothing
 * of Loro's drawn over the frame, and the attribution line always below it.
 */

/** Lead-in before the word — enough speech to hear it in context. */
const LEAD_IN_S = 3;
/** The beat after the word before the video stops. */
const TAIL_S = 0.5;

type Phase = 'loading' | 'playing' | 'heard' | 'error';

export function HearItModal({
  occurrence,
  word,
  video,
  onClose,
  onReview,
}: {
  occurrence: WordOccurrence | null;
  /** The word being listened for — named under the player. */
  word: string;
  /** The occurrence's catalog record, for attribution. */
  video: Video | null;
  onClose: () => void;
  /** Start a review session in the feed. The modal closes itself first. */
  onReview: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const webRef = useRef<WebView>(null);
  const [phase, setPhase] = useState<Phase>('loading');

  // requireYoutube filtered these at pick time; a null here only means a video
  // pruned between picking and opening.
  const youtubeId = occurrence?.youtubeId ?? null;
  const open = youtubeId !== null && video !== null;

  // Every open is a fresh listen — the WebView is remounted by `key` below,
  // so the phase must start over with it.
  useEffect(() => {
    if (open) setPhase('loading');
  }, [open, occurrence?.videoId, occurrence?.cueIndex]);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    let parsed: { type?: string } = {};
    try {
      parsed = JSON.parse(event.nativeEvent.data) as { type?: string };
    } catch {
      return; // Not ours; the page posts nothing else.
    }
    if (parsed.type === 'playing') setPhase('playing');
    else if (parsed.type === 'heard') setPhase('heard');
    else if (parsed.type === 'error') setPhase('error');
  }, []);

  const playAgain = useCallback(() => {
    setPhase('playing');
    webRef.current?.injectJavaScript('window.__hearItAgain && window.__hearItAgain(); true;');
  }, []);

  if (!open || !occurrence || !youtubeId) {
    return <Modal visible={false} transparent onRequestClose={onClose} />;
  }

  /**
   * The frame: 9:16, as tall as the controls below it allow. BOTTOM_BAND is
   * what the chip, attribution and buttons need; the player takes the rest,
   * capped by width so a narrow phone letterboxes sideways rather than
   * cropping.
   */
  const BOTTOM_BAND = 232;
  const available = height - insets.top - insets.bottom - BOTTOM_BAND;
  const frameHeight = Math.max(220, Math.min(available, (width * 16) / 9));
  const frameWidth = Math.min(width, (frameHeight * 9) / 16);

  return (
    <Modal
      visible
      transparent={false}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={[styles.playerBox, { height: frameHeight, width: frameWidth }]}>
          <WebView
            ref={webRef}
            key={`${occurrence.videoId}-${occurrence.cueIndex}`}
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

        {/* Everything of Loro's lives BELOW the frame, never over it. */}
        <View style={[styles.below, { paddingBottom: insets.bottom + 12 }]}>
          {phase === 'heard' ? (
            <>
              <Text style={styles.headline}>
                That's <Text style={styles.headlineWord}>«{word}»</Text> in real speech.
              </Text>
              <Text style={styles.subline}>
                Best moment to lock it in — try recalling it now.
              </Text>
            </>
          ) : (
            <Text style={styles.headline}>
              Listen for <Text style={styles.headlineWord}>«{word}»</Text>
            </Text>
          )}

          <View style={styles.attribution}>
            <AuthorLine video={video} />
          </View>

          <View style={styles.actions}>
            {phase === 'heard' && (
              <Pressable
                onPress={() => {
                  onClose();
                  onReview();
                }}
                accessibilityRole="button"
                accessibilityHint="Opens the feed with your due words as blanks"
                style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
              >
                <Text style={styles.primaryLabel}>Review in the feed</Text>
              </Pressable>
            )}
            <View style={styles.secondaryRow}>
              {(phase === 'heard' || phase === 'error') && (
                <Pressable
                  onPress={playAgain}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
                >
                  <Text style={styles.secondaryLabel}>Play again</Text>
                </Pressable>
              )}
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close and go back to your words"
                style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
              >
                <Text style={styles.secondaryLabel}>Back to Words</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', backgroundColor: '#0a0d0b', flex: 1 },
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
  below: { flex: 1, paddingHorizontal: 20, paddingTop: 14, width: '100%' },
  headline: { color: '#f2f5f3', fontSize: 17, fontWeight: '700', lineHeight: 23 },
  headlineWord: { color: '#5ee6a8', fontWeight: '800' },
  subline: {
    color: 'rgba(242,245,243,0.6)',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  attribution: { marginTop: 10 },
  actions: { marginTop: 'auto' },
  primary: {
    alignItems: 'center',
    backgroundColor: '#5ee6a8',
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
});
