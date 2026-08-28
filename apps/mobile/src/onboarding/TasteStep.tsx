import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Video } from '@loro/core/types';
import { getCatalog, onCatalogChanged } from '@loro/core/catalog';
import {
  FeedScreen,
  type FeedControls,
  type FeedWalkthrough,
} from '../feed/FeedScreen';
import { TabBarHeightContext } from '../shell/tabBar';
import {
  usePlayerApi,
  usePlayerBox,
  usePlayerClock,
  usePlayerStatus,
} from '../player/PlayerHost';
import { refreshCatalog } from '../platform/catalog';
import { track } from '../platform/analytics';
import { ACCENT, CARD, GROUND, MUTED, ON_ACCENT, PrimaryButton, TEXT } from './chrome';
import { BRAND } from './brand';
import { TASTE } from './copy';
import { olog } from './flow';
import { resolveTasteReel, WALKTHROUGH } from './taste';
import { isScriptedWord, makeDueNow } from './walkthrough';
/**
 * TYPE-ONLY, so this is not a cycle. steps.tsx imports this component as a
 * value; the transform erases the line below entirely, so nothing imports
 * steps.tsx at runtime.
 */
import type { StepProps } from './steps';

/**
 * THE TASTE REEL — a guided first run through three real clips, immediately
 * before the paywall.
 *
 * WHY IT IS THE REAL FEED AND NOT A MOCK. A demonstration that is not the
 * product demonstrates nothing: the thing being sold is the karaoke line
 * tracking real speech and a word turning into a blank you fill in, and a
 * purpose-built imitation of that would drift from the real screen within a
 * release. So this mounts FeedScreen itself, with a fixed three-video reel and
 * a script (see taste.ts) that reaches into it through one optional prop.
 *
 * ------------------------------------------------------------------ the beats
 *
 *   1. Clip one plays. At WALKTHROUGH.tap.holdAt the video is PAUSED, one word
 *      in the karaoke line grows a breathing ring, and a card asks for a tap.
 *   2. The tap saves that word due immediately (walkthrough.ts) and the card
 *      says what that means: it comes back as a blank.
 *   3. The clip resumes, and a hint says to swipe.
 *   4. Clip two plays and the saved word arrives as a real green blank about
 *      seven seconds in, because the feed asked core for it by name.
 *   5. Another hint, another swipe.
 *   6. Clip three is uncoached. By then the loop has been done once and the
 *      only thing left to show is that the feed keeps going.
 *   7. Pulling past the last clip raises the closing card, which hands over to
 *      the wall.
 *
 * ------------------------------------------------------ NOTHING HERE MAY TRAP
 *
 * This screen is the last thing before a paywall, so a dead end here is a lost
 * sale rather than a bug report. Every beat is best-effort and every one of
 * them can be walked away from: the Continue bar is live from the first frame
 * to the last, the hold releases itself if the tap never comes, an unscripted
 * tap still opens the normal save sheet, and a clip the catalog does not have
 * removes the whole step from the flow. If the script fails silently the user
 * gets three videos to swipe, which is the version that shipped before it.
 *
 * -------------------------------------------------------- why it mounts LATE
 *
 * The onboarding host mounts every step at once, side by side in one row
 * (Onboarding.tsx). That is free for a static screen and NOT free for this one:
 * PlayerDriver issues loadAndPlay as soon as the player is ready and does not
 * consult `active`, so a FeedScreen mounted at launch would start streaming
 * clip 1 from onboarding screen 1 — invisible, muted, and ninety seconds in by
 * the time anyone arrived. The feed is armed by `isCurrent` instead, which is
 * exactly the contract StepProps.isCurrent documents. The latch is one-way:
 * coming back from a later screen must not rebuild the list.
 *
 * -------------------------------------------------------- why it is FULL BLEED
 *
 * The host hides its chrome for this step (StepDef.fullBleed), and that is a
 * geometry requirement rather than a styling preference. The player box is
 * published in WINDOW space — PlayerHost's WebView is absolutely positioned
 * against the app root — while the slide measures it against ITSELF. The two
 * agree only when the feed starts at the top of the window. With a progress bar
 * above it the WebView would sit roughly ninety points higher than the poster
 * and the tap surface it is supposed to cover, which is precisely the
 * embed-terms failure the measured-box design exists to prevent.
 *
 * EVERY COACH MARK SITS BELOW THE PLAYER, for the same reason the sound
 * control does: nothing Loro draws may cover the frame. They used to sit in a
 * reserved slot above the Continue button, and the reservation came straight
 * out of the video's flex:1 — a quarter of its width, all run long, for cards
 * on screen fifteen seconds of it. They now FLOAT over the band instead,
 * anchored at the feed's measured bandTop (WalkthroughCoach.tsx), which costs
 * the video nothing and still cannot touch the frame. The step only decides
 * WHAT to say; the feed decides where saying it is safe.
 *
 * ------------------------------------------------------------ the bottom bar
 *
 * The Continue bar is published through TabBarHeightContext, which is what that
 * context is for — the band pays 8pt of bottom padding when something below it
 * is already paying the home-indicator inset, and insets.bottom when it is the
 * last thing on screen. Handing it this bar's measured height puts the reel in
 * exactly the arrangement Shell produces, so the band does not pay the inset
 * twice and the coach cards do not sit on top of the karaoke line.
 */

/** How long the "Saved" card stays up before the clip resumes. */
const SAVED_CARD_MS = 2600;
/**
 * When the blank's card appears on clip two, and how long it would stay.
 *
 * Early on purpose: the clip opens ~2s before the blank (fill.startAt), so the
 * card is an announcement of what is about to happen, not a caption on it. It
 * rarely lives out FILL_CARD_MS — the overlay yields the moment the blank
 * holds the video (WalkthroughCoach), which is the beat the card exists to set
 * up. The long tail only matters if the blank was never planned.
 */
const FILL_CARD_AT_MS = 600;
const FILL_CARD_MS = 6000;
/** How long after arriving on a clip the swipe hint appears, when nothing else
    has raised it. Long enough that it never rushes the video. */
const SCROLL_HINT_AFTER_MS = 9000;
/**
 * How much of the LAST clip must PLAY before the closing card comes up by
 * itself. Playback, not wall clock, and the difference is the whole point.
 *
 * The last clip carries one blue level blank, and a blank STOPS THE VIDEO while
 * the user types. A wall-clock timer would keep counting through that and raise
 * the card over a half-answered gap — or, worse, fire before the blank appeared
 * and mean they never saw it at all. Counting only while the player is playing
 * makes the card arrive a fixed beat after whatever the clip had to show,
 * however long the user took over it.
 *
 * The value lives in the script beside the blank it has to outlast, because the
 * two numbers are one decision and a guard test checks them against each other.
 */
const OUTRO_AFTER_PLAYED_MS = WALKTHROUGH.last.outroAfterPlayedMs;
/** How often the outro's playback accumulator ticks. Coarse like the hold's. */
const OUTRO_TICK_MS = 200;

/**
 * How long a NON-FINAL hold waits before letting the clip play on to the next
 * occurrence of the word. Long enough to read the card and reach for the line,
 * short enough that a user who is just watching does not feel stuck.
 */
const HOLD_RETRY_MS = 5000;
/**
 * The last hold's escape hatch. If the coached tap never comes, the clip
 * resumes by itself rather than sitting frozen behind a card the user has
 * decided to ignore — a paused video with an instruction on it is the most
 * trapping thing this screen could do.
 */
const HOLD_RELEASE_MS = 14_000;
/** How often the hold checks the clock. Coarse on purpose: this is one
    scripted pause, not a subtitle track, and it runs on the JS thread. */
const HOLD_TICK_MS = 120;


type Card = null | 'tap' | 'saved' | 'fill';

export function TasteStep({ next, finish, isCurrent, isLast }: StepProps) {
  const insets = useSafeAreaInsets();
  const api = usePlayerApi();
  const clock = usePlayerClock();
  const status = usePlayerStatus();

  /**
   * LEAVING THE FLOW MUST TAKE THE PLAYER WITH IT, and nothing else does.
   *
   * Two things outlive this component, because the whole point of PlayerHost is
   * that they do: the WebView keeps playing whatever it last loaded, and the
   * player BOX keeps whatever geometry was last published to it. Neither is
   * reset by unmounting — FeedScreen's pause-on-blur effect has no cleanup, and
   * the box is a context value, not a subscription.
   *
   * So without this, finishing onboarding hands over to PaywallScreen with clip
   * three still audible and the video still drawn on top of the price list. The
   * user has just asked to see what it costs; a stray video over the paywall is
   * the last thing that should happen next.
   */
  const setPlayerBox = usePlayerBox();
  useEffect(
    () => () => {
      api.pause();
      setPlayerBox({ top: 0, left: 0, width: 0, height: 0, visible: false });
    },
    [api, setPlayerBox]
  );

  // ------------------------------------------------------------- the reel

  /**
   * The reel, resolved against the catalog this device actually holds.
   *
   * Re-resolved on a catalog change ONLY until the feed is armed. A first
   * launch reaches this screen with the snapshot possibly still downloading, so
   * the arrival matters; once the feed is mounted the list is frozen, because
   * FeedScreen reads a reel once and a change under a swiping user would be a
   * bug rather than a refresh.
   */
  const [reel, setReel] = useState<Video[]>(() => resolveTasteReel(getCatalog()));
  const [armed, setArmed] = useState(false);
  const frozen = useRef(false);

  useEffect(
    () =>
      onCatalogChanged(() => {
        if (frozen.current) return;
        setReel(resolveTasteReel(getCatalog()));
      }),
    []
  );

  useEffect(() => {
    if (!isCurrent || reel.length === 0) return;
    frozen.current = true;
    setArmed(true);
  }, [isCurrent, reel.length]);

  const waiting = reel.length === 0;
  useEffect(() => {
    if (!waiting || !isCurrent) return;
    const id = setInterval(() => void refreshCatalog(), 10_000);
    return () => clearInterval(id);
  }, [waiting, isCurrent]);

  // ------------------------------------------------------------ the script

  /**
   * The feed's own scroll control, handed over by FeedScreen while its list is
   * mounted. Null before the list exists and after it goes, so the button
   * cannot drive a list that is not there.
   */
  const controls = useRef<FeedControls | null>(null);
  const registerControls = useCallback((next: FeedControls | null) => {
    controls.current = next;
  }, []);

  const [slide, setSlide] = useState(0);
  const [card, setCard] = useState<Card>(null);
  const [hintVisible, setHintVisible] = useState(false);
  const [outroOpen, setOutroOpen] = useState(false);
  /** The word actually saved, which is what clip two is asked for. Null until
      the tap happens, and NOT necessarily WALKTHROUGH.word — see onWordTap. */
  const [savedWord, setSavedWord] = useState<string | null>(null);
  const [held, setHeld] = useState(false);
  const heldRef = useRef(false);
  /**
   * Which of the word's occurrences we are currently aiming at.
   *
   * The word is said three times in clip one. Aiming at the FIRST is better —
   * it arrives while the user is still watching rather than deciding — but it
   * is also the easiest to miss, so a hold that goes untapped releases, lets
   * the clip play on, and takes the next one. Only the last gives up.
   */
  const [holdIndex, setHoldIndex] = useState(0);

  const tapClip = WALKTHROUGH.tap.clip;
  const onTapClip = slide === tapClip;
  const tapPending = onTapClip && savedWord === null;

  /**
   * THE HOLD. Watch the media clock and stop the clip on the coached word.
   *
   * A JS interval rather than a frame callback, deliberately: this fires once
   * per install, on one clip, and a worklet would buy precision nobody can
   * perceive at the cost of a second copy of the clock arithmetic. The
   * extrapolation is the same one Karaoke runs on the UI thread — anchor plus
   * elapsed wall time scaled by the confirmed rate.
   *
   * Guarded on the LOADED VIDEO, not just the slide index: during a swap the
   * player still holds the outgoing clip, and pausing on its clock would stop
   * the wrong video at a meaningless second.
   *
   * Re-armed for each hold in turn. Releasing a non-final hold does NOT clear
   * the card — the instruction is still true, the clip is simply carrying the
   * user to the next chance at it.
   */
  useEffect(() => {
    if (!isCurrent || !armed || !tapPending) return;
    const clip = reel[tapClip];
    if (!clip?.youtubeId) return;
    const target = WALKTHROUGH.tap.holds[holdIndex];
    if (!target) return;
    const isFinal = holdIndex === WALKTHROUGH.tap.holds.length - 1;

    let stopped = false;
    let release: ReturnType<typeof setTimeout> | null = null;

    const id = setInterval(() => {
      if (stopped || heldRef.current) return;
      if (status.loadedVideoId !== clip.youtubeId) return;
      const t = clock.isPlaying.value
        ? clock.anchorTime.value +
          ((Date.now() - clock.anchorAt.value) / 1000) * clock.rate.value
        : clock.anchorTime.value;
      if (t < target.holdAt) return;

      heldRef.current = true;
      setHeld(true);
      setCard('tap');
      api.pause();
      olog(
        `walkthrough: held at ${t.toFixed(2)}s on cue ${target.cueIndex} ` +
          `for "${WALKTHROUGH.word}" (hold ${holdIndex + 1}/${WALKTHROUGH.tap.holds.length})`
      );

      release = setTimeout(
        () => {
          if (!heldRef.current) return;
          heldRef.current = false;
          setHeld(false);
          api.play();
          if (isFinal) {
            setCard(null);
            olog('walkthrough: last hold released, no tap');
          } else {
            setHoldIndex((n) => n + 1);
            olog('walkthrough: hold released, waiting for the next "como"');
          }
        },
        isFinal ? HOLD_RELEASE_MS : HOLD_RETRY_MS
      );
    }, HOLD_TICK_MS);

    return () => {
      stopped = true;
      clearInterval(id);
      if (release) clearTimeout(release);
    };
  }, [
    isCurrent,
    armed,
    tapPending,
    holdIndex,
    reel,
    tapClip,
    api,
    clock,
    status.loadedVideoId,
  ]);

  /**
   * The save landed — through the REAL sheet, with its gloss and its Save
   * button and its confirmation toast. The script does not intercept the tap;
   * it only reacts once the app has done the work.
   *
   * ANY word counts, not only the ringed one. The ring is an invitation rather
   * than a gate, and a user who saved a different word did exactly what the
   * card asked — refusing them would be the app telling someone they pressed
   * the wrong part of their own screen. Whatever they saved becomes the word
   * clip two is asked for; if that clip never says it, no blank appears and the
   * run degrades quietly, which is what WALKTHROUGH.required = false means.
   *
   * The one thing done to it is the due date: a normal save is reviewable in a
   * minute, which is a minute after the user has scrolled. See makeDueNow.
   */
  const onWordSaved = useCallback<NonNullable<FeedWalkthrough['onWordSaved']>>(
    (video, word) => {
      if (!tapPending) return;
      const text = word.text;
      const due = makeDueNow(text, video.id);
      track('taste_word_saved', {
        word: text,
        scripted: isScriptedWord(text),
        due,
      });
      setSavedWord(text);
      setHeld(false);
      heldRef.current = false;
      setCard('saved');
    },
    [tapPending]
  );

  /** The saved card holds the clip a moment longer, then plays on. */
  useEffect(() => {
    if (card !== 'saved') return;
    const id = setTimeout(() => {
      setCard(null);
      setHintVisible(true);
      api.play();
    }, SAVED_CARD_MS);
    return () => clearTimeout(id);
  }, [card, api]);

  /** Clip two: name the blank as it arrives, then get out of the way. */
  useEffect(() => {
    if (!isCurrent || slide !== WALKTHROUGH.fill.clip || !savedWord) return;
    const show = setTimeout(() => setCard('fill'), FILL_CARD_AT_MS);
    const hide = setTimeout(
      () => setCard((c) => (c === 'fill' ? null : c)),
      FILL_CARD_AT_MS + FILL_CARD_MS
    );
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [isCurrent, slide, savedWord]);

  /** The swipe hint, on every clip but the last. */
  useEffect(() => {
    setHintVisible(false);
    if (!isCurrent || !armed || slide >= reel.length - 1) return;
    const id = setTimeout(() => setHintVisible(true), SCROLL_HINT_AFTER_MS);
    return () => clearTimeout(id);
  }, [isCurrent, armed, slide, reel.length]);

  const onSlideChange = useCallback((index: number) => {
    setSlide(index);
    setCard(null);
  }, []);

  const openOutro = useCallback(() => {
    setOutroOpen((open) => {
      if (!open) {
        track('taste_outro');
        olog('walkthrough: reached the outro');
      }
      return true;
    });
  }, []);

  const onPastEnd = openOutro;

  /**
   * THE LAST CLIP RAISES THE CARD ITSELF, once it has actually played.
   *
   * Everything before this point has had something to do next — a word to tap,
   * a blank to fill, a swipe to make. The last clip has nothing after its blue
   * blank, so leaving it to run would be the one moment in the flow where the
   * app stops leading and the user has to guess.
   *
   * The accumulator only advances while the player reports playing, so the blue
   * blank's hold suspends it rather than racing it. Pulling past the clip or
   * pressing Continue raise the same card sooner.
   */
  useEffect(() => {
    if (!isCurrent || !armed || outroOpen) return;
    if (reel.length === 0 || slide !== reel.length - 1) return;
    let played = 0;
    const id = setInterval(() => {
      if (!clock.isPlaying.value) return;
      played += OUTRO_TICK_MS;
      if (played >= OUTRO_AFTER_PLAYED_MS) {
        clearInterval(id);
        openOutro();
      }
    }, OUTRO_TICK_MS);
    return () => clearInterval(id);
  }, [isCurrent, armed, slide, reel.length, outroOpen, clock, openOutro]);



  /** The video goes quiet behind the closing card. */
  useEffect(() => {
    if (outroOpen) api.pause();
  }, [outroOpen, api]);

  const walkthrough: FeedWalkthrough = {
    spotlight: tapPending
      ? {
          cueIndex:
            WALKTHROUGH.tap.holds[holdIndex]?.cueIndex ??
            WALKTHROUGH.tap.holds[0].cueIndex,
          surface: WALKTHROUGH.word,
        }
      : null,
    focusWord: slide === WALKTHROUGH.fill.clip ? savedWord : null,
    /**
     * Only on the clip whose blank was promised, and only when there is a word
     * to promise. Opening a clip part-way in is a pacing fix for that one beat,
     * not a house style: every other clip starts where its creator meant it to.
     */
    startSeconds:
      slide === WALKTHROUGH.fill.clip && savedWord
        ? WALKTHROUGH.fill.startAt
        : null,
    /**
     * ONE BLUE BLANK, ON THE LAST CLIP ONLY.
     *
     * The coached clips keep them off: a blue gap is indistinguishable from the
     * scripted one to someone seeing either for the first time, and core can
     * place it anywhere, including ahead of the beat the script is building to.
     * By the last clip the guided part is done, and a single blue gap is how
     * the user finds out the level ladder exists — which is a different promise
     * from the saved-word loop they have just been walked through, and the one
     * thing about the product this reel would otherwise never mention.
     */
    /**
     * WHAT the card says; the feed decides WHERE (WalkthroughCoach). The bar
     * below holds only the button now, so the bar's height never changes and
     * the player is measured exactly once for the whole reel — the fix for the
     * video redrawing over itself on a slide change, kept by never giving the
     * bar anything that comes and goes.
     */
    coach: card ? { kind: card, ...TASTE[card] } : null,
    hint: hintVisible && !card,
    hintText: TASTE.scrollHint,
    levelBlanks: reel.length > 0 && slide === reel.length - 1,
    maxLevelBlanks: 1,
    /**
     * And not in the opening seconds of it. Core's floor is the first two
     * cues, which on a fast-talking clip is over in four — see
     * WALKTHROUGH.last.blankAfterS. This clip is the one the user is meant to
     * simply watch, so it has to run before it asks.
     */
    minLevelBlankAtS: WALKTHROUGH.last.blankAfterS,
    onWordSaved,
    onSlideChange,
    onPastEnd,
    registerControls,
  };

  // ------------------------------------------------------------- reporting

  const reported = useRef(false);
  useEffect(() => {
    if (!isCurrent || reported.current) return;
    reported.current = true;
    track('taste_shown', { clips: reel.length });
    olog(`taste: ${reel.length} clip(s) — ${reel.map((v) => v.id).join(', ')}`);
  }, [isCurrent, reel]);

  // ------------------------------------------------------------------- ui

  const [barHeight, setBarHeight] = useState(0);

  /**
   * CONTINUE MOVES THE REEL, IT DOES NOT LEAVE IT.
   *
   * It used to end onboarding outright, which on an entitled device dropped the
   * user straight into the real feed — a route out of the guided run and into
   * the whole app, from a button that looked like "next". That could never be
   * right: this screen exists to be the last thing before the wall, so nothing
   * on it may hand over to anything else.
   *
   * On the last clip it raises the closing card instead, which is the same
   * place pulling past the end arrives at. There is exactly one way out of this
   * screen now, and it is Empezar.
   */
  const advance = useCallback(() => {
    if (reel.length > 0 && slide < reel.length - 1) {
      controls.current?.scrollToIndex(slide + 1);
      return;
    }
    openOutro();
  }, [reel.length, slide, openOutro]);

  /** The one exit, from the closing card. */
  const exit = useCallback(() => {
    // Stop the sound on the TAP, not on the unmount a frame or two later.
    api.pause();
    if (isLast) finish();
    else next();
  }, [api, isLast, finish, next]);

  return (
    <View style={styles.root}>
      <TabBarHeightContext.Provider value={barHeight}>
        <View style={styles.feed}>
          {armed ? (
            /**
             * `active` goes false the moment the closing card comes up. That is
             * the feed's own blur contract doing three jobs at once: it pauses
             * the clip, it hides the player layer, and it stops the plan — so
             * nothing is playing, drawn, or scheduled behind a card whose only
             * remaining job is to hand over to a price.
             */
            <FeedScreen
              active={isCurrent && !outroOpen}
              reel={reel}
              walkthrough={walkthrough}
            />
          ) : (
            <View style={[styles.waiting, { paddingTop: insets.top + 40 }]}>
              {waiting && <ActivityIndicator color={MUTED} />}
              <Text style={styles.waitingText}>{waiting ? TASTE.waiting : ''}</Text>
            </View>
          )}
        </View>
      </TabBarHeightContext.Provider>

      <View
        style={[styles.bar, { paddingBottom: insets.bottom + 12 }]}
        onLayout={(event) => {
          const { height } = event.nativeEvent.layout;
          // Zero is not a measurement — the step is off stage and out of
          // layout. Keeping the last real value stops the band reflowing every
          // time the row slides.
          if (height > 0) setBarHeight(height);
        }}
      >
        {/* Just the button. Anything else in this bar changes its height,
            resizes the player mid-clip, and repaints the WebView — the coach
            marks float over the band instead (see the walkthrough's coach). */}
        <PrimaryButton label={TASTE.cta} onPress={advance} />
      </View>

      <Modal
        visible={outroOpen}
        transparent
        animationType="fade"
        onRequestClose={exit}
      >
        <View style={styles.outroScrim}>
          <View style={styles.outroCard}>
            {/* The mascot's last appearance, and the only art on this card.
                Small and off to the side rather than centred over the title:
                this is the screen that hands over to a price, so the parrot is
                here to sign off, not to perform. */}
            <Image
              source={BRAND.parrotWaving}
              style={styles.outroParrot}
              resizeMode="contain"
              accessibilityRole="image"
              accessibilityLabel="Loro the parrot, waving"
            />
            <Text style={styles.outroTitle}>{TASTE.outro.title}</Text>
            <Text style={styles.outroBody}>{TASTE.outro.body}</Text>
            <Pressable
              onPress={exit}
              accessibilityRole="button"
              accessibilityLabel={`${TASTE.outro.cta}, ${TASTE.outro.ctaGloss}`}
              style={({ pressed }) => [styles.outroCta, pressed && styles.pressed]}
            >
              <Text style={styles.outroCtaText}>{TASTE.outro.cta}</Text>
            </Pressable>
            {/* The gloss sits under the button the way it sits under a
                subtitle, because it is doing the same job: the button is the
                fourth Spanish word this flow teaches by using it, and a word
                taught without its meaning is just decoration. */}
            <Text style={styles.outroCtaGloss}>{TASTE.outro.ctaGloss}</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: GROUND, flex: 1 },
  /** flex:1 so the bar below takes what it needs and the feed takes the rest —
      the same arrangement Shell produces with its tab bar. */
  feed: { flex: 1 },
  waiting: { alignItems: 'center', flex: 1, gap: 14, paddingHorizontal: 32 },
  waitingText: { color: MUTED, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  bar: { paddingHorizontal: 24, paddingTop: 12 },

  /**
   * CENTRED, not a bottom sheet. This is the only modal in the flow that is not
   * a drawer on something — there is nothing behind it worth keeping in view,
   * and the last beat before a price should read as a statement rather than as
   * a tray sliding up over a video.
   */
  outroScrim: {
    backgroundColor: 'rgba(4,7,5,0.86)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  outroCard: {
    backgroundColor: CARD,
    borderColor: 'rgba(94,230,168,0.18)',
    borderRadius: 22,
    borderWidth: 1,
    gap: 10,
    padding: 24,
  },
  outroParrot: { height: 84, marginBottom: 2, width: 56 },
  outroTitle: { color: TEXT, fontSize: 22, fontWeight: '800' },
  outroBody: { color: 'rgba(242,245,243,0.75)', fontSize: 15, lineHeight: 22 },
  outroCta: {
    alignItems: 'center',
    backgroundColor: ACCENT,
    borderRadius: 16,
    justifyContent: 'center',
    marginTop: 8,
    minHeight: 52,
  },
  outroCtaText: { color: ON_ACCENT, fontSize: 17, fontWeight: '800' },
  outroCtaGloss: {
    color: MUTED,
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
  pressed: { opacity: 0.7 },
});
