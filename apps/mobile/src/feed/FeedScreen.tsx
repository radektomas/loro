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
import type { Video, Word } from '@loro/core/types';
import { getCatalog, onCatalogChanged } from '@loro/core/catalog';
import { storage } from '@loro/core/storage';
import {
  PlayerHost,
  usePlayerApi,
  usePlayerStatus,
  type PlayerBox,
} from '../player/PlayerHost';
import { setStoredRate } from '../player/rate';
import { AuthorLine } from './AuthorLine';
import { Karaoke } from './Karaoke';
import { WordSheet, type WordSheetData } from './WordSheet';

/**
 * CHECKPOINT D — the smallest real feed.
 *
 * What it proves, and nothing else: a recycling list, ONE persistent WebView
 * player over the active slide, karaoke driven by the optimistic clock, and
 * swipe-to-change-slide, all composing on a device.
 *
 * CHECKPOINT E adds the two things that turn watching into learning: sound
 * (tap-to-unmute) and tap-a-word → save. Everything D proved is kept intact —
 * muted autoplay, the drift/PLAYING readouts, the pointerEvents player layer,
 * attribution, karaoke, swipe.
 *
 * NOT HERE, on purpose (F/G): blanks and recall, the paused-state mirror, the
 * action rail, deep links, feed ordering, onboarding hooks, the account prompt.
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

  /**
   * The first pixel below the player area — where the band begins.
   *
   * Taken from the MEASURED area rather than from `box`, because the 9:16 box
   * is centred inside that area and can leave letterbox gaps above and below
   * it. Anything drawn from the box's bottom edge would land inside the region
   * reserved for the player on those devices; the band's own top edge cannot.
   */
  const bandTop = area ? area.y + area.height : null;

  return (
    <FeedBody
      videos={videos}
      box={box}
      bandTop={bandTop}
      onAreaLayout={onAreaLayout}
    />
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
  bandTop,
  onAreaLayout,
}: {
  videos: EmbedVideo[];
  box: Omit<PlayerBox, 'visible'> | null;
  bandTop: number | null;
  onAreaLayout: (event: LayoutChangeEvent) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [pageHeight, setPageHeight] = useState(0);

  /**
   * The tapped word, or null. Held HERE rather than in the slide because the
   * sheet must render outside the FlashList — a recycled cell would take the
   * sheet down with it mid-swipe.
   */
  const [sheet, setSheet] = useState<WordSheetData | null>(null);

  // Read once per mount, exactly as the web's Feed does: /profile is a separate
  // screen, so returning here remounts with the new value.
  const language = useMemo(() => storage.getLanguage(), []);

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
                language={language}
                onWordTap={(word, cueIndex) =>
                  setSheet({ video: item, word, cueIndex })
                }
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
        <WordSheet
          data={sheet}
          language={language}
          bandTop={bandTop}
          onClose={() => setSheet(null)}
        />
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
  language,
  onWordTap,
  onAreaLayout,
}: {
  video: EmbedVideo;
  height: number;
  isActive: boolean;
  box: Omit<PlayerBox, 'visible'> | null;
  language: string;
  onWordTap: (word: Word, cueIndex: number) => void;
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
                if (!isActive || !ownsMedia) return;
                /**
                 * FIRST TAP IS SOUND, EVERY LATER TAP IS PLAY/PAUSE.
                 *
                 * The video autoplays muted because that is the only thing
                 * WebKit allows without a gesture, so the first touch is the
                 * first moment sound is legally available — spending it on
                 * anything else means the user watches a silent clip and has to
                 * find a control. TikTok/Reels behave this way and the web's own
                 * handleUnmuteTap has the same shape: unmute and KEEP PLAYING
                 * (it only calls play() if the element was paused), never
                 * unmute-and-pause. One tap, one effect.
                 *
                 * unmute() is issued synchronously inside this handler — the
                 * exact shape §5e card 6 measured as PASS. Do not defer it.
                 */
                if (status.muted) {
                  api.unmute();
                  // A real gesture, so this is a genuine user CHOICE and may be
                  // persisted (core/storage.ts setSessionUnmuted: every caller
                  // is a user gesture; an auto-mute must never write here).
                  storage.setSessionUnmuted(true);
                  if (!status.playing) api.play();
                  return;
                }
                api.togglePlay();
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
          {isActive && <SoundPill />}
          {isActive && <SpeedPill />}
          <AuthorLine video={video} />
        </View>
        <Karaoke
          cues={video.cues}
          language={language}
          active={isActive && ownsMedia}
          onWordTap={onWordTap}
        />
      </View>
    </View>
  );
}

/**
 * The muted/unmuted indicator, and a deliberate toggle.
 *
 * IT LIVES IN THE BAND, not over the video. Everything Loro draws stays below
 * the player — that is the embed-terms constraint the whole layout exists to
 * satisfy, so the pill goes in the band row next to the level chip rather than
 * floating over the frame the way the web's centred "Tap for sound" overlay
 * does. (That overlay is `!isEmbed` on web anyway: for embeds the web puts the
 * sound control in the ActionRail, which is checkpoint G here. When the rail
 * lands, this becomes its sound button.)
 *
 * It reads the PLAYER's state, not a local hope: `status.muted` is reported by
 * the page from isMuted(), so if an unmute is ever refused the pill keeps
 * saying "Muted" instead of claiming sound that isn't there.
 */
function SoundPill() {
  const api = usePlayerApi();
  const status = usePlayerStatus();

  return (
    <Pressable
      onPress={() => {
        if (status.muted) {
          api.unmute();
          storage.setSessionUnmuted(true);
        } else {
          // A deliberate mute is also a user choice, and is persisted as one —
          // the same split the web draws between handleUserMute (persisted) and
          // handleAutoMuted (never persisted).
          api.mute();
          storage.setSessionUnmuted(false);
        }
      }}
      hitSlop={8}
      style={[styles.soundPill, !status.muted && styles.soundPillOn]}
    >
      <Text style={[styles.soundText, !status.muted && styles.soundTextOn]}>
        {status.muted ? '🔇 Tap video for sound' : '🔊 Sound'}
      </Text>
    </Pressable>
  );
}

/**
 * The speed control. IT LIVES IN THE BAND, next to the level chip and the sound
 * pill — never over the player, for the same embed-terms reason SoundPill is
 * here and not floating over the frame.
 *
 * A CYCLING CHIP RATHER THAN A PICKER. The band is a wrapping row that already
 * carries the level, the sound pill and the attribution line, and a segmented
 * 0.5/0.75/1 control would either crowd that or push the attribution onto a
 * second line — attribution staying visible is an embed obligation, not a
 * layout preference. One chip, one tap, current value always on its face.
 *
 * SLOW ONLY. The ladder walks 1 → 0.75 → 0.5 → 1 and never above 1: the feature
 * exists because some videos speak too fast for a learner, and a 2x option in a
 * comprehension app is a trap rather than a feature.
 *
 * THE LADDER IS INTERSECTED WITH WHAT THE PLAYER REPORTS, never hardcoded.
 * getAvailablePlaybackRates() is per-video, and offering a rate the video does
 * not support means setPlaybackRate is silently ignored — the chip would appear
 * to do nothing. Until the player has reported, the chip is disabled rather than
 * guessing.
 */
const SLOW_LADDER = [1, 0.75, 0.5];

function SpeedPill() {
  const api = usePlayerApi();
  const status = usePlayerStatus();

  // Only rates this video actually offers, in descending order.
  const ladder = useMemo(() => {
    if (!status.availableRates) return null;
    const offered = SLOW_LADDER.filter((r) => status.availableRates?.includes(r));
    // A single entry is not a cycle — nothing to switch between.
    return offered.length > 1 ? offered : null;
  }, [status.availableRates]);

  const isSlowed = status.rate !== 1;

  return (
    <Pressable
      disabled={!ladder}
      accessibilityRole="button"
      accessibilityLabel={`Playback speed ${formatRate(status.rate)} times. Tap to change.`}
      onPress={() => {
        if (!ladder) return;
        // Step from where the PLAYER is, not from where we last asked. If a
        // request was ignored, the next tap still moves relative to reality.
        const current = ladder.indexOf(status.rate);
        const next = ladder[(current + 1) % ladder.length] ?? 1;
        api.setRate(next);
        // The standing choice is recorded on the tap, because it is the user's
        // intent whether or not this particular video honours it. The page
        // re-asserts it on every PLAYING from here on.
        setStoredRate(next);
      }}
      hitSlop={8}
      style={({ pressed }) => [
        styles.speedPill,
        isSlowed && styles.speedPillOn,
        !ladder && styles.speedPillIdle,
        pressed && styles.speedPillPressed,
      ]}
    >
      <Text style={[styles.speedValue, isSlowed && styles.speedValueOn]}>
        {formatRate(status.rate)}×
      </Text>
      {/* The step glyph, and it is honest about the interaction: this control
          ADVANCES to the next rate, it does not open a menu. A chevron would
          promise a picker that is not there. Dimmer than the value so the rate
          stays the thing you read. */}
      <Text style={[styles.speedStep, isSlowed && styles.speedStepOn]}>»</Text>
    </Pressable>
  );
}

/** 1 → "1", 0.75 → "0.75". Trailing zeros read as noise on a chip this small. */
function formatRate(rate: number): string {
  return String(Math.round(rate * 100) / 100);
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
        {drift} · rate {formatRate(status.rate)}× · nonFinite {status.nonFinite} · swapPause{' '}
        {status.spuriousPause}
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
  soundPill: {
    backgroundColor: 'rgba(242,245,243,0.10)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  soundPillOn: { backgroundColor: 'rgba(94,230,168,0.16)' },
  /**
   * THE SPEED CONTROL DOES NOT SHARE THE LEVEL CHIP'S SHAPE, ON PURPOSE.
   *
   * The level chip is a borderless radius-6 tag and is NOT interactive. Anything
   * that looks like it reads as a label, which is exactly why the old speed
   * chip — same radius, same padding, same 12pt — went unnoticed at 1×. Three
   * differences carry the affordance, none of which touch behaviour:
   *
   *   fully rounded  a pill reads as a button; a squared tag reads as metadata
   *   a visible border  an outline is the cheapest "this is a control" signal
   *                     on a dark ground, and the level chip has none
   *   a brighter, heavier value  near-white 13pt/800 against the tag's 12pt
   *
   * Tabular numerals so 0.75 → 0.5 → 1 does not jitter the pill's width mid-tap.
   */
  speedPill: {
    alignItems: 'center',
    backgroundColor: 'rgba(242,245,243,0.10)',
    borderColor: 'rgba(242,245,243,0.32)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  speedPillOn: {
    backgroundColor: 'rgba(94,230,168,0.18)',
    borderColor: 'rgba(94,230,168,0.65)',
  },
  /**
   * Before the player has reported its rates.
   *
   * 0.78, not the old 0.45. At 45% on a #0a0d0b ground the whole pill read as
   * disabled chrome — and since every slide starts in this state, that was the
   * first impression the control ever made. This is dimmed enough to say "not
   * live yet" and bright enough to still read as a control.
   */
  speedPillIdle: { opacity: 0.78 },
  speedPillPressed: { opacity: 0.6 },
  speedValue: {
    color: '#f2f5f3',
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
  },
  speedValueOn: { color: '#5ee6a8' },
  speedStep: { color: 'rgba(242,245,243,0.55)', fontSize: 12, fontWeight: '700' },
  speedStepOn: { color: 'rgba(94,230,168,0.75)' },
  soundText: { color: 'rgba(242,245,243,0.6)', fontSize: 12, fontWeight: '600' },
  soundTextOn: { color: '#5ee6a8' },
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
