import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { COLLECTIONS, REELS, findCollection, isEpisodes } from '@loro/core/collections';
import { cleanWord } from '@loro/core/dictionary';
import { subscribeToDayDone } from './dayDone';
import { subscribeToWordLearned } from './wordLearned';
import { subscribeToTripMoment } from './tripMoments';

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
  onRefresh,
  refreshing = false,
  today,
}: {
  /** Today's correct answers against the plan's goal — the dots. */
  today?: { count: number; goal: number };
  selected: string;
  /** "3/25" on an episode shelf — where you are in the list. */
  detail?: string;
  topInset: number;
  open: boolean;
  onPress: () => void;
  /** The reels shelf only: a fresh order on demand (FeedScreen refreshFeed). */
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const label = findCollection(selected).label;
  /**
   * THE PILL SAYS WHAT IS HAPPENING (Radek, 2026-10-06: the pull is gone,
   * the button stays, with "some loading animation that the feed is
   * refreshing so user knows"). While the new order is built the pill turns
   * mint and reads "Refreshing" over three breathing dots; when it lands it
   * says "New reels ready" for a moment, then goes back to "Reels". Each
   * change cross-fades. The ↻ spins the whole time.
   */
  const [justDone, setJustDone] = useState(false);
  const wasRefreshing = useRef(refreshing);
  useEffect(() => {
    if (wasRefreshing.current && !refreshing) {
      setJustDone(true);
      const t = setTimeout(() => setJustDone(false), 1600);
      wasRefreshing.current = refreshing;
      return () => clearTimeout(t);
    }
    wasRefreshing.current = refreshing;
  }, [refreshing]);
  const mode: 'idle' | 'busy' | 'done' = refreshing ? 'busy' : justDone ? 'done' : 'idle';
  const fade = useRef(new Animated.Value(1)).current;
  const firstMode = useRef(true);
  useEffect(() => {
    if (firstMode.current) {
      firstMode.current = false;
      return;
    }
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [mode, fade]);
  /** One full turn per refresh: it spins while the new order is built. */
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!refreshing) return;
    spin.setValue(0);
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 700, easing: Easing.linear, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [refreshing, spin]);
  /**
   * While a win plays in the strip (DayDots), the shelf pill steps aside so
   * the win can use the strip's width: "¡Llegaste! · Buenos Aires" does not
   * fit beside "Reels".
   */
  const [stripBusy, setStripBusy] = useState(false);
  const shelfShown = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(shelfShown, {
      toValue: stripBusy ? 0 : 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [stripBusy, shelfShown]);
  return (
    <View style={[styles.strip, { paddingTop: topInset, height: topInset + CHIP_ROW_H }]}>
      <Animated.View style={{ opacity: shelfShown }} pointerEvents={stripBusy ? 'none' : 'auto'}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Watching ${label}${detail ? `, episode ${detail}` : ''}. Change what to watch`}
        accessibilityState={{ expanded: open }}
        hitSlop={8}
        style={({ pressed }) => [styles.pill, mode !== 'idle' && styles.pillBusy, pressed && styles.pressed]}
      >
        <Animated.View style={[styles.pillInner, { opacity: fade }]}>
          {mode === 'busy' ? (
            <>
              <Text style={[styles.pillText, styles.pillTextBusy]}>Refreshing</Text>
              <LoadingDots />
            </>
          ) : mode === 'done' ? (
            <Text style={[styles.pillText, styles.pillTextBusy]}>New reels ready</Text>
          ) : (
            <>
              <Text style={styles.pillText}>{label}</Text>
              {detail && <Text style={styles.pillDetail}>· {detail}</Text>}
              <Text style={styles.pillChevron}>{open ? '▴' : '▾'}</Text>
            </>
          )}
        </Animated.View>
      </Pressable>
      </Animated.View>
      {today && <DayDots count={today.count} goal={today.goal} topInset={topInset} onBusy={setStripBusy} />}
      {/* REFRESH (Radek, 2026-10-06: "a possibility to refresh the feed").
          In the top strip, never over the player: a pull on the list itself
          moves the slides but not the YouTube player above them. */}
      {onRefresh && (
        <Pressable
          onPress={onRefresh}
          disabled={refreshing}
          accessibilityRole="button"
          accessibilityLabel="New videos"
          accessibilityHint="Shuffles in videos you have not seen yet"
          hitSlop={10}
          style={({ pressed }) => [
            styles.refresh,
            { top: topInset + (CHIP_ROW_H - 34) / 2 },
            refreshing && styles.refreshBusy,
            pressed && styles.pressed,
          ]}
        >
          <Animated.Text
            style={[
              styles.refreshGlyph,
              refreshing && styles.refreshGlyphBusy,
              { transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] },
            ]}
          >
            ↻
          </Animated.Text>
        </Pressable>
      )}
    </View>
  );
}

/** Each dot's brightness through one beat: they light up left to right. */
const DOT_WAVE = [
  [1, 0.3, 0.3, 1],
  [0.3, 1, 0.3, 0.3],
  [0.3, 0.3, 1, 0.3],
];

/** Three dots breathing in turn: the pill's "still working". */
function LoadingDots() {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [t]);
  return (
    <View style={styles.loadingDots}>
      {DOT_WAVE.map((outputRange, i) => (
        <Animated.View
          key={i}
          style={[styles.loadingDot, { opacity: t.interpolate({ inputRange: [0, 1 / 3, 2 / 3, 1], outputRange }) }]}
        />
      ))}
    </View>
  );
}

/**
 * TODAY, IN THE FEED (Radek, 2026-10-06: "small dots filling up ... next to
 * the pills"). The daily goal lives on Progress, but the feed is where the
 * words come right, so it fills here too: one dot per word of the plan's
 * goal (3, 5 or 10), each popping mint as an answer lands. Full, they all
 * glow — the session has its finish line. Read-only, like the ring it
 * mirrors (Journal DayCoin).
 *
 * THE DAY-DONE MOMENT LIVES HERE NOW (Radek, 2026-11-03: "put away the día
 * hecho modal and make it lighter, playing with the filling dots up left").
 * It used to be a card that paused the video; now the raise from dayDone.ts
 * runs a wave through the dots, the dots hand over to a small mint
 * "¡Día hecho!" pill for a moment, and the dots come back lit. All of it in
 * the strip above the player, so the video never stops.
 */
const WAVE_STEP_MS = 70;
const CHEER_HOLD_MS = 2200;
const LEARNED_HOLD_MS = 2000;

type Cheer = { id: number } & (
  | { kind: 'day' }
  | { kind: 'learned'; word: string }
  /** A trip step (tripMoments: one word to the next city, or arrived). */
  | { kind: 'trip'; lead: string; rest: string }
);

function DayDots({
  count,
  goal,
  topInset,
  onBusy,
}: {
  count: number;
  goal: number;
  topInset: number;
  /** A win is playing: the shelf pill steps aside for it. */
  onBusy: (busy: boolean) => void;
}) {
  const n = Math.max(1, Math.min(10, goal));
  const filled = Math.min(n, count);
  const done = count >= goal;
  const pop = useRef(new Animated.Value(1)).current;
  const last = useRef(filled);
  useEffect(() => {
    if (filled > last.current) {
      pop.setValue(0);
      Animated.spring(pop, { toValue: 1, friction: 4, tension: 180, useNativeDriver: true }).start();
    }
    last.current = filled;
  }, [filled, pop]);

  /** One value per dot for the wave, and one for the dots → pill hand-over. */
  const wave = useRef(Array.from({ length: 10 }, () => new Animated.Value(0))).current;
  const cheer = useRef(new Animated.Value(0)).current;
  /**
   * The strip's wins, one at a time: the day done, and since 2026-11-03 a
   * word learned ("★ playa · learned", Radek's "A"). The answer that makes a
   * word learned can also finish the day, so they queue rather than fight.
   */
  const [queue, setQueue] = useState<Cheer[]>([]);
  const nextId = useRef(0);
  useEffect(() => subscribeToDayDone(() => setQueue((q) => [...q, { id: nextId.current++, kind: 'day' }])), []);
  useEffect(
    () =>
      subscribeToWordLearned((raise) =>
        setQueue((q) => [...q, { id: nextId.current++, kind: 'learned', word: cleanWord(raise.text) }])
      ),
    []
  );
  // The trip's two steps that used to rise out of the Words tab over the
  // subtitles (Radek, 2026-11-03: "change the one word to and arrived to
  // that so it doesn't jump in the subtitles"). The first-save and
  // first-blue tips still rise from the tab: they teach, they need room.
  useEffect(
    () =>
      subscribeToTripMoment((m) => {
        if (m.kind !== 'oneAway' && m.kind !== 'arrived') return;
        const cheer: Cheer =
          m.kind === 'arrived'
            ? { id: nextId.current++, kind: 'trip', lead: '¡Llegaste!', rest: ` · ${m.word}` }
            : { id: nextId.current++, kind: 'trip', lead: m.word, rest: '' };
        setQueue((q) => [...q, cheer]);
      }),
    []
  );
  const current = queue[0] ?? null;
  const busy = current !== null;
  useEffect(() => onBusy(busy), [busy, onBusy]);
  useEffect(() => {
    if (!current) return;
    AccessibilityInfo.announceForAccessibility(
      current.kind === 'day'
        ? "¡Día hecho! Today's goal is done."
        : current.kind === 'learned'
          ? `${current.word}, learned.`
          : `${current.lead}${current.rest}`
    );
    wave.forEach((v) => v.setValue(0));
    cheer.setValue(0);
    const steps: Animated.CompositeAnimation[] = [];
    // The wave is the day's: the dots completing is what it celebrates.
    if (current.kind === 'day') {
      steps.push(
        Animated.stagger(
          WAVE_STEP_MS,
          wave.slice(0, n).map((v) =>
            Animated.sequence([
              Animated.timing(v, { useNativeDriver: true, toValue: 1, duration: 170, easing: Easing.out(Easing.cubic) }),
              Animated.timing(v, { useNativeDriver: true, toValue: 0, duration: 280, easing: Easing.inOut(Easing.cubic) }),
            ])
          )
        )
      );
    }
    steps.push(
      Animated.timing(cheer, { useNativeDriver: true, toValue: 1, duration: 300, easing: Easing.out(Easing.cubic) }),
      Animated.delay(current.kind === 'learned' ? LEARNED_HOLD_MS : CHEER_HOLD_MS),
      Animated.timing(cheer, { useNativeDriver: true, toValue: 0, duration: 360, easing: Easing.inOut(Easing.cubic) })
    );
    const anim = Animated.sequence(steps);
    anim.start(({ finished }) => {
      if (finished) setQueue((q) => q.slice(1));
    });
    return () => anim.stop();
    // Keyed on the cheer's id: a new raise appended behind it must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, n, wave, cheer]);

  /** The shelf pill steps aside while a win plays, so the pill may use the
      strip up to the refresh button on the right. */
  const { width } = useWindowDimensions();
  const seatWidth = Math.max(110, width - 18 - 64);

  const popScale = pop.interpolate({ inputRange: [0, 1], outputRange: [1.9, 1] });
  return (
    <View
      accessible
      accessibilityLabel={done ? `Today's goal done: ${count} words` : `${filled} of ${goal} words today`}
      style={[styles.dots, { top: topInset, height: CHIP_ROW_H }]}
    >
      <Animated.View
        style={[
          styles.dotsRow,
          { opacity: cheer.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) },
        ]}
      >
        {Array.from({ length: n }, (_, i) => {
          const on = i < filled;
          const newest = on && i === filled - 1;
          const lift = wave[i].interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] });
          return (
            <Animated.View
              key={i}
              style={[
                styles.dot,
                n > 5 && styles.dotSmall,
                on && styles.dotOn,
                done && styles.dotDone,
                {
                  transform: [
                    { translateY: wave[i].interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) },
                    { scale: newest ? Animated.multiply(popScale, lift) : lift },
                  ],
                },
              ]}
            />
          );
        })}
      </Animated.View>
      {current && (
        <View pointerEvents="none" style={[styles.cheerSeat, { width: seatWidth }]}>
          <Animated.View
            style={[
              styles.cheer,
              current.kind === 'learned' && styles.cheerLearned,
              current.kind === 'trip' && styles.cheerTrip,
              {
                opacity: cheer,
                transform: [
                  { translateX: cheer.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) },
                  { scale: cheer.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) },
                ],
              },
            ]}
          >
            {current.kind === 'day' ? (
              <Text style={styles.cheerText} numberOfLines={1}>
                ¡Día hecho!
              </Text>
            ) : current.kind === 'learned' ? (
              <Text style={styles.cheerText} numberOfLines={1}>
                <Text style={styles.cheerStar}>★ </Text>
                {current.word}
                <Text style={styles.cheerQuiet}> · learned</Text>
              </Text>
            ) : (
              <Text style={styles.cheerText} numberOfLines={1}>
                {current.lead}
                <Text style={styles.cheerQuiet}>{current.rest}</Text>
              </Text>
            )}
          </Animated.View>
        </View>
      )}
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
  refresh: {
    alignItems: 'center',
    backgroundColor: 'rgba(242,245,243,0.1)',
    borderColor: 'rgba(242,245,243,0.14)',
    borderRadius: 999,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    position: 'absolute',
    right: 16,
    width: 34,
  },
  dots: { justifyContent: 'center', left: 18, position: 'absolute' },
  dotsRow: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  /** Where the strip's pills sit, laid over the dots and growing from their
      left edge. Its own width: an absolute child is otherwise only as wide
      as the dots, and the words wrapped a letter per line (2026-11-03). */
  cheerSeat: { alignItems: 'flex-start', left: -6, position: 'absolute' },
  cheer: {
    backgroundColor: '#5ee6a8',
    borderRadius: 999,
    maxWidth: '100%',
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  /** A word learned: gold, the same gold as its reveal in the subtitle. */
  cheerLearned: { backgroundColor: '#ffb627' },
  cheerStar: { color: '#06130d' },
  /** A trip step: the map's blue. */
  cheerTrip: { backgroundColor: '#57b3f2' },
  cheerQuiet: { color: 'rgba(6,19,13,0.6)', fontWeight: '700' },
  cheerText: { color: '#06130d', fontSize: 13, fontWeight: '800', letterSpacing: -0.1 },
  dot: { backgroundColor: 'rgba(242,245,243,0.18)', borderRadius: 999, height: 7, width: 7 },
  dotSmall: { height: 6, width: 6 },
  dotOn: { backgroundColor: '#5ee6a8' },
  dotDone: {
    backgroundColor: '#5ee6a8',
    shadowColor: '#5ee6a8',
    shadowOffset: { height: 0, width: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
  refreshGlyph: { color: '#f2f5f3', fontSize: 18, fontWeight: '700', lineHeight: 20 },
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
  pillInner: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  pillBusy: { backgroundColor: 'rgba(94,230,168,0.14)', borderColor: 'rgba(94,230,168,0.5)' },
  pillTextBusy: { color: '#5ee6a8' },
  loadingDots: { flexDirection: 'row', gap: 3, marginLeft: 1 },
  loadingDot: { backgroundColor: '#5ee6a8', borderRadius: 2, height: 4, width: 4 },
  refreshBusy: { backgroundColor: 'rgba(94,230,168,0.18)', borderColor: 'rgba(94,230,168,0.5)' },
  refreshGlyphBusy: { color: '#5ee6a8' },
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
