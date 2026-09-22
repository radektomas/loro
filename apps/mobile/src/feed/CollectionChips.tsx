import { Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { COLLECTIONS, findCollection, isEpisodes } from '@loro/core/collections';

/**
 * THE SHELF PILL — one centred pill in the strip between the status bar and
 * the video, saying where you are ("Reels ▾", "Peppa · 2/5 ▾"). Tap it and
 * a menu opens: the shelves as a row of chips, and, for an episode shelf,
 * the shelf's episodes underneath — thumbnail, name, length — to pick from.
 *
 * The first cut was a row of chips, always on. Radek: "a user will not
 * want to see those chips all the time — one big chip in the middle saying
 * the current position, tap it to open a simple menu". Then, with Peppa
 * playing (2026-09-21): "if you can choose episodes — it doesn't make
 * sense the scrolling here". So episodes are CHOSEN, not swiped to: the
 * feed turns paging off for an episode shelf and this list is the way
 * between episodes.
 *
 * THE MENU DRAWS OVER THE PLAYER, so the player yields while it is open —
 * FeedBody raises the same obscure flag the day-done card and the
 * notification explainer use, and the poster carries the frame underneath.
 * The pill itself sits ABOVE the player area (the slide's spacer is
 * CHIP_ROW_H taller), so with the menu closed nothing of Loro's is over the
 * frame.
 */
export const CHIP_ROW_H = 44;

export type EpisodeItem = {
  id: string;
  youtubeId?: string;
  title: string;
  durationSeconds?: number;
  /** 0..1 of the episode seen — the line under the thumbnail. Absent
      until the user is a real way in (episodeProgress.ts). */
  share?: number;
  /** Watched to the end: a full line and "watched" in the meta. */
  done?: boolean;
  /** The second the episode will resume at — "Continue at 1:33". */
  atSeconds?: number;
};

export function CollectionPill({
  selected,
  detail,
  topInset,
  open,
  onPress,
}: {
  selected: string;
  /** "2/5" on an episode shelf — where you are in the list. */
  detail?: string;
  topInset: number;
  open: boolean;
  onPress: () => void;
}) {
  const label = findCollection(selected).label;
  return (
    <View style={[styles.strip, { paddingTop: topInset, height: topInset + CHIP_ROW_H }]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Watching ${label}${detail ? `, episode ${detail}` : ''}. Change what to watch`}
        accessibilityState={{ expanded: open }}
        hitSlop={8}
        style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
      >
        <Text style={styles.pillText}>{label}</Text>
        {detail && <Text style={styles.pillDetail}>· {detail}</Text>}
        <Text style={styles.pillChevron}>{open ? '▴' : '▾'}</Text>
      </Pressable>
    </View>
  );
}

function clock(seconds: number | undefined): string | null {
  if (!seconds || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function CollectionMenu({
  selected,
  topInset,
  onPick,
  onClose,
  episodes,
  activeIndex,
  onPickEpisode,
}: {
  selected: string;
  topInset: number;
  onPick: (id: string) => void;
  onClose: () => void;
  /** The selected shelf's episodes, in order — null on the reels shelf,
      absent where there is no list to pick from (EmptyShelf). */
  episodes?: EpisodeItem[] | null;
  activeIndex?: number;
  onPickEpisode?: (index: number) => void;
}) {
  const { height } = useWindowDimensions();
  const listMax = Math.max(200, height * 0.5);
  return (
    <View style={styles.backdrop}>
      {/* The dim closes it — the same gesture every sheet answers to. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.menu, { top: topInset + CHIP_ROW_H + 4 }]}>
        <Text style={styles.menuTitle}>What to watch</Text>
        <View style={styles.shelves}>
          {COLLECTIONS.map((c) => {
            const on = c.id === selected;
            return (
              <Pressable
                key={c.id}
                onPress={() => onPick(c.id)}
                accessibilityRole="menuitem"
                accessibilityState={{ selected: on }}
                style={({ pressed }) => [styles.shelf, on && styles.shelfOn, pressed && styles.pressed]}
              >
                <Text style={[styles.shelfText, on && styles.shelfTextOn]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {isEpisodes(selected) && (
          <>
            <Text style={[styles.menuTitle, styles.episodesTitle]}>
              Episodes{episodes && episodes.length > 0 ? ` · ${episodes.length}` : ''}
            </Text>
            {!episodes || episodes.length === 0 ? (
              <Text style={styles.none}>Nothing on this shelf yet.</Text>
            ) : (
              <ScrollView style={{ maxHeight: listMax }} contentContainerStyle={styles.list}>
                {episodes.map((ep, i) => {
                  const on = i === activeIndex;
                  const len = clock(ep.durationSeconds);
                  return (
                    <Pressable
                      key={ep.id}
                      onPress={() => onPickEpisode?.(i)}
                      accessibilityRole="menuitem"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`Episode ${i + 1}, ${ep.title}${len ? `, ${len}` : ''}`}
                      style={({ pressed }) => [styles.episode, on && styles.episodeOn, pressed && styles.pressed]}
                    >
                      <View style={styles.thumb}>
                        {ep.youtubeId && (
                          <Image
                            source={{ uri: `https://i.ytimg.com/vi/${ep.youtubeId}/mqdefault.jpg` }}
                            style={StyleSheet.absoluteFill}
                            resizeMode="cover"
                          />
                        )}
                        {/* The progress line: how far in, along the bottom edge. */}
                        {ep.share != null && ep.share > 0 && (
                          <View style={styles.track}>
                            <View style={[styles.fill, { width: `${Math.round(ep.share * 100)}%` }]} />
                          </View>
                        )}
                      </View>
                      <View style={styles.episodeText}>
                        <Text style={[styles.episodeTitle, on && styles.episodeTitleOn]} numberOfLines={2}>
                          {ep.title}
                        </Text>
                        <Text style={styles.episodeMeta}>
                          {i + 1}
                          {len ? ` · ${len}` : ''}
                          {on ? ' · playing' : ''}
                        </Text>
                        {/* Where you are, in words — the line alone was
                            "not precise enough" (Radek, on device). */}
                        {ep.done ? (
                          <Text style={styles.watched}>✓ Watched</Text>
                        ) : ep.atSeconds != null && ep.atSeconds > 0 ? (
                          <Text style={styles.resume}>▶ Continue at {clock(ep.atSeconds)}</Text>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </>
        )}
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
  pillDetail: { color: 'rgba(242,245,243,0.6)', fontSize: 13, fontWeight: '700' },
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
    maxWidth: 420,
    paddingHorizontal: 8,
    paddingVertical: 8,
    position: 'absolute',
    width: '92%',
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
  episodesTitle: {
    borderTopColor: 'rgba(242,245,243,0.08)',
    borderTopWidth: 1,
    marginTop: 8,
    paddingTop: 12,
  },
  shelves: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 6, paddingVertical: 4 },
  shelf: {
    backgroundColor: 'rgba(242,245,243,0.07)',
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  shelfOn: { backgroundColor: '#5ee6a8' },
  shelfText: { color: 'rgba(242,245,243,0.85)', fontSize: 14, fontWeight: '700' },
  shelfTextOn: { color: '#06130d', fontWeight: '800' },
  none: { color: 'rgba(242,245,243,0.5)', fontSize: 14, paddingHorizontal: 12, paddingBottom: 10 },
  list: { paddingBottom: 4 },
  episode: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  episodeOn: { backgroundColor: 'rgba(94,230,168,0.1)' },
  thumb: {
    backgroundColor: 'rgba(242,245,243,0.06)',
    borderRadius: 8,
    height: 50,
    overflow: 'hidden',
    width: 89,
  },
  track: {
    backgroundColor: 'rgba(10,13,11,0.7)',
    bottom: 0,
    height: 5,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  fill: { backgroundColor: '#5ee6a8', height: 5 },
  resume: { color: '#5ee6a8', fontSize: 12, fontWeight: '800', marginTop: 2 },
  watched: { color: 'rgba(242,245,243,0.6)', fontSize: 12, fontWeight: '700', marginTop: 2 },
  episodeText: { flex: 1 },
  episodeTitle: { color: '#f2f5f3', fontSize: 15, fontWeight: '700' },
  episodeTitleOn: { color: '#5ee6a8' },
  episodeMeta: { color: 'rgba(242,245,243,0.5)', fontSize: 12, marginTop: 2 },
});
