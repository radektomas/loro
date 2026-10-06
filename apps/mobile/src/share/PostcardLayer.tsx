import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Share, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { track } from '../platform/analytics';
import { CityShareCard } from './CityShareCard';
import { postcardFor } from './cardData';

/**
 * THE POSTCARD, OFFERED ON ARRIVAL (Radek, 2026-10-06: "when you arrive to
 * the city it needs to offer you to see the card and to save it / share it").
 *
 * An absolute layer over the arrival, never a Modal: the Words screen owns
 * exactly one native window (VocabScreen) and CityArrival is already a layer
 * inside it. The card is captured as an image (react-native-view-shot) and
 * handed to the iOS share sheet, which carries Instagram, Messages and
 * "Save Image" — one button covers sharing and saving.
 */
export function PostcardLayer({ stage, onClose }: { stage: number; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [data] = useState(() => postcardFor(stage));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const shot = useRef<View>(null);
  // As big as fits at 9:16, with room for the buttons.
  const cardW = Math.min(width - 48, ((height - insets.top - insets.bottom - 170) * 9) / 16);

  const share = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      // Required lazily: a dev client built before the module was added
      // has no native half, and should say so instead of crashing.
      const { captureRef } = require('react-native-view-shot') as typeof import('react-native-view-shot');
      const uri = await captureRef(shot, { format: 'png', quality: 1 });
      const result = await Share.share({ url: uri });
      track('postcard_shared', {
        stage,
        action: result.action,
        to: result.action === Share.sharedAction ? (result.activityType ?? '') : '',
      });
    } catch (e) {
      console.warn('[postcard] share failed', e);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      exiting={FadeOut.duration(180)}
      style={[styles.layer, { paddingBottom: insets.bottom + 16, paddingTop: insets.top + 12 }]}
    >
      <Animated.View entering={ZoomIn.springify().damping(16)} style={[styles.frame, { borderRadius: (cardW / 360) * 22 }]}>
        <View ref={shot} collapsable={false}>
          <CityShareCard {...data} width={cardW} rounded={false} />
        </View>
      </Animated.View>
      <View style={styles.actions}>
        {failed && <Text style={styles.failed}>Couldn't make the image. Try again.</Text>}
        <Pressable
          onPress={share}
          accessibilityRole="button"
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
        >
          {busy ? <ActivityIndicator color="#06130d" /> : <Text style={styles.primaryText}>Share or save</Text>}
        </Pressable>
        <Pressable onPress={onClose} accessibilityRole="button" hitSlop={8} style={styles.secondary}>
          <Text style={styles.secondaryText}>Done</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: {
    alignItems: 'center',
    backgroundColor: '#0a0d0b',
    bottom: 0,
    justifyContent: 'space-between',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 60,
  },
  frame: { overflow: 'hidden' },
  actions: { alignSelf: 'stretch', paddingHorizontal: 24 },
  failed: { color: 'rgba(242,245,243,0.6)', fontSize: 13, marginBottom: 8, textAlign: 'center' },
  primary: { alignItems: 'center', backgroundColor: '#5ee6a8', borderRadius: 16, height: 52, justifyContent: 'center' },
  primaryText: { color: '#06130d', fontSize: 17, fontWeight: '900' },
  pressed: { opacity: 0.75 },
  secondary: { alignItems: 'center', paddingVertical: 12 },
  secondaryText: { color: 'rgba(242,245,243,0.6)', fontSize: 15, fontWeight: '700' },
});
