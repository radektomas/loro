import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { COLLECTIONS, REELS, findCollection, isEpisodes } from '@loro/core/collections';

/**
 * THE SHELF PILL AND ITS MENU.
 *
 * The pill sits in the strip between the status bar and the video and says
 * where you are — "Reels" on the reels, "Peppa · 3/25" on the shelf — and
 * nothing else: on the reels the user never sees a Peppa sign while they
 * scroll (Radek, 2026-09-22). Tap it and a small menu opens:
 *
 *   on Reels    the other shelves, as rows; tap Peppa and its episodes
 *               unfold right there — "a little Peppa Pig menu with the
 *               episodes" — tap one and you are in it;
 *   on Peppa    the episode list, with a Reels row above it to go back.
 *
 * Episodes are CHOSEN, not swiped to (2026-09-21: "it doesn't make sense,
 * the scrolling here"): the feed turns paging off on an episode shelf and
 * this list is the way between episodes.
 *
 * THE MENU DRAWS OVER THE PLAYER, so the player yields while it is open —
 * FeedBody raises the same obscure flag the day-done card uses, and the
 * poster carries the frame underneath. The pill itself sits ABOVE the
 * player area, so with the menu closed nothing of Loro's is over the frame.
 *
 * Two earlier cuts, for the record: a menu with the shelves as two chips
 * in an empty card ("two bubbles in an empty space"), then a segmented
 * Reels|Peppa switch, which showed Peppa on the reels all the time.
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
  /** "3/25" on an episode shelf — where you are in the list. */
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
  onClose,
  onPick,
  episodesFor,
  activeIndex,
  onPickEpisode,
}: {
  selected: string;
  topInset: number;
  onClose: () => void;
  /** Switch shelf without choosing an episode (the Reels row). */
  onPick: (id: string) => void;
  /** The episodes of any episode shelf, in order — null when the caller
      has no list (EmptyShelf). */
  episodesFor: (id: string) => EpisodeItem[] | null;
  /** The playing episode's index on the SELECTED shelf. */
  activeIndex?: number;
  /** An episode was chosen — on the selected shelf or another. */
  onPickEpisode?: (shelfId: string, index: number) => void;
}) {
  const { height } = useWindowDimensions();
  const listMax = Math.max(220, height * 0.55);
  /** Which episode shelf's list is unfolded. Starts open on the shelf you
      are on; on the reels, opens when a shelf row is tapped. */
  const [browsing, setBrowsing] = useState<string | null>(isEpisodes(selected) ? selected : null);
  const shelves = COLLECTIONS.filter((c) => c.id !== selected);

  return (
    <View style={styles.backdrop}>
      {/* The dim closes it — the same gesture every sheet answers to. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.menu, { top: topInset + CHIP_ROW_H + 4 }]}>
        {shelves.map((c) => {
          const list = isEpisodes(c.id) ? episodesFor(c.id) : null;
          const unfolded = browsing === c.id;
          return (
            <Pressable
              key={c.id}
              onPress={() => (isEpisodes(c.id) ? setBrowsing(unfolded ? null : c.id) : onPick(c.id))}
              accessibilityRole="menuitem"
              accessibilityState={isEpisodes(c.id) ? { expanded: unfolded } : undefined}
              style={({ pressed }) => [styles.shelfRow, pressed && styles.pressed]}
            >
              {/* The first episode's frame as the shelf's picture; the reels
                  row gets a plain mint mark. */}
              {list && list[0]?.youtubeId ? (
                <Image
                  source={{ uri: `https://i.ytimg.com/vi/${list[0].youtubeId}/mqdefault.jpg` }}
                  style={styles.shelfThumb}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.shelfThumb, styles.shelfMark]}>
                  <Text style={styles.shelfMarkText}>{c.id === REELS ? '▲' : '▶'}</Text>
                </View>
              )}
              <View style={styles.episodeText}>
                <Text style={styles.shelfTitle}>{c.label}</Text>
                <Text style={styles.episodeMeta}>
                  {list ? `${list.length} episodes` : c.id === REELS ? 'Short clips from real people' : ''}
                </Text>
              </View>
              <Text style={styles.shelfChevron}>{isEpisodes(c.id) ? (unfolded ? '▴' : '▾') : '›'}</Text>
            </Pressable>
          );
        })}

        {browsing && isEpisodes(browsing) && (
          <EpisodeList
            shelfId={browsing}
            episodes={episodesFor(browsing)}
            activeIndex={browsing === selected ? activeIndex : undefined}
            maxHeight={listMax}
            titled={shelves.length > 0}
            onPick={(index) => onPickEpisode?.(browsing, index)}
          />
        )}
      </View>
    </View>
  );
}

function EpisodeList({
  shelfId,
  episodes,
  activeIndex,
  maxHeight,
  titled,
  onPick,
}: {
  shelfId: string;
  episodes: EpisodeItem[] | null;
  activeIndex?: number;
  maxHeight: number;
  /** Draw the "Episodes · N" header — skipped when the list stands alone. */
  titled: boolean;
  onPick: (index: number) => void;
}) {
  return (
    <>
      <Text style={[styles.menuTitle, titled && styles.episodesTitle]}>
        {findCollection(shelfId).label} · {episodes && episodes.length > 0 ? `${episodes.length} episodes` : 'episodes'}
      </Text>
      {!episodes || episodes.length === 0 ? (
        <Text style={styles.none}>Nothing on this shelf yet.</Text>
      ) : (
        <ScrollView style={{ maxHeight }} contentContainerStyle={styles.list}>
          {episodes.map((ep, i) => {
            const on = i === activeIndex;
            const len = clock(ep.durationSeconds);
            return (
              <Pressable
                key={ep.id}
                onPress={() => onPick(i)}
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
                  {/* Where you are, in words — the line alone was "not
                      precise enough" (Radek, on device). */}
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
    marginTop: 6,
    paddingTop: 12,
  },
  /** A shelf as a row: picture, name, a line about it, a chevron. */
  shelfRow: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  shelfThumb: { backgroundColor: 'rgba(242,245,243,0.06)', borderRadius: 8, height: 46, width: 82 },
  shelfMark: { alignItems: 'center', backgroundColor: 'rgba(94,230,168,0.14)', justifyContent: 'center' },
  shelfMarkText: { color: '#5ee6a8', fontSize: 16, fontWeight: '800' },
  shelfTitle: { color: '#f2f5f3', fontSize: 16, fontWeight: '800' },
  shelfChevron: { color: 'rgba(242,245,243,0.5)', fontSize: 14, fontWeight: '800', paddingRight: 4 },
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
