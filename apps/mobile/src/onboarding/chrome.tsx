import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * The shared furniture every onboarding screen is built from.
 *
 * ONE FRAME FOR ALL ELEVEN, on purpose. A conversational flow reads as one
 * conversation only if the title lands in the same place every time; screens
 * that each lay themselves out drift by a few points and the whole thing feels
 * like a series of pages instead. So the screens below supply content and
 * nothing else — the frame, the scroll behaviour and the footer are here.
 *
 * Palette matches the tabs (ProgressScreen/VocabScreen): #0a0d0b ground,
 * #141a17 cards, #5ee6a8 accent, #06130d on-accent.
 */

export const ACCENT = '#5ee6a8';
export const ON_ACCENT = '#06130d';
export const TEXT = '#f2f5f3';
export const MUTED = 'rgba(242,245,243,0.6)';
export const CARD = '#141a17';
export const GROUND = '#0a0d0b';

/**
 * One screen's frame.
 *
 * The body scrolls only when it has to: `flexGrow: 1` with centred content
 * means a short screen sits in the middle of the window like a statement, and
 * the one long screen (the fifteen-word grid on a small phone) scrolls instead
 * of being clipped. Neither case needs a per-screen decision.
 */
export function Screen({
  children,
  footer,
}: {
  children: ReactNode;
  /** The primary action. Pinned to the bottom, clear of the home indicator. */
  footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
      {footer && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          {footer}
        </View>
      )}
    </View>
  );
}

export function Title({ children }: { children: string }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Body({ children }: { children: string }) {
  return <Text style={styles.body}>{children}</Text>;
}

export function PrimaryButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
    >
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  );
}

export function TextButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      hitSlop={8}
      style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
    >
      <Text style={styles.textButtonLabel}>{label}</Text>
    </Pressable>
  );
}

/**
 * A tappable answer. Used by the three question screens (motivation,
 * self-assessment, frequency), which is why the selected state exists even
 * though two of the three advance immediately on tap — the third does not, and
 * one card component beats three near-identical ones.
 */
export function ChoiceCard({
  label,
  body,
  selected,
  onPress,
}: {
  label: string;
  body?: string;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: Boolean(selected) }}
      style={({ pressed }) => [
        styles.choice,
        selected && styles.choiceOn,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.choiceLabel, selected && styles.choiceLabelOn]}>
        {label}
      </Text>
      {body && <Text style={styles.choiceBody}>{body}</Text>}
    </Pressable>
  );
}

/**
 * A static mock of the in-video blank, for the screen that teaches it.
 *
 * DRAWN FROM VIEWS, not a dashed border — `borderStyle: 'dashed'` with a
 * single-side border renders nothing on iOS (RCTBorderDrawing.m:496-499 bails
 * unless all four border colours match). Karaoke.tsx hit this for real; this is
 * the same remedy at a smaller size, kept local so the teaching mock does not
 * import the live recall stack.
 */
export function BlankMock({ gloss }: { gloss: string }) {
  return (
    <View style={styles.mockSlot}>
      <Text style={styles.mockGloss}>{gloss}</Text>
      <View style={styles.mockRule}>
        {Array.from({ length: 10 }, (_, i) => (
          <View key={i} style={styles.mockDash} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  footer: { paddingHorizontal: 24, paddingTop: 8 },
  title: {
    color: TEXT,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.4,
    lineHeight: 33,
  },
  body: {
    color: MUTED,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  primary: {
    alignItems: 'center',
    backgroundColor: ACCENT,
    borderRadius: 16,
    paddingVertical: 16,
  },
  primaryText: { color: ON_ACCENT, fontSize: 17, fontWeight: '800' },
  textButton: { alignItems: 'center', paddingVertical: 10 },
  textButtonLabel: { color: MUTED, fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.7 },
  choice: {
    backgroundColor: CARD,
    borderColor: 'transparent',
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 10,
    padding: 16,
  },
  choiceOn: {
    backgroundColor: 'rgba(94,230,168,0.12)',
    borderColor: 'rgba(94,230,168,0.4)',
  },
  choiceLabel: { color: TEXT, fontSize: 16, fontWeight: '700' },
  choiceLabelOn: { color: ACCENT },
  choiceBody: {
    color: 'rgba(242,245,243,0.5)',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 3,
  },
  mockSlot: { alignItems: 'center', justifyContent: 'flex-end', minWidth: 92 },
  mockGloss: {
    color: 'rgba(94,230,168,0.5)',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 28,
  },
  mockRule: { flexDirection: 'row', gap: 4, overflow: 'hidden' },
  mockDash: {
    backgroundColor: ACCENT,
    borderRadius: 1.5,
    height: 3,
    width: 6,
  },
});
