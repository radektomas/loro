import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import type { Video } from '@loro/core/types';
import { getCatalog, onCatalogChanged } from '@loro/core/catalog';
import { storage } from '@loro/core/storage';
import {
  PlayerHost,
  usePlayerApi,
  usePlayerStatus,
  type PlayerBox,
} from '../player/PlayerHost';
import { AuthorLine } from './AuthorLine';
import { Karaoke } from './Karaoke';

/**
 * CHECKPOINT D — the smallest real feed.
 *
 * What it proves, and nothing else: a recycling list, ONE persistent WebView
 * player over the active slide, karaoke driven by the optimistic clock, and
 * swipe-to-change-slide, all composing on a device.
 *
 * NOT HERE, on purpose (E/F/G): the word-tap save sheet, blanks and recall, the
 * paused-state mirror, the action rail, sound toggling, deep links, feed
 * ordering, onboarding hooks.
 */

/** Matches the web's VISIBILITY_THRESHOLD = 0.6 exactly. */
const VISIBLE_PERCENT = 60;

/** Height reserved for the top chrome, over the safe-area inset. The web
    reserves `env(safe-area-inset-top) + 3.25rem` for the same row. */
const HEADER_HEIGHT = 52;

/** Every embed is 9:16. */
const PLAYER_ASPECT = 9 / 16;

type EmbedVideo = Video & { youtubeId: string };

export function FeedScreen() {
  const [videos, setVideos] = useState<EmbedVideo[]>(() => embedsFrom(getCatalog()));

  // The catalog arrives from the Supabase snapshot shortly after boot (8 → 216)
  // and the seam announces it. Without this the feed would keep whatever list
  // existed at first render.
  useEffect(() => onCatalogChanged(() => setVideos(embedsFrom(getCatalog()))), []);

  /**
   * The player area's rect inside a slide, reported by the active slide's
   * onLayout. NOT a constant: the band below it sizes itself to its content and
   * the player takes the remainder, so the only honest way to know this box is
   * to let flexbox decide and read the answer back.
   *
   * The web file's warning applies verbatim — an earlier version there
   * hardcoded a band height, and the UI painted straight over the player, which
   * is the exact embed-terms violation this layout exists to prevent. Never
   * replace this measurement with a constant.
   */
  const [area, setArea] = useState<{ y: number; width: number; height: number } | null>(
    null
  );

  const onAreaLayout = useCallback((event: LayoutChangeEvent) => {
    const { y, width, height } = event.nativeEvent.layout;
    setArea((prev) =>
      prev && prev.y === y && prev.width === width && prev.height === height
        ? prev
        : { y, width, height }
    );
  }, []);

  /**
   * The 9:16 box centred in that area — the same arithmetic the slide uses for
   * its poster and tap surface, so the WebView lands exactly on top of them.
   */
  const box = useMemo(() => {
    if (!area) return null;
    let height = area.height;
    let width = height * PLAYER_ASPECT;
    if (width > area.width) {
      width = area.width;
      height = width / PLAYER_ASPECT;
    }
    return {
      left: (area.width - width) / 2,
      top: area.y + (area.height - height) / 2,
      width,
      height,
    };
  }, [area]);

  return (
    <FeedBody videos={videos} box={box} onAreaLayout={onAreaLayout} />
  );
}

function embedsFrom(catalog: Video[]): EmbedVideo[] {
  // EMBEDS ONLY, and this is a data fact rather than a preference: 0 of the 8
  // seed clips carry a youtubeId, and their src is a WEB-RELATIVE path
  // ('/videos/….mp4') that resolves to nothing on a phone. There is no id for
  // loadVideoById to take, so a seed slide would be a permanently black player.
  // The other 208 are embeds with absolute i.ytimg.com posters that work as-is.
  return catalog.filter((video): video is EmbedVideo => Boolean(video.youtubeId));
}

function FeedBody({
  videos,
  box,
  onAreaLayout,
}: {
  videos: EmbedVideo[];
  box: Omit<PlayerBox, 'visible'> | null;
  onAreaLayout: (event: LayoutChangeEvent) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [pageHeight, setPageHeight] = useState(0);

  // Hoisted out of the JSX below on purpose: the FlashList is rendered
  // conditionally on pageHeight, and a hook called inside that branch would run
  // on some renders and not others — "rendered more hooks than during the
  // previous render", thrown the moment the layout lands.
  const onViewableItemsChanged = useStableViewability(setActiveIndex);

  const active = videos[activeIndex] ?? null;

  return (
    <PlayerHost
      box={{
        top: box?.top ?? 0,
        left: box?.left ?? 0,
        width: box?.width ?? 0,
        height: box?.height ?? 0,
        // Hidden while the finger is down. The player does not follow the
        // scroll (it repositions on the active change, per the checkpoint
        // brief), so leaving it visible would park the outgoing video over the
        // incoming slide. The poster underneath covers the gap — the same
        // cross-fade the web uses while `started` is false.
        visible: Boolean(box) && !dragging,
      }}
    >
      <View
        style={styles.root}
        onLayout={(event) => setPageHeight(event.nativeEvent.layout.height)}
      >
        {pageHeight > 0 && (
          <FlashList
            data={videos}
            keyExtractor={(video) => video.id}
            extraData={activeIndex}
            renderItem={({ item, index }) => (
              <Slide
                video={item}
                height={pageHeight}
                isActive={index === activeIndex}
                box={box}
                onAreaLayout={index === 0 ? onAreaLayout : undefined}
              />
            )}
            pagingEnabled
            showsVerticalScrollIndicator={false}
            // The web's IntersectionObserver at 0.6, expressed for a list.
            viewabilityConfig={VIEWABILITY_CONFIG}
            onViewableItemsChanged={onViewableItemsChanged}
            onScrollBeginDrag={() => setDragging(true)}
            onMomentumScrollEnd={() => setDragging(false)}
            onScrollEndDrag={() => setDragging(false)}
          />
        )}

        <PlayerDriver video={active} />
        <Readouts total={videos.length} index={activeIndex} />
      </View>
    </PlayerHost>
  );
}

const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: VISIBLE_PERCENT } as const;

/**
 * onViewableItemsChanged must keep ONE identity for the life of the list —
 * changing it throws at runtime. The same discipline as the web's
 * onAutoMutedRef, for the same reason: a fresh callback re-subscribes and the
 * new subscription immediately reports "visible".
 */
function useStableViewability(setActiveIndex: (index: number) => void) {
  const setter = useRef(setActiveIndex);
  setter.current = setActiveIndex;
  return useRef(({ viewableItems }: { viewableItems: { index: number | null }[] }) => {
    const first = viewableItems.find((token) => token.index !== null);
    if (first?.index != null) setter.current(first.index);
  }).current;
}

/**
 * Points the persistent player at the active slide's video. Renders nothing —
 * it is the analogue of the web slide's "drive the one shared player" effect,
 * lifted out of the slide because on RN the player is not inside the list.
 */
function PlayerDriver({ video }: { video: EmbedVideo | null }) {
  const api = usePlayerApi();
  const status = usePlayerStatus();

  useEffect(() => {
    if (!video || !status.ready) return;
    api.loadAndPlay(video.youtubeId);
  }, [video, status.ready, api]);

  return null;
}

function Slide({
  video,
  height,
  isActive,
  box,
  onAreaLayout,
}: {
  video: EmbedVideo;
  height: number;
  isActive: boolean;
  box: Omit<PlayerBox, 'visible'> | null;
  onAreaLayout?: (event: LayoutChangeEvent) => void;
}) {
  const insets = useSafeAreaInsets();
  const api = usePlayerApi();
  const status = usePlayerStatus();

  /**
   * Does the shared player currently hold THIS slide's video?
   *
   * The web's `ownsMedia`. It is what stops the outgoing video's clock from
   * driving the incoming slide's word highlighting during a swap — without it,
   * a background slide reads a clock that belongs to someone else's video.
   */
  const ownsMedia = status.loadedVideoId === video.youtubeId;

  return (
    <View style={[styles.slide, { height }]}>
      <View style={{ height: insets.top + HEADER_HEIGHT }} />

      {/* THE PLAYER AREA. Holds no player — the persistent WebView positions
          itself over this box. flex:1 means the band below takes what it needs
          and this takes the remainder, so it is structurally impossible for
          Loro UI to overlap the player. That is the embed-terms constraint. */}
      <View style={styles.playerArea} onLayout={onAreaLayout}>
        {box && (
          <View
            style={[
              styles.playerBox,
              { left: box.left, top: box.top - (insets.top + HEADER_HEIGHT), width: box.width, height: box.height },
            ]}
          >
            <Image source={{ uri: video.poster }} style={styles.poster} resizeMode="cover" />
            {/* THE GESTURE SURFACE, underneath the WebView. The player layer is
                permanently pointerEvents="none", so every touch on the video
                area lands here: a swipe scrolls the list, a tap toggles
                playback through the player API — never YouTube's own handler.
                Same contract as the web's slot. */}
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => {
                if (isActive && ownsMedia) api.togglePlay();
              }}
            />
          </View>
        )}
      </View>

      {/* THE BAND. Everything Loro draws lives here, BELOW the player, never
          over it. Its height is whatever its content needs. */}
      <View style={[styles.band, { paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.bandTop}>
          <Text style={styles.level}>{video.level}</Text>
          <AuthorLine video={video} />
        </View>
        <Karaoke
          cues={video.cues}
          language={storage.getLanguage()}
          active={isActive && ownsMedia}
        />
      </View>
    </View>
  );
}

/**
 * The two measurements that re-confirm the SDK 54 spike on SDK 57, as a side
 * effect of the real feed rather than a separate lab.
 */
function Readouts({ total, index }: { total: number; index: number }) {
  const status = usePlayerStatus();
  const insets = useSafeAreaInsets();

  const play =
    status.lastPlayMs !== null
      ? `PLAYING ${status.lastPlayMs}ms (no gesture)`
      : status.lastPlayError
        ? `NOT PLAYING — ${status.lastPlayError}`
        : status.ready
          ? 'waiting…'
          : 'booting…';

  const drift =
    status.driftMs === null ? 'drift —' : `drift ${status.driftMs >= 0 ? '+' : ''}${Math.round(status.driftMs)}ms`;

  return (
    <View pointerEvents="none" style={[styles.readouts, { top: insets.top + 6 }]}>
      <Text style={styles.readoutText}>
        {index + 1}/{total} · {play}
      </Text>
      <Text style={styles.readoutText}>
        {drift} · nonFinite {status.nonFinite} · swapPause {status.spuriousPause}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0d0b' },
  slide: { width: '100%', backgroundColor: '#0a0d0b' },
  playerArea: { flex: 1 },
  playerBox: {
    position: 'absolute',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  poster: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  band: { paddingTop: 6 },
  bandTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 6,
    flexWrap: 'wrap',
  },
  level: {
    backgroundColor: 'rgba(94,230,168,0.16)',
    borderRadius: 6,
    color: '#5ee6a8',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  readouts: {
    position: 'absolute',
    left: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  readoutText: { color: '#9fe89a', fontSize: 11, fontVariant: ['tabular-nums'] },
});
