import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
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
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import type { Video, Word } from '@loro/core/types';
import { getCatalog, onCatalogChanged } from '@loro/core/catalog';
import { storage } from '@loro/core/storage';
import { refreshCatalog } from '../platform/catalog';
import { trackOnce } from '../platform/analytics';
import {
  usePlayerApi,
  usePlayerBox,
  usePlayerClock,
  usePlayerStatus,
  type PlayerBox,
} from '../player/PlayerHost';
import { setStoredRate } from '../player/rate';
import { useTabBarHeight } from '../shell/tabBar';
import { AuthorLine } from './AuthorLine';
import { Karaoke } from './Karaoke';
import { NotificationPrompt } from './NotificationPrompt';
import { RecallBar } from './RecallBar';
import { RecallHost, useHeldBlank, useRecallReplay } from './RecallHost';
import {
  consumeReviewTarget,
  subscribeToReviewTarget,
  type ReviewTarget,
} from './reviewTarget';
import { SEEK_BACK_PAD_S } from './recall';
import { SessionSavePrompt } from './SessionSavePrompt';
import { WalkthroughCoach, type CoachCardContent } from './WalkthroughCoach';
import { SeekBar } from './SeekBar';
import { currentCueStart } from './subtitles';
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
 * muted autoplay, the pointerEvents player layer, attribution, karaoke, swipe.
 *
 * The on-screen drift/PLAYING readouts D shipped are GONE, along with the
 * 52pt of top chrome they sat in and the PlayerHost plumbing that fed them.
 * They were a lab instrument on a production screen. What they proved is
 * proved; the player area now uses the space.
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

/** Every embed is 9:16. */
const PLAYER_ASPECT = 9 / 16;

/**
 * How much speech to hear before the word a review jumped to. The same three
 * seconds the Words screen's hear-it player uses, and for the same reason:
 * a word arriving cold is a quiz question, a word arriving in a sentence is a
 * memory.
 */
const REVIEW_LEAD_IN_S = 3;

/** How often an EMPTY feed re-asks for the catalog — see the retry effect in
    FeedScreen. */
const EMPTY_RETRY_MS = 10_000;

type EmbedVideo = Video & { youtubeId: string };

/**
 * THE ONBOARDING WALKTHROUGH'S HANDLE ON THE FEED, and nothing else's.
 *
 * The taste reel drives a scripted first run through three real clips: stop on
 * a cue, ring one word, take the tap itself, then ask core to blank that same
 * word in the next clip. All of that needs to reach INSIDE the feed, and the
 * alternative — a second, simplified feed built for onboarding — is the thing
 * this whole design exists to avoid, because a demonstration that is not the
 * product demonstrates nothing.
 *
 * Bundled into one optional prop rather than five loose ones so the real feed
 * reads as it did: `walkthrough` is undefined in Shell, and every branch below
 * that mentions it is skipped. Nothing here has a default that changes feed
 * behaviour.
 */
export type FeedWalkthrough = {
  /** Ring this word, in this cue, on the ACTIVE slide. See Karaoke.spotlight. */
  spotlight: { cueIndex: number; surface: string } | null;
  /**
   * The coach card to float over the band, or null for none. Drawn by the feed
   * rather than by the step because only the feed knows where the player ends:
   * the card is anchored at the measured bandTop, which is what keeps it off
   * the frame on every device instead of on the ones a constant happened to
   * fit. See WalkthroughCoach for the full geometry argument.
   */
  coach?: CoachCardContent | null;
  /** Show the swipe hint in the same floating slot when no card is up. */
  hint?: boolean;
  hintText?: string;
  /**
   * Handed to core as the blank plan's `first`, overriding the Words tab's
   * review target (which cannot be set during onboarding anyway). This is what
   * makes the word saved in clip 1 come back in clip 2 rather than in whichever
   * video happens to say it next.
   */
  focusWord: string | null;
  /**
   * A word was SAVED through the real sheet — the sheet opened, showed its
   * gloss, and the user pressed Save.
   *
   * The script does not intercept the tap. It used to, and that was wrong: the
   * sheet is most of what this screen exists to demonstrate, and replacing it
   * with a bespoke card showed people a save flow the app does not have. So the
   * tap behaves exactly as it does in the feed and the walkthrough reacts to
   * the outcome instead.
   */
  onWordSaved?: (video: EmbedVideo, word: Word, cueIndex: number) => void;
  /**
   * Open the ACTIVE clip at this second instead of at its beginning.
   *
   * Handed to loadVideoById, which takes a start time — so the clip opens
   * there rather than seeking after it has already begun playing the intro.
   * The taste reel uses it to drop the user in a couple of seconds before the
   * word it just promised would come back, because the wait between the swipe
   * and the blank otherwise reads as the app having forgotten.
   */
  startSeconds?: number | null;
  /**
   * May the ACTIVE clip plan blue level blanks, and at most how many?
   *
   * Off for the coached clips, because a blue blank is indistinguishable from
   * the scripted one to a first-time user and can land anywhere, including
   * before the beat the script is building to. On for the last clip, capped at
   * one: by then the guided part is over, and a single blue gap is how the user
   * learns the ladder exists at all without the screen turning into a test.
   */
  levelBlanks?: boolean;
  maxLevelBlanks?: number;
  /** May the ACTIVE clip plan green recall blanks? Off for the reel's
      uncoached clips, so due words a returning device carries into
      onboarding cannot freeze a scripted beat. See RecallHost. */
  recallBlanks?: boolean;
  /** Earliest second a blue blank may stop the ACTIVE clip. See RecallHost. */
  minLevelBlankAtS?: number;
  /** The word plays as itself and becomes a gap only at the freeze — a
      giveaway mode no beat currently uses. See RecallHost. */
  revealBlanksUntilHeld?: boolean;
  /** Exactly this word at exactly this cue as the blue blank, instead of the
      planner's pick. See RecallHost's scriptedLevelBlank* props. */
  scriptedLevelBlank?: { cueIndex: number; text: string } | null;
  /** Pin the focusWord blank to this cue — see RecallHost's focusCueIndex. */
  focusCueIndex?: number;
  /** Fired after a blank is graded, either kind, right or wrong. */
  onBlankResolved?: (kind: 'recall' | 'level', cueIndex: number) => void;
  /** Draw the swipe hint loud — the walkthrough's full-stop moments, where
      the video is paused and the swipe is the only move left. */
  hintEmphatic?: boolean;
  /** Which slide is on screen now. Drives the script's beats. */
  onSlideChange?: (index: number, total: number) => void;
  /**
   * Hands the script a way to move the list itself, so the walkthrough's own
   * button can advance a clip rather than only ending the flow.
   *
   * Called with the controls when the list is up and with null when it goes
   * away, so a held reference can never outlive the list it drives.
   */
  registerControls?: (controls: FeedControls | null) => void;
  /** The user pulled past the last slide. Fired once per arrival at the end. */
  onPastEnd?: () => void;
};

/** What the walkthrough can ask the feed to do. */
export type FeedControls = {
  /** Move to a slide, animated, exactly as a swipe would. */
  scrollToIndex: (index: number) => void;
};

/** How far past the end counts as "tried to scroll on the last one", in points. */
const PAST_END_SLOP = 56;

/** Feed-side diagnostics. Its own tag rather than recall's flog, so filtering
    for one does not drag in the other. */
function feedLog(message: string): void {
  console.log(`[loro:feed] ${message}`);
}

/**
 * Said once per launch, the first time a hidden tab reports a zero layout.
 * Kept because it is the evidence for the guards below rather than a hunch —
 * if this never prints, the platform stopped doing it and the guards are
 * merely harmless.
 */
let hiddenLayoutNoted = false;
function noteHiddenLayout(): void {
  if (hiddenLayoutNoted) return;
  hiddenLayoutNoted = true;
  feedLog('ignoring 0x0 layout from a hidden tab (keeping the last real one)');
}

export function FeedScreen({
  active,
  reel,
  walkthrough,
}: {
  active: boolean;
  /**
   * SHOW EXACTLY THESE VIDEOS, IN THIS ORDER — the onboarding taste reel.
   *
   * When it is present the feed stops being a feed: no shuffle, no
   * unseen-first, no append-on-refresh, and the list is whatever these ids
   * resolve to against the live catalog. Everything BELOW this line is
   * untouched, which is the point — the taste has to be the real slide, the
   * real player and the real karaoke, or it is not a demonstration of
   * anything. See onboarding/taste.ts.
   *
   * Absent (the normal feed) every path behaves exactly as it did before.
   */
  reel?: readonly Video[];
  /** Present ONLY in onboarding's taste step. See FeedWalkthrough. */
  walkthrough?: FeedWalkthrough;
}) {
  /**
   * The order settled on for THIS mount, or null before anything has settled.
   *
   * ORDERING ONCE IS THE WHOLE CONTRACT. Re-running it on a catalog change
   * would rearrange the feed under someone already scrolling it, which is a
   * bug rather than a refresh — the web keeps the same ref for the same reason
   * (Feed.tsx:90-91).
   */
  const orderedRef = useRef<EmbedVideo[] | null>(null);

  /**
   * A reel is a FIXED list, so it needs none of the settling machinery below:
   * there is no order to preserve against a refresh, nothing to append, and
   * the caller has already resolved it against the catalog. Held in a ref so
   * the identity is stable for the effect's early return.
   */
  const reelRef = useRef(reel);
  reelRef.current = reel;

  const [videos, setVideos] = useState<EmbedVideo[]>(() => {
    if (reel) return embedsFrom(reel as Video[]);
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
        setVideos((current) => {
          // A reel is fixed for the life of the step — a catalog refresh must
          // not reorder or extend the three clips someone is mid-swipe through.
          if (reelRef.current) return current;

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
   * WHILE THE LIST IS EMPTY, KEEP ASKING FOR THE CATALOG.
   *
   * An empty list here means the first snapshot download has never landed —
   * the bundled seed carries nothing embeddable (see embedsFrom). finishBoot's
   * refresh runs once per launch, so if THAT attempt failed offline, nothing
   * else would ever fill this screen until the next cold start. The interval
   * is cheap (the pointer probe is ~100 bytes, refreshCatalog never throws,
   * and a repeatedly-broken blob backs off on its hash inside refreshCatalog,
   * not here) and it removes itself: a successful refresh lands through
   * onCatalogChanged above, the list fills, and the cleanup runs on the next
   * render.
   */
  const emptyFeed = videos.length === 0;
  useEffect(() => {
    if (!emptyFeed) return;
    const id = setInterval(() => void refreshCatalog(), EMPTY_RETRY_MS);
    return () => clearInterval(id);
  }, [emptyFeed]);

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
    /**
     * ⚠️ A HIDDEN TAB MEASURES ZERO, AND ZERO IS NOT A MEASUREMENT.
     *
     * Shell hides the inactive tabs with `display:'none'`, which takes them
     * out of Yoga's layout entirely — so leaving this tab reports 0x0 here.
     * Accepting it collapsed the player box to nothing and made the WebView
     * resize to 0x0 and back on every single tab switch, which is most of why
     * moving between Feed, Words and Progress felt slow.
     *
     * The last real measurement is still true: the player area has not
     * changed size, the tab is simply not on screen. Ignoring the zero keeps
     * it, and the geometry is ready the instant the tab comes back.
     */
    if (width <= 0 || height <= 0) {
      noteHiddenLayout();
      return;
    }
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

  // Nothing to render a feed FROM — show the honest waiting state instead of
  // a black screen. Everything inside FeedBody assumes at least one slide.
  if (emptyFeed) return <EmptyFeed />;

  return (
    <FeedBody
      videos={videos}
      box={box}
      bandTop={bandTop}
      active={active}
      walkthrough={walkthrough}
      onAreaLayout={onAreaLayout}
    />
  );
}

/** How long the quick case gets before EmptyFeed admits something is wrong. */
const SLOW_HINT_MS = 6000;

/**
 * The first-ever launch, before the catalog snapshot has ever downloaded.
 *
 * A returning device never sees this (the cached snapshot installs
 * synchronously at boot), and a first launch on a working connection sees it
 * for around a second — the refresh was kicked at finishBoot, while the user
 * was still walking through onboarding. What this screen really exists for is
 * the failure tail: no network on a first run. It starts as a plain loading
 * state, and only once the quick case has had its chance does it name the
 * likely cause and offer a manual retry on top of the automatic one
 * FeedScreen already runs.
 */
function EmptyFeed() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), SLOW_HINT_MS);
    return () => clearTimeout(id);
  }, []);

  return (
    <View style={styles.emptyRoot}>
      <ActivityIndicator color="#5ee6a8" />
      <Text style={styles.emptyTitle}>Getting your videos…</Text>
      {slow && (
        <>
          <Text style={styles.emptyBody}>
            The first load needs an internet connection. It keeps retrying on
            its own — or give it a nudge.
          </Text>
          <Pressable
            onPress={() => void refreshCatalog()}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.emptyCta,
              pressed && styles.emptyCtaPressed,
            ]}
          >
            <Text style={styles.emptyCtaText}>Try again</Text>
          </Pressable>
        </>
      )}
    </View>
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
 * The feed's order for this session: A STRAIGHT SHUFFLE, every launch.
 *
 * WHAT THIS USED TO DO, and why it changed. The order was core's
 * orderVideosForLevel — unwatched videos first, then sorted by distance from
 * the calibrated CEFR band, shuffled only WITHIN those ties. It was random on
 * paper and predictable in the hand: with most of the catalog at one level and
 * unwatched, the buckets are lopsided, so the same pool kept surfacing at the
 * top and the feed felt like it opened in the same place every time.
 *
 * A flat shuffle is the most different-every-time this can be, which is what
 * was asked for. Two things are knowingly given up:
 *
 *   LEVEL MATCHING. A beginner can now open on a B2 clip. The level meter and
 *   the near-miss tier still adapt, but the FEED no longer leans toward the
 *   calibrated band at all.
 *   UNSEEN-FIRST. Already-watched videos can appear anywhere, including first.
 *
 * Both are one call away if the feed starts feeling wrong — the core function
 * is untouched and still ordered the web's feed the old way. This is a mobile
 * decision only.
 *
 * Nothing here is persisted, deliberately. A fresh order per session is the
 * point, and feedOrder.ts says so in its own header — a remembered shuffle
 * reproduces the "same videos every time" complaint one step later.
 */
function orderFeed(list: EmbedVideo[]): EmbedVideo[] {
  if (list.length > 0) feedLog(`order: shuffling ${list.length}`);
  return shuffled(list);
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
  walkthrough,
  onAreaLayout,
}: {
  videos: EmbedVideo[];
  box: Omit<PlayerBox, 'visible'> | null;
  bandTop: number | null;
  /** Is the feed the visible tab? Gates the player, the karaoke loop and the
      blank hold — everything that should go quiet behind another screen. */
  active: boolean;
  walkthrough?: FeedWalkthrough;
  onAreaLayout: (event: LayoutChangeEvent) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  /**
   * WHERE A FRESH LIST STARTS. FlashList reads `initialScrollIndex` once, at
   * mount, so this has to hold the truth at every moment a mount could happen
   * — which is why it is written during render rather than from an effect.
   *
   * It earns its keep twice: it is how the review jump lands (see below), and
   * it also means that if this list is ever torn down and rebuilt, it comes
   * back where the user left it instead of at the top.
   */
  const mountIndexRef = useRef(0);
  /** Bumped to force a remount — the review jump's whole mechanism. */
  const [listGeneration, setListGeneration] = useState(0);
  /** The index a jump is waiting on — see applyViewableIndex. */
  const jumpTargetRef = useRef<number | null>(null);
  /**
   * A SWIPE IS IN FLIGHT — finger down OR still settling. Both halves matter,
   * and the second one is what this used to get wrong.
   */
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
   * The same yield, for the notification explainer. HELD SEPARATELY from
   * playerObscured on purpose: that one is RecallHost's to write, and two
   * writers on one flag would race, with whichever lowered it last winning
   * while the other overlay was still up.
   */
  const [promptObscured, setPromptObscured] = useState(false);

  /**
   * The tapped word, or null. Held HERE rather than in the slide because the
   * sheet must render outside the FlashList — a recycled cell would take the
   * sheet down with it mid-swipe.
   */
  const [sheet, setSheet] = useState<WordSheetData | null>(null);
  /**
   * Stable, and that is the whole point of it taking the video as an argument.
   * As an inline closure per slide it changed identity on every render of this
   * component, which defeated Slide's memo and re-rendered every mounted cell
   * on a tab switch — the cells were the last big cost in that switch.
   */
  const handleWordTap = useCallback(
    (video: EmbedVideo, word: Word, cueIndex: number) =>
      setSheet({ video, word, cueIndex }),
    []
  );

  /**
   * The sheet's own data, mirrored so the save callback can name the video.
   *
   * WordSheet reports a save as a bare string — that is all its toast needs —
   * while the walkthrough needs the video and the cue the word came from, to
   * find the entry that was just written. The panel has usually closed by then,
   * so the ref rather than the state.
   */
  const sheetRef = useRef<WordSheetData | null>(null);
  sheetRef.current = sheet;

  const onWordSaved = walkthrough?.onWordSaved;
  const handleSheetSaved = useCallback(() => {
    const data = sheetRef.current;
    if (data) onWordSaved?.(data.video as EmbedVideo, data.word, data.cueIndex);
  }, [onWordSaved]);


  // Read once per mount, exactly as the web's Feed does: /profile is a separate
  // screen, so returning here remounts with the new value.
  const language = useMemo(() => storage.getLanguage(), []);

  // Hoisted out of the JSX below on purpose: the FlashList is rendered
  // conditionally on pageHeight, and a hook called inside that branch would run
  // on some renders and not others — "rendered more hooks than during the
  // previous render", thrown the moment the layout lands.
  /**
   * JUMP TO THE VIDEO THE WORDS TAB ASKED FOR.
   *
   * ⚠️ THIS MUST NOT DEPEND ON SCROLL TIMING, and two attempts at it did.
   * Shell keeps every tab mounted and hides the inactive ones with
   * `display:'none'`, which takes them OUT OF LAYOUT — so at the moment Words
   * makes the request this list has no geometry and `scrollToIndex` is a
   * no-op, while `setActiveIndex` applies regardless. The player dutifully
   * loaded the target video under a list still parked on another slide, which
   * from the sofa is exactly "it dropped me on a random word". Waiting for
   * `active` and a measured height fixed the ordering but not the fragility:
   * the scroll still had to land on a list that had just been re-added to
   * layout that same frame, and a scroll that silently misses looks identical
   * to no jump at all.
   *
   * SO THE LIST IS REMOUNTED AT THE TARGET instead of asked to travel to it.
   * `initialScrollIndex` is read during mount, before anything is on screen,
   * so there is no frame in which the wrong slide is showing and nothing to
   * race: the list simply comes into existence already there. The remount
   * costs the recycled cells of a feed the user is leaving anyway, and is
   * invisible because it happens in the same breath as the tab appearing.
   *
   * The request is still PARKED until `active` and a measured `pageHeight`
   * say the list can exist at all — below that, there is nothing to mount.
   */
  const [pendingTarget, setPendingTarget] = useState<ReviewTarget | null>(() =>
    consumeReviewTarget()
  );

  useEffect(
    () =>
      subscribeToReviewTarget((target) => {
        consumeReviewTarget(); // taken; it must not fire again on remount
        setPendingTarget(target);
      }),
    []
  );

  /**
   * THE LANDING, once it has been acted on — the word this feed was pointed
   * at and where it is spoken. It outlives the jump because two things need it
   * afterwards: the player opens the video a beat before that second, and the
   * blank plan is told to put that word first (RecallHost focusWord). Both
   * stop applying the moment the user swipes to another video, which is what
   * comparing against the active slide's id does for free.
   */
  const [landing, setLanding] = useState<ReviewTarget | null>(null);

  useEffect(() => {
    if (!pendingTarget || !active || pageHeight <= 0 || videos.length === 0) return;
    const index = videos.findIndex((v) => v.id === pendingTarget.videoId);
    setPendingTarget(null);
    if (index < 0) {
      // Not in this feed (denied, pruned, or a starter word with no clip).
      // Switching tabs is all that was promised.
      feedLog(`review target "${pendingTarget.word}": ${pendingTarget.videoId} not in feed`);
      return;
    }
    feedLog(
      `review target "${pendingTarget.word}" -> index ${index} ` +
        `@${pendingTarget.startsAt.toFixed(1)}s`
    );
    // Recorded even when the slide is already the right one: the seek and the
    // blank plan still have work to do.
    setLanding(pendingTarget);
    if (index === activeIndex) return; // already here — no remount needed
    jumpTargetRef.current = index;
    setActiveIndex(index);
    setListGeneration((generation) => generation + 1);
  }, [pendingTarget, active, pageHeight, videos, activeIndex]);

  /**
   * THE JUMP'S GUARD RAIL. A mounting list reports viewability as it settles,
   * and one stray "item 0 is visible" arriving after the jump would put the
   * active index straight back where it came from — the jump undone by the
   * list's own housekeeping, which looks exactly like the jump never happening.
   *
   * So while a jump is outstanding, only a report that AGREES with it counts.
   * The latch clears on that agreement, and on the first drag either way: a
   * feed whose active slide had stopped tracking the user's swipes would be a
   * far worse failure than landing on the wrong video.
   */
  const applyViewableIndex = (index: number) => {
    if (jumpTargetRef.current !== null) {
      if (index !== jumpTargetRef.current) return;
      jumpTargetRef.current = null;
    }
    setActiveIndex(index);
  };
  const onViewableItemsChanged = useStableViewability(applyViewableIndex);

  const swipe = useSwipeLifecycle(setDragging);

  const activeVideo = videos[activeIndex] ?? null;

  /**
   * Tell the script where we are. An effect rather than a call inside
   * applyViewableIndex, so it also fires for the FIRST slide — which is never
   * "changed to" and is exactly the one the walkthrough opens on.
   */
  const onSlideChange = walkthrough?.onSlideChange;
  useEffect(() => {
    onSlideChange?.(activeIndex, videos.length);
  }, [onSlideChange, activeIndex, videos.length]);

  /**
   * "They pulled past the last one." Fired at most once per visit to the end —
   * iOS bounces, so a single flick produces a run of frames beyond the content,
   * and an unlatched handler would raise the outro modal several times.
   */
  const pastEndRef = useRef(false);
  const onPastEnd = walkthrough?.onPastEnd;

  /**
   * The list itself, so the script's button can move it.
   *
   * scrollToIndex rather than the review jump's remount-at-index trick: that
   * one exists because a jump from ANOTHER TAB has no geometry to scroll
   * against, which is not this case — the list is on screen and measured, and
   * remounting it here would rebuild every cell and restart the player for
   * what the user experiences as a swipe.
   */
  const listRef = useRef<FlashListRef<EmbedVideo>>(null);
  const registerControls = walkthrough?.registerControls;
  useEffect(() => {
    if (!registerControls) return;
    registerControls({
      scrollToIndex: (index: number) => {
        const clamped = Math.min(Math.max(index, 0), videos.length - 1);
        listRef.current?.scrollToIndex({ index: clamped, animated: true });
        // The viewability callback will confirm it, but setting it here means
        // the script's own state moves on the press rather than a frame later.
        applyViewableIndex(clamped);
      },
    });
    return () => registerControls(null);
  }, [registerControls, videos.length]);
  // Written during render on purpose — see mountIndexRef. Any mount from here
  // on, jump or otherwise, starts on the slide the user is actually on.
  mountIndexRef.current = activeIndex;

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
      visible:
        Boolean(box) && active && !dragging && !playerObscured && !promptObscured,
    });
  }, [box, active, dragging, playerObscured, promptObscured, setPlayerBox]);

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
          one per slide. `active` disarms the HOLD off-tab: without it the frame
          callback would keep firing pause/seek at a hidden player and could
          engage a hold on a screen the user cannot see. It deliberately does
          NOT hide the video from the host: nulling it used to throw the plan
          away on every tab switch and rebuild it on the way back, which is
          work nobody asked for — see RecallHost's `planned` vs `armed`. */}
      <RecallHost
        video={activeVideo}
        active={active}
        language={language}
        // The script's word wins when there is one. A review target cannot
        // exist during onboarding (the Words tab is behind the paywall), so
        // these two can never both be set.
        focusWord={
          walkthrough
            ? walkthrough.focusWord
            : landing && activeVideo && landing.videoId === activeVideo.id
              ? landing.word
              : null
        }
        focusCueIndex={walkthrough?.focusCueIndex}
        recallBlanks={walkthrough?.recallBlanks ?? true}
        // Per-clip during the guided run, core's own rules everywhere else.
        levelBlanks={walkthrough ? (walkthrough.levelBlanks ?? false) : true}
        maxLevelBlanks={walkthrough?.maxLevelBlanks}
        minLevelBlankAtS={walkthrough?.minLevelBlankAtS}
        revealBlanksUntilHeld={walkthrough?.revealBlanksUntilHeld ?? false}
        scriptedLevelBlankCue={walkthrough?.scriptedLevelBlank?.cueIndex}
        scriptedLevelBlankText={walkthrough?.scriptedLevelBlank?.text}
        onBlankResolved={walkthrough?.onBlankResolved}
        // The guided run raises no asks of its own. See RecallHost's `quiet`.
        quiet={Boolean(walkthrough)}
        onObscurePlayer={setPlayerObscured}
      >
        <View
          style={styles.root}
          // Zero means "this tab is hidden", not "the page has no height" —
          // see onAreaLayout. Accepting it unmounted the whole FlashList
          // (`pageHeight > 0` below) on every switch away from the feed, and
          // rebuilt it, cells and all, on every switch back.
          onLayout={(event) => {
            const { height } = event.nativeEvent.layout;
            if (height > 0) setPageHeight(height);
            else noteHiddenLayout();
          }}
        >
          {pageHeight > 0 && (
            <FlashList
              ref={listRef}
              // The review jump's mechanism: a new key means a new list, and a
              // new list starts at initialScrollIndex. Nothing else changes it.
              key={listGeneration}
              // Clamped: a catalog refresh can drop videos out from under a
              // remembered index, and an out-of-range start is not worth a
              // crash on the one screen the app opens on.
              initialScrollIndex={Math.min(
                mountIndexRef.current,
                Math.max(0, videos.length - 1)
              )}
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
                  // ACTIVE SLIDE ONLY. FlashList recycles cells, and a ring
                  // drawn on a background slide would be waiting on a screen
                  // the user has already left.
                  spotlight={
                    active && index === activeIndex
                      ? (walkthrough?.spotlight ?? null)
                      : null
                  }
                  onWordTap={handleWordTap}
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
              // FOUR HANDLERS, NOT THREE — see useSwipeLifecycle. The old
              // trio cleared `dragging` on onScrollEndDrag, which is the
              // moment the FINGER lifts, not the moment the swipe ends.
              onScroll={
                onPastEnd
                  ? (event) => {
                      const { contentOffset, contentSize, layoutMeasurement } =
                        event.nativeEvent;
                      const past =
                        contentOffset.y >
                        contentSize.height - layoutMeasurement.height + PAST_END_SLOP;
                      if (past && !pastEndRef.current) {
                        pastEndRef.current = true;
                        onPastEnd();
                      } else if (!past && contentOffset.y < contentSize.height - layoutMeasurement.height) {
                        // Re-armed only after they come back off the end, so a
                        // dismissed modal can be raised again by pulling again.
                        pastEndRef.current = false;
                      }
                    }
                  : undefined
              }
              scrollEventThrottle={32}
              onScrollBeginDrag={() => {
                jumpTargetRef.current = null;
                swipe.onBeginDrag();
              }}
              onScrollEndDrag={swipe.onEndDrag}
              onMomentumScrollBegin={swipe.onMomentumBegin}
              onMomentumScrollEnd={swipe.onSettled}
            />
          )}

          <PlayerDriver
            video={activeVideo}
            landing={landing}
            startSeconds={walkthrough?.startSeconds ?? null}
          />
          <WordSheet
            data={sheet}
            language={language}
            bandTop={bandTop}
            onSaved={onWordSaved ? handleSheetSaved : undefined}
            onClose={() => setSheet(null)}
          />
          {/* Hoisted out of the list for the same reason WordSheet is, plus
              two of its own — see the header note in RecallBar.tsx. */}
          <RecallBar />
          {/* The guided run's floating coach marks, anchored at the measured
              bandTop so they can never touch the frame. Above RecallBar in
              paint order but pointer-transparent, so nothing changes for the
              answer flow; it also yields to a held blank on its own. */}
          {walkthrough && (
            <CoachLayer
              coach={walkthrough.coach ?? null}
              hint={walkthrough.hint ?? false}
              hintText={walkthrough.hintText ?? ''}
              hintEmphatic={walkthrough.hintEmphatic ?? false}
              top={bandTop}
            />
          )}
          {/* NEITHER CARD EXISTS DURING THE GUIDED RUN.
              RecallHost's `quiet` already stops them being raised, and that is
              the guard that matters — it is the one that keeps their budgets
              unspent. This is the second lock on the same door: these two are
              the only things in the feed that can cover the demonstration, and
              a subscription that outlived its raise (both are module-level
              listener sets) would put a modal about accounts on the screen
              before the paywall. Not rendering them cannot be defeated. */}
          {!walkthrough && (
            <>
              {/* Raised by RecallHost after the first correct answer's
                  celebration, and silent every other time. Last child so it
                  covers the band and the answer bar as well as the slide. */}
              <NotificationPrompt onObscurePlayer={setPromptObscured} />
              {/* Raised by RecallHost after the celebration for the grade that
                  emptied the due queue — and it wins that moment over the
                  notification explainer (see RecallHost's priority note). Same
                  obscure contract, same layering reason. */}
              <SessionSavePrompt onObscurePlayer={setPromptObscured} />
            </>
          )}
        </View>
      </RecallHost>
    </>
  );
}

/**
 * Bridges the held-blank fact into the walkthrough overlay. A separate leaf so
 * the GradingContext read re-renders this and WalkthroughCoach, never FeedBody
 * — the same isolation discipline as AnswerLayer in RecallHost.
 */
function CoachLayer({
  coach,
  hint,
  hintText,
  hintEmphatic,
  top,
}: {
  coach: CoachCardContent | null;
  hint: boolean;
  hintText: string;
  hintEmphatic: boolean;
  top: number | null;
}) {
  const held = useHeldBlank();
  return (
    <WalkthroughCoach
      coach={coach}
      hint={hint}
      hintText={hintText}
      hintEmphatic={hintEmphatic}
      held={held}
      top={top}
    />
  );
}

const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: VISIBLE_PERCENT } as const;

/**
 * How long to wait for momentum before deciding the swipe is over.
 *
 * A lift with no velocity — a short drag released while the list is already on
 * a page boundary — produces NO momentum callbacks at all, so there would be
 * nothing left to clear `dragging` and the player would stay hidden for good.
 * This is the escape hatch for exactly that case, and nothing else: any real
 * fling fires onMomentumScrollBegin within a frame or two and cancels it.
 *
 * 150ms is chosen to be comfortably longer than that couple of frames and
 * still short enough that the poster does not visibly linger when it fires.
 */
const NO_MOMENTUM_MS = 150;

/**
 * IS A SWIPE IN FLIGHT? The player is hidden for as long as the answer is yes.
 *
 * WHY THIS IS NOT JUST setDragging ON TWO CALLBACKS. The player layer is
 * absolutely positioned over a MEASURED box and does not scroll with the list
 * (PlayerHost: one WebView, never re-parented). So anything visible while the
 * list is moving is parked at a fixed screen position while its own slide
 * travels out from under it. Hiding it and letting each slide's poster carry
 * the frame is the whole transition design.
 *
 * The bug that made swipes look janky was in when that hiding STOPPED.
 * `onScrollEndDrag` fires when the finger lifts — but with pagingEnabled the
 * list then runs a snap animation, and clearing there brought the player back
 * DURING it: the outgoing video faded in at its fixed box, over a half-scrolled
 * pair of slides, and stayed until viewability crossed 60% and the new video
 * finished booting. That is the "it stays there" — a stale frame, pinned, over
 * moving content.
 *
 * So the finger lifting no longer ends the swipe; the list coming to rest
 * does. onMomentumScrollBegin also RAISES the flag rather than only clearing
 * it, so a fling chained onto a settling list cannot leave it down.
 */
function useSwipeLifecycle(setDragging: (dragging: boolean) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelFallback = useCallback(() => {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // The timer outlives a tab switch otherwise, and would clear `dragging` for
  // a feed that has since been swiped again.
  useEffect(() => cancelFallback, [cancelFallback]);

  return useMemo(
    () => ({
      onBeginDrag: () => {
        cancelFallback();
        setDragging(true);
      },
      /** Finger up. NOT the end of the swipe — only the end of the drag. */
      onEndDrag: () => {
        cancelFallback();
        timer.current = setTimeout(() => {
          timer.current = null;
          setDragging(false);
        }, NO_MOMENTUM_MS);
      },
      /** Momentum took over, so the fallback above was wrong. Stay hidden. */
      onMomentumBegin: () => {
        cancelFallback();
        setDragging(true);
      },
      /** The list is at rest. This is the end of the swipe. */
      onSettled: () => {
        cancelFallback();
        setDragging(false);
      },
    }),
    [cancelFallback, setDragging]
  );
}

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
 *
 * A LANDING ALSO SAYS *WHEN*. "Review this word" used to drop the user at the
 * top of a video and leave them to sit through it — the word they asked for
 * arriving a minute later, behind everybody else's. The lead-in belongs to the
 * LOAD rather than to a seek after it: loadVideoById takes a start time, so
 * the video opens on the word instead of playing its first seconds and then
 * jumping. Applied ONCE per landing (appliedRef): returning to this slide
 * later is an ordinary watch, and should start where an ordinary watch starts.
 */
function PlayerDriver({
  video,
  landing,
  startSeconds,
}: {
  video: EmbedVideo | null;
  landing: ReviewTarget | null;
  /** Open the clip here instead of at 0. Null in the real feed. */
  startSeconds?: number | null;
}) {
  const api = usePlayerApi();
  const status = usePlayerStatus();
  const appliedRef = useRef<ReviewTarget | null>(null);

  useEffect(() => {
    if (!video || !status.ready) return;
    const opening =
      landing && landing.videoId === video.id && appliedRef.current !== landing
        ? landing
        : null;
    if (opening) appliedRef.current = opening;
    // A review target wins: it is a specific word the user asked to see, while
    // the walkthrough's offset is only a nicety about pacing.
    const from = opening
      ? Math.max(0, opening.startsAt - REVIEW_LEAD_IN_S)
      : startSeconds != null && startSeconds > 0
        ? startSeconds
        : undefined;
    api.loadAndPlay(video.youtubeId, from);
  }, [video, status.ready, api, landing, startSeconds]);

  return null;
}

/**
 * MEMOISED, AND EVERY PROP IT TAKES IS STABLE SO THAT MEANS SOMETHING.
 *
 * FlashList rebuilds its renderItem closure on every render of the list's
 * owner, so a tab switch re-rendered every mounted cell — each one a poster,
 * an attribution line, a band and a full karaoke track. Only `isActive` truly
 * changes on a switch, and only for one cell; with the callbacks hoisted
 * (handleWordTap, onAreaLayout) and `box` memoised, that is now the only cell
 * React touches.
 */
const Slide = memo(function Slide({
  video,
  height,
  isActive,
  box,
  language,
  spotlight,
  onWordTap,
  onAreaLayout,
}: {
  video: EmbedVideo;
  height: number;
  isActive: boolean;
  box: Omit<PlayerBox, 'visible'> | null;
  language: string;
  /** The walkthrough's ring, or null in the real feed. See Karaoke.spotlight. */
  spotlight?: { cueIndex: number; surface: string } | null;
  /** Takes the video so the feed can hold ONE handler for every slide. */
  onWordTap: (video: EmbedVideo, word: Word, cueIndex: number) => void;
  onAreaLayout?: (event: LayoutChangeEvent) => void;
}) {
  const insets = useSafeAreaInsets();
  /** Zero when there is no tab bar below the slide — see the band's padding. */
  const tabBarHeight = useTabBarHeight();
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
    if (!isActive) return;
    storage.markWatched(video.id);
    /**
     * The same moment, reported outward.
     *
     * DELIBERATELY THE SAME DEFINITION OF "WATCHED" AS markWatched — the slide
     * took the screen on the visible tab — rather than a stricter one based on
     * playback progress. Two reasons: the app already tells the user "videos
     * watched" on Progress using exactly this rule, so a dashboard using a
     * different one would disagree with the app in front of the person reading
     * it; and the embed player's progress is not reliable enough to key a
     * metric on. Read the number as "reached", not "finished".
     *
     * trackOnce, not track: this effect re-runs on every activation, and a
     * user swiping back to a video has not watched a second video.
     */
    trackOnce(`video:${video.id}`, 'video_watched', { videoId: video.id });
  }, [isActive, video.id]);

  /** Stable for as long as this cell shows this video — see Karaoke's memo. */
  const tapWord = useCallback(
    (word: Word, cueIndex: number) => onWordTap(video, word, cueIndex),
    [onWordTap, video]
  );

  return (
    <View style={[styles.slide, { height }]}>
      {/* THE NOTCH, AND NOTHING ELSE. This used to reserve a further 52pt for
          a row of player diagnostics that no longer exists; the player area
          below is flex:1, so removing that reservation hands every one of
          those points to the video rather than leaving a gap. The safe-area
          inset stays: it is what keeps the frame out from under the status
          bar and the notch. */}
      <View style={{ height: insets.top }} />

      {/* THE PLAYER AREA. Holds no player — the persistent WebView positions
          itself over this box. flex:1 means the band below takes what it needs
          and this takes the remainder, so it is structurally impossible for
          Loro UI to overlap the player. That is the embed-terms constraint. */}
      <View style={styles.playerArea} onLayout={onAreaLayout}>
        {box && (
          <View
            style={[
              styles.playerBox,
              // box.top is window-space; this subtracts the spacer above to
              // land in playerArea-local coordinates. It MUST match the
              // spacer's height exactly or the poster and the tap surface
              // drift away from the WebView.
              { left: box.left, top: box.top - insets.top, width: box.width, height: box.height },
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
          over it. Its height is whatever its content needs.

          THE HOME-INDICATOR INSET IS PAID BY WHOEVER TOUCHES THE SCREEN EDGE,
          AND THAT IS NO LONGER THIS. The band used to be the last thing above
          the window's bottom, so it owed insets.bottom. The tab bar (checkpoint
          G) now sits between them and already carries that inset
          (Shell.tsx: paddingBottom insets.bottom + 6), so paying it here counts
          it TWICE — ~34pt of dead space under the karaoke line on a notched
          phone, and 34pt taken off the player area, which is flex:1 and
          absorbs whatever the band leaves.

          This is the same rule RecallBar.tsx:89-95 already applies to the
          answer bar, for the same reason and against the same measurement;
          the band was simply missed when the tab bar landed. Measured, not
          assumed — see tabBar.tsx. The fallback keeps the old behaviour for
          any host without a tab bar (onboarding renders the shell-less tree),
          so the band still clears the home indicator when it IS the last thing
          on screen. */}
      <View
        style={[
          styles.band,
          { paddingBottom: tabBarHeight > 0 ? 8 : insets.bottom + 8 },
        ]}
      >
        {/* THE SEAM ROW: the seek bar, first thing under the video. Rendered on
            every slide so the band's height never differs between cells, but
            only the active slide's is live — an inactive cell's bar is a
            resting line at zero. It reads the same clock as Karaoke and stands
            down while a blank holds the video; see SeekBar's header. */}
        <SeekBar cues={video.cues} active={isActive && ownsMedia} />
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
            {isActive && <ReplayCueButton cues={video.cues} />}
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
          spotlight={spotlight}
          onWordTap={tapWord}
        />
      </View>
    </View>
  );
});

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
 * F3 — replay the current line. IT LIVES IN THE BAND, next to the speed
 * control, never over the player — the same embed-terms rule as its
 * neighbours.
 *
 * Two modes, one button:
 *
 *   blank held    defers to the session's replay — the SAME action the button
 *                 in the answer bar performs, so the hold's own guards (reseat
 *                 reset, slip-debounce stamp) run. Going around them with a
 *                 raw seek here would race the hold's re-assert pause and
 *                 kill the replay dead — measured behaviour, not caution.
 *   playing       reads the bridge clock once (a per-tap JS-thread read of
 *                 the shared values, not a per-frame subscription), finds the
 *                 line the playhead is in — or the one that just finished —
 *                 and seeks to its start, padded because embed seeks land
 *                 within ±0.5s.
 *
 * Before the first cue there is nothing behind the playhead to replay; the
 * button still seeks to 0, which restarts the intro — the least surprising
 * reading of "hear that again".
 */
function ReplayCueButton({ cues }: { cues: Video['cues'] }) {
  const api = usePlayerApi();
  const { anchorTime, anchorAt, isPlaying, rate } = usePlayerClock();
  const { replay, held } = useRecallReplay();

  const onPress = useCallback(() => {
    if (held) {
      replay();
      return;
    }
    const t = isPlaying.value
      ? anchorTime.value + ((Date.now() - anchorAt.value) / 1000) * rate.value
      : anchorTime.value;
    const start = currentCueStart(cues, t) ?? 0;
    api.seek(Math.max(0, start - SEEK_BACK_PAD_S));
    api.play();
  }, [held, replay, cues, api, anchorTime, anchorAt, isPlaying, rate]);

  if (cues.length === 0) return null;

  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Replay this line"
      accessibilityHint="Plays the current sentence again"
      style={({ pressed }) => [styles.replayCue, pressed && styles.soundPressed]}
    >
      <Text style={styles.replayCueText}>↺</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0d0b' },
  emptyRoot: {
    alignItems: 'center',
    backgroundColor: '#0a0d0b',
    flex: 1,
    gap: 14,
    justifyContent: 'center',
    paddingHorizontal: 44,
  },
  emptyTitle: { color: '#f2f5f3', fontSize: 15, fontWeight: '700' },
  emptyBody: {
    color: 'rgba(242,245,243,0.6)',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  emptyCta: {
    borderColor: 'rgba(242,245,243,0.25)',
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 4,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  emptyCtaPressed: { opacity: 0.7 },
  emptyCtaText: { color: '#f2f5f3', fontSize: 13, fontWeight: '700' },
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
  /** Quiet, like soundToggle — replay is a convenience, not a call to action. */
  replayCue: {
    alignItems: 'center',
    backgroundColor: 'rgba(242,245,243,0.10)',
    borderRadius: 999,
    justifyContent: 'center',
    minWidth: 34,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  replayCueText: { color: 'rgba(242,245,243,0.75)', fontSize: 14, fontWeight: '700' },
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
});
