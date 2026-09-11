import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLLECTIONS, findCollection } from '@loro/core/collections';

/**
 * THE SHELF PILL — one centred pill in the strip between the status bar and
 * the video, saying where you are ("Reels ▾"). Tap it and a small menu
 * lists the shelves; pick one and the feed under it swaps.
 *
 * The first cut was a row of chips, always on. Radek: "a user will not
 * want to see those chips all the time — one big chip in the middle saying
 * the current position, tap it to open a simple menu". So: one pill, and
 * the list only on request.
 *
 * THE MENU DRAWS OVER THE PLAYER, so the player yields while it is open —
 * FeedBody raises the same obscure flag the day-done card and the
 * notification explainer use, and the poster carries the frame underneath.
 * The pill itself sits ABOVE the player area (the slide's spacer is
 * CHIP_ROW_H taller), so with the menu closed nothing of Loro's is over the
 * frame.
 */
export const CHIP_ROW_H = 44;

export function CollectionPill({
  selected,
  topInset,
  open,
  onPress,
}: {
  selected: string;
  topInset: number;
  open: boolean;
  onPress: () => void;
}) {
  return (
    <View style={[styles.strip, { paddingTop: topInset, height: topInset + CHIP_ROW_H }]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Watching ${findCollection(selected).label}. Change what to watch`}
        accessibilityState={{ expanded: open }}
        hitSlop={8}
        style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
      >
        <Text style={styles.pillText}>{findCollection(selected).label}</Text>
        <Text style={styles.pillChevron}>{open ? '▴' : '▾'}</Text>
      </Pressable>
    </View>
  );
}

export function CollectionMenu({
  selected,
  topInset,
  onPick,
  onClose,
}: {
  selected: string;
  topInset: number;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <View style={styles.backdrop}>
      {/* The dim closes it — the same gesture every sheet answers to. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.menu, { top: topInset + CHIP_ROW_H + 4 }]}>
        <Text style={styles.menuTitle}>What to watch</Text>
        {COLLECTIONS.map((c) => {
          const on = c.id === selected;
          return (
            <Pressable
              key={c.id}
              onPress={() => onPick(c.id)}
              accessibilityRole="menuitem"
              accessibilityState={{ selected: on }}
              style={({ pressed }) => [styles.item, pressed && styles.pressed]}
            >
              <Text style={[styles.itemText, on && styles.itemTextOn]}>{c.label}</Text>
              {on && <Text style={styles.itemTick}>✓</Text>}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    alignItems: 'center',
    backgroundColor: '#0a0d0b',
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 5,
  },
  pill: {
    alignItems: 'center',
    backgroundColor: 'rgba(242,245,243,0.1)',
    borderColor: 'rgba(242,245,243,0.14)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  pillText: { color: '#f2f5f3', fontSize: 14, fontWeight: '800' },
  pillChevron: { color: 'rgba(242,245,243,0.6)', fontSize: 12, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  backdrop: {
    backgroundColor: 'rgba(10,13,11,0.7)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 6,
  },
  menu: {
    alignSelf: 'center',
    backgroundColor: '#141a17',
    borderColor: 'rgba(242,245,243,0.1)',
    borderRadius: 18,
    borderWidth: 1,
    minWidth: 240,
    paddingHorizontal: 8,
    paddingVertical: 8,
    position: 'absolute',
  },
  menuTitle: {
    color: 'rgba(242,245,243,0.45)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    textTransform: 'uppercase',
  },
  item: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  itemText: { color: 'rgba(242,245,243,0.85)', fontSize: 16, fontWeight: '600' },
  itemTextOn: { color: '#5ee6a8', fontWeight: '800' },
  itemTick: { color: '#5ee6a8', fontSize: 16, fontWeight: '800' },
});
