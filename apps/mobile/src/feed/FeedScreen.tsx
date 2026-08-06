import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Image,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import type { Video, Word } from '@loro/core/types';
import { getCatalog, onCatalogChanged } from '@loro/core/catalog';
import { orderVideosForLevel } from '@loro/core/feedOrder';
import { storage } from '@loro/core/storage';
import {
  usePlayerApi,
  usePlayerBox,
  usePlayerStatus,
  type PlayerBox,
} from '../player/PlayerHost';
import { setStoredRate } from '../player/rate';
import { AuthorLine } from './AuthorLine';
import { Karaoke } from './Karaoke';
import { RecallBar } from './RecallBar';
import { RecallHost } from './RecallHost';
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
 * CHECKPOINT F adds in-cue fill-in-the-blank recall — BEHIND RECALL_ENABLED
 * (recall.ts), which is false by default. With the flag off, RecallHost plans
 * nothing, runs no frame callback and publishes a null context, so every line
 * below behaves exactly as checkpoint E left it.
 *
 * NOT HERE, on purpose (G): the paused-state mirror, the action rail, deep
 * links, feed ordering, onboarding hooks, the account prompt.
 */

/** Matches the web's VISIBILITY_THRESHOLD = 0.6 exactly. */
const VISIBLE_PERCENT = 60;

/** Height reserved for the top chrome, over the safe-area inset. The web
    reserves `env(safe-area-inset-top) + 3.25rem` for the same row. */
const HEADER_HEIGHT = 52;

/** Every embed is 9:16. */
const PLAYER_ASPECT = 9 / 16;

type EmbedVideo = Video & { youtubeId: string };

/** Feed-side diagnostics. Its own tag rather than recall's flog, so filtering
    for one does not drag in the other. */
function feedLog(message: string): void {
  console.log(`[loro:feed] ${message}`);
}

export function FeedScreen({ active }: { active: boolean }) {
  /**
   * The order settled on for THIS mount, or null before anything has settled.
   *
   * ORDERING ONCE IS THE WHOLE CONTRACT. Re-running it on a catalog change
   * would rearrange the feed under someone already scrolling it, which is a
   * bug rather than a refresh — the web keeps the same ref for the same reason
   * (Feed.tsx:90-91).
   */
  const orderedRef = useRef<EmbedVideo[] | null>(null);

  const [videos, setVideos] = useState<EmbedVideo[]>(() => {
    const ordered = orderFeed(embedsFrom(getCatalog()));
    // An EMPTY list settles nothing — see the note on the effect below.
    if (ordered.length > 0) orderedRef.current = ordered;
    return ordered;
  });

  /**
   * The catalog arrives from the Supabase snapshot shortly after boot and the
   * seam announces it. Two shapes of change reach here, and they are handled
   * differently on purpose.
   *
   * WHAT THE GROWTH ACTUALLY LOOKS LIKE, because "8 → 216" is not what the
   * feed sees. embedsFrom keeps only videos with a youtubeId, and NONE of the
   * 8 bundled seed clips has one (verified: 8 seed videos, 0 with an id). So a
   * first-ever launch renders an EMPTY feed and the first refresh takes it
   * 0 → 208. There is no provisional content on screen to disturb, which is
   * why settling on the first non-empty list is safe rather than a reshuffle:
   * the alternative — settling an empty order at mount — would freeze the feed
   * empty for the session.
   *
   * A returning device never sees that at all: the cached snapshot is parsed
   * synchronously during boot (platform/catalog.ts installCachedCatalog), so
   * the first render already holds all 208 and the mount settles them.
   *
   * ONCE SETTLED, THE ORDER IS APPEND-ONLY. New arrivals are ordered among
   * themselves and go on the end; nothing above them moves.
   *
   * REMOVALS ARE HONOURED, unlike on the web. A refresh can drop a video —
   * that is exactly what the denylist does (platform/denylist.ts) — and a
   * settled order that kept its own copy would go on rendering content the
   * refresh just took away. Anything missing from the incoming catalog is
   * dropped from the settled order before the append.
   */
  useEffect(
    () =>
      onCatalogChanged(() => {
        setVideos(() => {
          const incoming = embedsFrom(getCatalog());
          const settled = orderedRef.current;

          if (!settled) {
            const ordered = orderFeed(incoming);
            if (ordered.length > 0) orderedRef.current = ordered;
            return ordered;
          }

          const live = new Set(incoming.map((video) => video.id));
          const kept = settled.filter((video) => live.has(video.id));
          const placed = new Set(kept.map((video) => video.id));
          const fresh = incoming.filter((video) => !placed.has(video.id));

          // Same list: return the SAME array so nothing re-renders. A refresh
          // that finds an unchanged snapshot still re-installs it, so this is
          // the common case, not an edge one.
          if (kept.length === settled.length && fresh.length === 0) return settled;

          const next = fresh.length > 0 ? [...kept, ...orderFeed(fresh)] : kept;
          orderedRef.current = next;
          feedLog(
            `catalog change: +${fresh.length} appended, ` +
              `-${settled.length - kept.length} removed, ${next.length} total`
          );
          return next;
        });
      }),
    []
  );

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
      active={active}
      onAreaLayout={onAreaLayout}
    />
  );
}

/**
 * Fisher-Yates. Local because core's copy is module-private to feedOrder.ts —
 * it is used there to seed the tie-break and is not exported, and reaching into
 * core to export it would be a change to a package this checkpoint does not
 * touch. Unbiased, unlike sort(() => Math.random() - 0.5).
 */
function shuffled(list: EmbedVideo[]): EmbedVideo[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The feed's order for this session.
 *
 * TWO PATHS, AND THE ONLY THING THAT PICKS BETWEEN THEM IS whether
 * getStartLevel() has an answer. It returns a Level or null (storage.ts:
 * 1411-1416), and null is not a degenerate case to paper over: it means this
 * device has never completed calibration. Two kinds of user land there — anyone
 * who skipped onboarding before the grid, and anyone grandfathered past the
 * gate by isOnboarded()'s "has saved words or watched videos" clause.
 *
 *   level known    orderVideosForLevel: unseen first, then closest to the
 *                  calibrated CEFR band, shuffled within ties. The web's exact
 *                  call and guard (Feed.tsx:98-103).
 *   level null     a plain shuffle. NOT source order, which is what this used
 *                  to be and is why the feed opened identically every launch.
 *                  Guessing a level instead would be worse than not knowing
 *                  one: it would quietly bury content for a user we have no
 *                  reading on.
 *
 * Nothing here is persisted, deliberately. A fresh order per session is the
 * point, and feedOrder.ts says so in its own header — a remembered shuffle
 * reproduces the "same videos every time" complaint one step later.
 *
 * WATCHED IDS ARE READ HERE, at order time, so they are a snapshot of the
 * session start. markWatched fires as slides activate, and re-reading it per
 * change is what makes the append below place new arrivals against current
 * watch state rather than against boot's.
 */
function orderFeed(list: EmbedVideo[]): EmbedVideo[] {
  const level = storage.getStartLevel();
  if (!level) {
    if (list.length > 0) feedLog(`order: no startLevel, shuffling ${list.length}`);
    return shuffled(list);
  }
  const watchedIds = new Set(storage.getWatchedVideoIds());
  if (list.length > 0) {
    feedLog(
      `order: startLevel=${level}, ${list.length} videos, ${watchedIds.size} watched`
    );
  }
  /**
   * orderVideosForLevel is declared over Video and REORDERS ONLY — it never
   * constructs an element — so every member of the result is one of the
   * EmbedVideo values passed in. The assertion restores what the signature
   * widens; it is not hiding a shape difference.
   */
  return orderVideosForLevel(list, level, { watchedIds }) as EmbedVideo[];
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
  active,
  onAreaLayout,
}: {
  videos: EmbedVideo[];
  box: Omit<PlayerBox, 'visible'> | null;
  bandTop: number | null;
  /** Is the feed the visible tab? Gates the player, the karaoke loop and the
      blank hold — everything that should go quiet behind another screen. */
  active: boolean;
  onAreaLayout: (event: LayoutChangeEvent) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [pageHeight, setPageHeight] = useState(0);

  /**
   * CHECKPOINT F. Raised while the recall answer bar has been lifted by the
   * keyboard into the player's region — see HIDE_PLAYER_WHILE_TYPING in
   * recall.ts. The player yields exactly the way it already does for a swipe:
   * the WebView layer fades and the poster underneath carries the frame.
   */
  const [playerObscured, setPlayerObscured] = useState(false);

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

  const activeVideo = videos[activeIndex] ?? null;

  /**
   * Publish the player's geometry and visibility upward. PlayerHost now wraps
   * the whole app, so the box travels through context instead of a prop — see
   * usePlayerBox.
   *
   * Four things can hide the player, and all four live here because all four
   * are facts about the feed:
   *   !box          nothing has measured the player area yet
   *   !active       the feed is not the visible tab — the WebView is absolutely
   *                 positioned over the window and would otherwise float over
   *                 Vocab and Progress
   *   dragging      a finger is down; the player does not follow the scroll, so
   *                 leaving it visible parks the outgoing video over the
   *                 incoming slide. The poster underneath covers the gap.
   *   playerObscured the recall answer bar sits over the player area, which is
   *                 what keeps "nothing is drawn over the player" true with a
   *                 keyboard up.
   */
  const setPlayerBox = usePlayerBox();
  useEffect(() => {
    setPlayerBox({
      top: box?.top ?? 0,
      left: box?.left ?? 0,
      width: box?.width ?? 0,
      height: box?.height ?? 0,
      visible: Boolean(box) && active && !dragging && !playerObscured,
    });
  }, [box, active, dragging, playerObscured, setPlayerBox]);

  /**
   * PAUSE ON BLUR, AND STAY PAUSED ON RETURN.
   *
   * Leaving the tab must not leave audio playing under Vocab. Coming back
   * deliberately does NOT auto-resume: the player keeps its position and waits
   * for a tap, because a video that starts talking the moment a tab appears is
   * worse than one extra tap. PlayerDriver cannot undo this — its loadAndPlay
   * early-returns on an unchanged id (requestedIdRef), so returning to the same
   * slide issues no play.
   */
  const api = usePlayerApi();
  useEffect(() => {
    if (!active) api.pause();
  }, [active, api]);

  return (
    <>
      {/* CHECKPOINT F. Wraps the list because every slide's Karaoke reads the
          plan. It only ever sees the ACTIVE video — there is one session, not
          one per slide. `active` disarms the hold entirely off-tab: without it
          the frame callback would keep firing pause/seek at a hidden player and
          could engage a hold on a screen the user cannot see. */}
      <RecallHost
        video={active ? activeVideo : null}
        language={language}
        onObscurePlayer={setPlayerObscured}
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
                  // Slide-active AND tab-active. Gating here is what stops the
                  // karaoke frame callback, the sound/speed controls and the
                  // video tap handler from running for a feed nobody is looking
                  // at.
                  isActive={active && index === activeIndex}
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
              // R4. The default is 'never', which spends the first tap on
              // dismissing the keyboard and never delivers it — so with a
              // recall keyboard up, tapping a word to save it would silently
              // need two taps. 'handled' delivers the tap AND keeps the
              // keyboard, letting the child decide.
              keyboardShouldPersistTaps="handled"
              // The web's IntersectionObserver at 0.6, expressed for a list.
              viewabilityConfig={VIEWABILITY_CONFIG}
              onViewableItemsChanged={onViewableItemsChanged}
              onScrollBeginDrag={() => setDragging(true)}
              onMomentumScrollEnd={() => setDragging(false)}
              onScrollEndDrag={() => setDragging(false)}
            />
          )}

          <PlayerDriver video={activeVideo} />
          <Readouts total={videos.length} index={activeIndex} />
          <WordSheet
            data={sheet}
            language={language}
            bandTop={bandTop}
            onClose={() => setSheet(null)}
          />
          {/* Hoisted out of the list for the same reason WordSheet is, plus
              two of its own — see the header note in RecallBar.tsx. */}
          <RecallBar />
        </View>
      </RecallHost>
    </>
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

  /**
   * Watch tracking, feeding Progress's video counts and the feed-order
   * planner's unseen-first rule. The web does exactly this on slide activation
   * (Feed.tsx:558-560). `isActive` already means slide-active AND tab-active,
   * so a video is never marked watched because it happened to be the active
   * slide of a feed nobody was looking at.
   */
  useEffect(() => {
    if (isActive) storage.markWatched(video.id);
  }, [isActive, video.id]);

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
                 *
                 * KEEPING IT PLAYING IS THE PAGE'S JOB, and used to be tried
                 * here as `if (!status.playing) api.play()`. That guard could
                 * never fire when it mattered: status.playing is a
                 * bridge-fed React value describing the player BEFORE this
                 * command, so it cannot see a pause the unmute itself causes.
                 * The result was one tap for sound and a second tap to start
                 * the video again. page.ts reads the player's live state
                 * inside the unmute command instead — see cmd:'unmute'.
                 */
                if (status.muted) {
                  api.unmute();
                  // A real gesture, so this is a genuine user CHOICE and may be
                  // persisted (core/storage.ts setSessionUnmuted: every caller
                  // is a user gesture; an auto-mute must never write here).
                  storage.setSessionUnmuted(true);
                  // Sound has been found. Stops the prompt's pulse for the
                  // rest of the session — this is the path most users take,
                  // so missing it here would leave it pulsing forever.
                  hasUnmutedOnce = true;
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
        {/* TWO EXPLICIT ROWS, replacing one wrapping row of four children.
            The old row relied on wrap to push the attribution onto line 2,
            which meant the sound pill sat wherever the level chip and speed
            control left it — mid-line, next to everything else. Naming the
            rows lets the sound prompt own the empty right end of line 1
            (marginLeft:'auto') while the attribution keeps a full-width line
            of its own. Spacing is unchanged: the old row's `gap: 8` supplied
            the vertical gap between wrapped lines, so bandAuthor carries the
            same 8 as paddingTop. */}
        <View style={styles.bandTop}>
          <View style={styles.bandTopLeft}>
            <Text style={styles.level}>{video.level}</Text>
            {isActive && <SpeedControl />}
          </View>
          {isActive && <SoundControl />}
        </View>
        <View style={styles.bandAuthor}>
          <AuthorLine video={video} />
        </View>
        <Karaoke
          cues={video.cues}
          language={language}
          active={isActive && ownsMedia}
          videoKey={video.id}
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
/**
 * Has sound been turned on at least once this session?
 *
 * Module-scoped rather than component state because SoundControl unmounts and
 * remounts on every slide change (`isActive &&`), and this must not reset with
 * it. It gates the pulse only: once the user has found sound, the prompt is a
 * reminder rather than a discovery aid, and a chip that keeps pulsing at
 * someone who already knows is just noise.
 *
 * Not persisted. A fresh launch is a fresh chance to miss the control.
 */
let hasUnmutedOnce = false;

/**
 * The sound control. IT LIVES IN THE BAND — never over the player. That is the
 * embed-terms rule the whole slide layout exists to satisfy, and it is why the
 * web puts sound in the ActionRail for embeds rather than in the centred
 * overlay it uses for its own files. This component is inside the band's top
 * row and cannot be moved over the frame under any interpretation.
 *
 * TWO STATES, AND THE PROMPT IS NOT ONE OF THEM ONCE SOUND IS ON.
 *
 *   muted    a solid mint prompt — "🔇 Tap for sound" — pulsing until the
 *            first unmute of the session. This is a call to action and is
 *            styled like one.
 *   unmuted  the prompt is GONE. What remains is a quiet 🔊 toggle, because
 *            the video tap is play/pause from here on and this becomes the
 *            only way back to muted.
 *
 * WHY THE PROMPT USED TO LINGER, since it looked like a state bug and was not.
 * The old pill read `status.muted` correctly — that value comes from the page
 * calling the PLAYER's own isMuted() (page.ts postMuted) and crossing the
 * bridge, so it was never stale. What it did was swap its label to "🔊 Sound"
 * and keep sitting there at 60% white on a 16%-mint ground: low contrast,
 * no longer prompting anything, still taking band width. The fix is not to the
 * state read — that was already right — it is that an answered prompt should
 * stop being a prompt.
 */
function SoundControl() {
  const api = usePlayerApi();
  const status = usePlayerStatus();

  // Respect Reduce Motion. Starts true so a motion-sensitive user never sees
  // even one frame of pulse before the answer comes back.
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (alive) setReduceMotion(on);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  const shouldPulse = status.muted && !hasUnmutedOnce && !reduceMotion;

  // Scale, not opacity or layout: a transform never re-measures, so the band
  // cannot change height mid-pulse and the player cannot resize under it.
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (!shouldPulse) {
      cancelAnimation(pulse);
      pulse.value = 1;
      return;
    }
    pulse.value = withRepeat(
      withSequence(
        withTiming(1.06, { duration: 650 }),
        withTiming(1, { duration: 650 })
      ),
      -1,
      false
    );
    return () => {
      cancelAnimation(pulse);
      pulse.value = 1;
    };
  }, [shouldPulse, pulse]);

  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  // The bridge calls are untouched — same two lines, same order, same
  // persisted-choice split between a deliberate unmute and a deliberate mute.
  //
  // This pill never had a resume of its own, so on a player the unmute
  // paused it turned sound on over a stopped video. It gets the fix for free
  // now that keeping playback running is decided inside cmd:'unmute'.
  const toggle = useCallback(() => {
    if (status.muted) {
      api.unmute();
      storage.setSessionUnmuted(true);
      hasUnmutedOnce = true;
    } else {
      // A deliberate mute is also a user choice, and is persisted as one —
      // the same split the web draws between handleUserMute (persisted) and
      // handleAutoMuted (never persisted).
      api.mute();
      storage.setSessionUnmuted(false);
    }
  }, [api, status.muted]);

  if (!status.muted) {
    return (
      <Pressable
        onPress={toggle}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Sound on. Tap to mute."
        style={({ pressed }) => [
          styles.soundSlot,
          styles.soundToggle,
          pressed && styles.soundPressed,
        ]}
      >
        <Text style={styles.soundToggleText}>🔊</Text>
      </Pressable>
    );
  }

  return (
    <Animated.View style={[styles.soundSlot, pulseStyle]}>
      <Pressable
        onPress={toggle}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Turn on sound"
        accessibilityHint="Plays this video with sound"
        style={({ pressed }) => [styles.soundPrompt, pressed && styles.soundPressed]}
      >
        <Text style={styles.soundPromptText}>🔇 Tap for sound</Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * The speed control. IT LIVES IN THE BAND, next to the level chip and the sound
 * control — never over the player, for the same embed-terms reason
 * SoundControl is here and not floating over the frame.
 *
 * A SEGMENTED CONTROL, NOT A CYCLING CHIP. Three side-by-side rates, tap one to
 * go straight to it. The cycling chip it replaces made 0.5× a two-tap journey
 * through 0.75× — and every intermediate tap actually changed playback speed,
 * so the user heard a rate they did not ask for on the way.
 *
 * THE OLD COMMENT HERE CLAIMED A SEGMENTED CONTROL WOULD PUSH THE ATTRIBUTION
 * ONTO A SECOND LINE. Measured, that premise was wrong: the attribution line is
 * ~220pt for a median channel name and has NEVER fitted beside the level chip
 * and sound pill — the band is already a two-line wrapping row today, on every
 * device width, in both sound states. At ~118pt this control still fits on
 * line 1 (worst case 303 of 335pt usable, muted, on a 375pt device), so the
 * band stays two lines and the player does not shrink. ~32pt of headroom; if a
 * larger text setting ever eats it, this control wraps to line 2 and the band
 * grows — degraded layout, never a player overlap.
 *
 * SLOW ONLY, and never above 1: the feature exists because some videos speak
 * too fast for a learner, and a 2x option in a comprehension app is a trap.
 *
 * THE OPTIONS ARE INTERSECTED WITH WHAT THE PLAYER REPORTS, never hardcoded.
 * getAvailablePlaybackRates() is per-video, and offering a rate the video does
 * not support means setPlaybackRate is silently ignored — a segment that looks
 * live and does nothing. Fewer than two real options is not a choice, so the
 * control falls back to a read-only reading of the current rate.
 */
const SPEED_OPTIONS = [0.5, 0.75, 1];

function SpeedControl() {
  const api = usePlayerApi();
  const status = usePlayerStatus();

  // Only rates this video actually offers, slowest first — reading order
  // matches the ladder, so "further left = slower" is learnable at a glance.
  const options = useMemo(() => {
    if (!status.availableRates) return null;
    const offered = SPEED_OPTIONS.filter((r) => status.availableRates?.includes(r));
    return offered.length > 1 ? offered : null;
  }, [status.availableRates]);

  // Nothing to choose between — or the player has not reported yet, which is
  // the case for the moment after every swap. Show the truth, offer nothing.
  if (!options) {
    return (
      <View
        accessibilityRole="text"
        accessibilityLabel={`Playback speed ${formatRate(status.rate)} times`}
        style={[styles.speedGroup, styles.speedGroupIdle]}
      >
        <Text style={styles.speedIdleText}>{formatRate(status.rate)}×</Text>
      </View>
    );
  }

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Playback speed"
      style={styles.speedGroup}
    >
      {options.map((rate) => {
        // Compared against the PLAYER's confirmed rate, never what we asked
        // for. A request the video ignored must leave the old segment lit.
        const active = status.rate === rate;
        return (
          <Pressable
            key={rate}
            onPress={() => {
              // EXACTLY the two calls the cycling chip made — the bridge and
              // the persisted preference are untouched by this change. Only
              // which value gets passed is different: the one tapped, rather
              // than the next one round the loop.
              api.setRate(rate);
              setStoredRate(rate);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Playback speed ${formatRate(rate)} times`}
            // Vertical only. The segments touch, so horizontal slop would
            // overlap a neighbour's target and hand taps to the wrong rate.
            // 11pt each way lifts the ~22pt row to a 44pt effective target.
            hitSlop={{ top: 11, bottom: 11 }}
            style={({ pressed }) => [
              styles.speedSegment,
              active && styles.speedSegmentOn,
              pressed && !active && styles.speedSegmentPressed,
            ]}
          >
            <Text
              style={[styles.speedSegmentText, active && styles.speedSegmentTextOn]}
            >
              {formatRate(rate)}×
            </Text>
          </Pressable>
        );
      })}
    </View>
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
    // Kept as a safety net rather than a mechanism: measured, this row is
    // 277.8 of 335pt usable on the narrowest supported device in its widest
    // (muted) state, so it fits. If a larger text setting ever breaks that,
    // the sound control drops to its own line still right-aligned — the band
    // grows, and nothing is ever drawn over the player.
    flexWrap: 'wrap',
  },
  bandTopLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 8,
  },
  /** paddingTop 8 reproduces exactly what the old row's `gap` gave between its
      wrapped lines, so splitting the row did not change the band's height. */
  bandAuthor: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 6 },
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
  /** Anchors the control to the empty right end of the band's top row. */
  soundSlot: { marginLeft: 'auto' },
  /**
   * THE PROMPT, and it is deliberately the loudest thing in the band.
   *
   * The old treatment was a 10%-white chip with 60%-white text — quieter than
   * the level chip beside it, for the one control the user MUST find before
   * the app makes any sense. This inverts that: solid mint, near-black 800
   * text. It is the only filled-mint element in the band while it shows, and
   * it stops existing the moment sound is on, so it can afford to shout.
   */
  soundPrompt: {
    backgroundColor: '#5ee6a8',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  soundPromptText: { color: '#06130d', fontSize: 12, fontWeight: '800' },
  /**
   * Sound is already on, so this is not a prompt — it is the way back to
   * muted, and nothing more. Quiet by design; minWidth keeps a lone glyph from
   * being a sliver of a tap target.
   */
  soundToggle: {
    alignItems: 'center',
    backgroundColor: 'rgba(242,245,243,0.10)',
    borderRadius: 999,
    justifyContent: 'center',
    minWidth: 40,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  soundToggleText: { fontSize: 13 },
  soundPressed: { opacity: 0.7 },
  /**
   * THE SPEED CONTROL DOES NOT SHARE THE LEVEL CHIP'S SHAPE, ON PURPOSE.
   *
   * The level chip is a borderless radius-6 tag and is NOT interactive. Anything
   * that looks like it reads as a label. The outer border and full rounding are
   * what say "this is a control" on a dark ground — and here they do a second
   * job: they GROUP the three segments. Without the container, three loose
   * numbers next to a "B1" tag read as metadata, not as a choice.
   *
   * Measured ~118pt with all three options (37.5 + 44.9 + 30 + 4 padding + 2
   * border). See SpeedControl's header for how that lands in the band.
   */
  speedGroup: {
    alignItems: 'center',
    backgroundColor: 'rgba(242,245,243,0.10)',
    borderColor: 'rgba(242,245,243,0.32)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    padding: 2,
  },
  /**
   * Before the player has reported its rates — the state every slide starts in
   * for a moment after a swap.
   *
   * 0.78, not 0.45. At 45% on a #0a0d0b ground the whole control read as
   * disabled chrome, and since this is the first thing every slide shows, that
   * was the first impression the control ever made.
   */
  speedGroupIdle: { opacity: 0.78, paddingHorizontal: 8 },
  speedIdleText: {
    color: '#f2f5f3',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
  },
  /**
   * minWidth keeps "1×" from collapsing to a sliver next to "0.75×" — a target
   * you can hit without aiming. Tabular numerals so the segments do not
   * re-measure when the active one changes weight.
   */
  speedSegment: {
    alignItems: 'center',
    borderRadius: 999,
    justifyContent: 'center',
    minWidth: 30,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  /**
   * THE ACTIVE SEGMENT IS MARKED THREE WAYS, NOT JUST BY COLOUR: a filled pill
   * behind it (shape), 800 against the others' 600 (weight), and
   * accessibilityState.selected (assistive tech). Any one of the three carries
   * the state on its own, so colour-blind users and VoiceOver users are not
   * relying on the mint fill to know which rate is live.
   */
  speedSegmentOn: { backgroundColor: '#5ee6a8' },
  speedSegmentPressed: { backgroundColor: 'rgba(242,245,243,0.14)' },
  speedSegmentText: {
    color: 'rgba(242,245,243,0.62)',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    fontWeight: '600',
  },
  speedSegmentTextOn: { color: '#06130d', fontWeight: '800' },
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
