import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { COLLECTIONS } from '@loro/core/collections';

/**
 * THE CHIP ROW — Reels · Peppa Pig · Masha y el Oso · Bluey · Novelas — in
 * the strip between the status bar and the video. One tap swaps the shelf;
 * the feed under it is the same feed. It sits ABOVE the player area, never
 * over it: the slide's top spacer is CHIP_ROW_H taller when the row is
 * shown, so the embed rule ("nothing of Loro's over the frame") holds by
 * geometry, exactly as the band does below.
 */
export const CHIP_ROW_H = 44;

export function CollectionChips({
  selected,
  topInset,
  onSelect,
}: {
  selected: string;
  /** The status-bar inset the row pays, so the slide's spacer can match. */
  topInset: number;
  onSelect: (id: string) => void;
}) {
  return (
    <View style={[styles.row, { paddingTop: topInset, height: topInset + CHIP_ROW_H }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {COLLECTIONS.map((c) => {
          const on = c.id === selected;
          return (
            <Pressable
              key={c.id}
              onPress={() => onSelect(c.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.pressed]}
            >
              <Text style={[styles.label, on && styles.labelOn]}>{c.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: '#0a0d0b',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 5,
  },
  content: { alignItems: 'center', gap: 8, paddingHorizontal: 14 },
  chip: {
    backgroundColor: 'rgba(242,245,243,0.08)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  chipOn: { backgroundColor: '#5ee6a8' },
  label: { color: 'rgba(242,245,243,0.75)', fontSize: 13, fontWeight: '700' },
  labelOn: { color: '#06130d' },
  pressed: { opacity: 0.7 },
});
