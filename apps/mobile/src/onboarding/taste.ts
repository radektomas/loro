import type { Video } from '@loro/core/types';

/**
 * THE TASTE REEL — the three clips shown at the end of onboarding, immediately
 * before the paywall.
 *
 * WHY THIS EXISTS. Until this step, nobody had watched a second of Spanish
 * before being asked to subscribe. The whole pitch is "real people talking, at
 * real speed, with real accents", and onboarding only ever DESCRIBED it. This
 * is the screen where the claim is demonstrated instead of asserted, and it
 * sits last because the purchase decision is made immediately after it.
 *
 * IT IS STILL A HARD PAYWALL. Three clips inside onboarding is a sample, not a
 * free tier: there is no route from here into the app without an entitlement,
 * and nothing about the gate in App.tsx changes. See loro-mobile-paywall.
 *
 * ------------------------------------------------------------------ the picks
 *
 * CHOSEN BY THE OWNER from the running app, not by the ranking script. Screens
 * were captured on 2026-08-28 and the ids resolved back to the catalog:
 *
 *   1. EnpbExWEwIA  B1  29s  Ally Nunez — "MAQUILLAJE SIN BASE". Talking head,
 *      3/3 frames with a speaker. Close, well-lit, speaking straight to camera.
 *   2. CspuHcf1unU  B1  58s  Romancito — "Por qué nadie habla de este edificio
 *      de Granada". Never went through the vision audit (one of the 99
 *      unjudged); watched by hand instead.
 *   3. 3SXlOWPiXkc  B1  55s  Yaz Winehouse — "Ondas con Shark flexstyle".
 *
 * ⚠️ TWO OF THE THREE WOULD NOT PASS `npm run taste-candidates`, and that is
 * recorded here rather than argued with. Clip 3 is judged `hands-only` with
 * 0/3 frames by the on-camera audit — the same verdict that put other videos in
 * BLOCKED_VIDEOS in the owner review of 2026-08-21 — while the screenshot it
 * was chosen from plainly shows the speaker on camera, so it reads as a false
 * negative in a sample of three frames. Clip 2 was never judged at all. All
 * three are B1, where the ranking script prefers A1/A2.
 *
 * That trade is deliberate and the walkthrough is what pays for it: a guided
 * tap and a guided blank on one easy word ask far less of a beginner than
 * following a B1 clip unaided, so shop-window appeal wins over raw legibility
 * here in a way it would not in the open feed.
 *
 * ------------------------------------------------------------ tuning it later
 *
 * THIS LIST IS COMPILED IN, so changing it costs an App Store release — there
 * is no OTA channel (expo-updates is not a dependency). If the reel becomes
 * something to iterate on, the machinery for a remote one already exists:
 * `fetchPointerAt` takes an arbitrary object path, so a small `taste/latest.json`
 * beside the catalog would carry both the ids and the count. Do NOT try to add
 * the field to `catalog/latest.json` — assertPointer rebuilds the object from
 * exactly hash/count/generatedAt and silently drops anything else.
 */
export const TASTE_REEL: readonly string[] = [
  'EnpbExWEwIA',
  'CspuHcf1unU',
  '3SXlOWPiXkc',
];

/**
 * ============================================================================
 * THE WALKTHROUGH SCRIPT.
 * ============================================================================
 *
 * The reel is not three clips to swipe. It is a guided first run: watch, be
 * shown a word, tap it, be told what that means, scroll, meet the same word as
 * a blank, fill it, scroll, watch, and arrive at the wall having done the whole
 * loop once. Every number below is measured against the cue timings in
 * data/embedVideos.json, not chosen — re-derive them if a clip is swapped.
 *
 * ---------------------------------------------------------- the shared word
 *
 * THE HARDEST CONSTRAINT IN THE WHOLE DESIGN: the word tapped in clip 1 has to
 * be SPOKEN IN CLIP 2, or the promise made between them ("it comes back as a
 * blank") is a lie the very next screen tells.
 *
 * Clip 1 and clip 2 share 20 surfaces and every one of them is a function word:
 * sobre, pero, como, todo, para, que, por, así, eso, muy, no, te, de, la, se,
 * es, el, o, a, y. There is no verb and no noun in the intersection, which is
 * the measured fact behind [[loro-update-1]]'s note that 67% of surfaces occur
 * in exactly one video.
 *
 * `como` wins on timing, which is what decides it:
 *
 *   clip 1  cue 2 [4.6-5.9s], "como" spoken at 5.5s — lands exactly where the
 *           "watch for a few seconds first" beat wants it.
 *   clip 2  cue 2 [7.0-9.5s], "como" is the cue's FIRST word at 7.0s — so the
 *           blank arrives seven seconds after the scroll rather than forty.
 *
 * Both clips gloss it identically ("like"), which matters: the sheet the user
 * saves from and the blank they fill have to agree.
 *
 * IF YOU SWAP A CLIP, RE-DERIVE THIS. `npm run taste-candidates` ranks the
 * pool; the intersection has to be checked by hand. A word with no occurrence
 * in clip 2 silently degrades to "no blank ever appears", because the whole
 * chain below is best-effort by design (see WALKTHROUGH.required).
 *
 * ------------------------------------------------------- why it can come back
 *
 * A word saved seconds ago is NOT normally reviewable. core's blank planner
 * takes only words with `dueAt <= now` (srs.ts computeBlankPlan) and box 0 is a
 * one-minute interval, so a natural save is due sixty seconds later — long
 * after the user has scrolled. Two facts make the scripted version work, and
 * neither is a hack:
 *
 *   1. `computeBlankPlan(video, words, now, { first })` routes through
 *      locateAsked, which deliberately bypasses MIN_AGE_MS ("Due-ness still
 *      applies; MIN_AGE_MS deliberately does not") and places the asked-for
 *      word FIRST. That is the same path a targeted review from the Words tab
 *      already uses.
 *   2. `storage.saveWordAtBox(word, box, staggerMs)` computes
 *      `dueAt = now + BOX_INTERVALS_MS[box] + staggerMs`, and nothing clamps
 *      the stagger. Passing the negative of box 0's interval saves the word due
 *      RIGHT NOW.
 *
 * So the coached tap saves through saveWordAtBox with DUE_NOW_STAGGER_MS, and
 * clip 2 asks for it by name. No core change, no fake blank, no second code
 * path for grading: the blank the user fills is a real green recall blank on a
 * real saved word, and answering it grades the SRS exactly as it would on day
 * three.
 */
export const WALKTHROUGH = {
  /**
   * The word the whole script hangs on. Must be spoken in BOTH the first and
   * the second clip of TASTE_REEL, and be in both their dictionaries.
   */
  word: 'como',

  /**
   * Clip 1: where to stop the video and ask for the tap.
   *
   * SEVERAL HOLDS, NOT ONE, because the word is said three times and missing it
   * used to mean missing the whole beat. The first is the one to aim for — it
   * comes early, while the user is still watching rather than deciding — and
   * each later one is a second chance at the same word if the tap does not
   * come. The clip plays on between them, so a user who is simply watching sees
   * a video that keeps going rather than one that is stuck.
   *
   * Each `holdAt` is just past its occurrence's END, so the word has been HEARD
   * before it is pointed at, and inside its own cue, so the karaoke line does
   * not move on underneath the ring. Measured, not chosen:
   *
   *   cue 1 [2.04-4.62]  "como" 2.76 → 3.00   hold 3.1
   *   cue 2 [4.62-5.94]  "como" 5.46 → 5.58   hold 5.7
   *   cue 3 [5.94-9.00]  "como" 5.94 → 6.48   hold 6.6
   *
   * The guard test checks every one of them against the catalog.
   */
  tap: {
    /** Index into TASTE_REEL. */
    clip: 0,
    holds: [
      { cueIndex: 1, holdAt: 3.1 },
      { cueIndex: 2, holdAt: 5.7 },
      { cueIndex: 3, holdAt: 6.6 },
    ],
  },

  /** Clip 2: the blank is planned by core; this is only what it is asked for. */
  fill: {
    clip: 1,
    /** Where core will place it, recorded so a clip swap fails loudly in dev. */
    expectedCueIndex: 2,
    /**
     * OPEN THIS CLIP PART-WAY IN, a couple of seconds before the word.
     *
     * The blank lands at 7.0s, which is a long time to sit through when you
     * have just been told a specific thing is about to happen — the wait reads
     * as the app having forgotten. Starting at 5s keeps a beat of real speech
     * for context (cue 1 runs to 7.0s) and then the gap arrives.
     *
     * This is the same lever a targeted review from the Words tab already uses:
     * loadVideoById takes a start time, so the clip OPENS here rather than
     * seeking after the fact. It must stay inside the clip and before the word,
     * which the guard test checks.
     */
    startAt: 5,
  },

  /**
   * Clip 3 is uncoached on purpose. By then the user has done the loop once and
   * the only thing left to demonstrate is that the feed keeps going, which a
   * clip they simply watch demonstrates better than another coach mark.
   *
   * It carries ONE blue level blank — the only mention in the whole flow that
   * the level ladder exists — and these two numbers decide when.
   */
  last: {
    /**
     * How much of the last clip must PLAY before the closing card comes up.
     * Playback, not wall clock: the accumulator only advances while the
     * player reports playing, so the blue blank's hold suspends it — the
     * user can sit on the answer as long as they like without the card
     * racing them.
     *
     * THE BLUE BLANK IS BACK, AND EARLY (2026-08-31, second revision of the
     * day; the first cut it entirely for a 4s card). The revised call: the
     * user should TRY a level blank before the wall, not just watch — so the
     * blank now comes as early as core allows (no floor; MIN_CUE_INDEX
     * refusing the first two cues puts it at ~5.6s at level 1 on this clip),
     * and the card follows ~3 seconds of playback AFTER it resolves, right
     * or wrong. 8_600 = that 5.56s pause point + a 3s tail; the guard test
     * in scripts/taste-walkthrough.test.mts pins the pair together.
     *
     * The gloss in the empty slot is what makes an early blank fair: the
     * word's meaning is the prompt, so the ask is visible the moment the
     * video stops. And every degradation still lands somewhere sane — if the
     * planner yields nothing, the clip simply plays 8.6s and the card comes
     * up on its own.
     */
    outroAfterPlayedMs: 8_600,
  },

  /**
   * NOTHING HERE IS REQUIRED FOR THE STEP TO WORK.
   *
   * Every beat is best-effort: a missing clip, a cue that moved, a save that
   * failed or a blank core declined to plan all degrade to "the reel plays and
   * the user swipes it", which is the version that shipped before this script
   * existed. The walkthrough may never block a scroll, never trap a user behind
   * a coach mark, and never leave the Continue button unreachable — this screen
   * is the last thing before a paywall and a dead end here is a lost sale, not
   * a bug report.
   */
  required: false,
} as const;

/**
 * The stagger that makes a freshly saved word due immediately.
 *
 * Negative on purpose, and equal to box 0's interval so the arithmetic in
 * saveWordAtBox lands exactly on `now` rather than near it. Imported by the
 * step rather than inlined so the one place this number is explained is the
 * one place it is defined.
 */
export const DUE_NOW_STAGGER_MS = -60_000;

/** Kept resolvable rather than in a comment, so a swap is a one-line edit. */
export const TASTE_ALTERNATES: readonly string[] = [
  'Cmod120eZyA',
  '2wSYOw4WnZQ',
  'xVWLgzcI_rA',
];

/**
 * The reel, resolved against whatever catalog this device actually holds.
 *
 * ⚠️ IT SUBSTITUTES NOTHING. An earlier version topped the reel up from the
 * alternates and then from any A1/A2 clip in the catalog, so that it always
 * returned three. That was wrong, and wrong in the most damaging way available:
 * a curated reel whose whole point is "these three clips, chosen by hand" would
 * quietly become three arbitrary videos, the walkthrough would ring a word in a
 * clip nobody picked, and the screen would look like the ordinary feed had
 * leaked into onboarding. A missing clip is a fact to surface, not a hole to
 * fill.
 *
 * So this returns the chosen ids that resolved, IN ORDER, and nothing else.
 * Fewer than TASTE_REEL.length is a real answer; zero is a real answer too and
 * removes the step from the flow entirely (steps.tsx).
 *
 * TASTE_ALTERNATES is documentation for a human swapping a clip by hand, and is
 * deliberately not consulted here.
 *
 * The log is not decoration. Every failure mode of this screen is silent by
 * design, so the one line printed on a miss is the only evidence that the reel
 * on screen is not the reel in the file.
 */
export function resolveTasteReel(catalog: Video[]): Video[] {
  const embeds = new Map<string, Video>();
  for (const video of catalog) {
    if (video.youtubeId) embeds.set(video.id, video);
  }

  const picked: Video[] = [];
  const missing: string[] = [];
  for (const id of TASTE_REEL) {
    const video = embeds.get(id);
    if (video) picked.push(video);
    else missing.push(id);
  }

  if (missing.length > 0) {
    reelLog(
      `taste reel: ${picked.length}/${TASTE_REEL.length} resolved, MISSING ` +
        `${missing.join(', ')} (catalog holds ${embeds.size} embeds). ` +
        'Nothing is substituted, so the reel is short. If the catalog is ' +
        'current, the ids in TASTE_REEL are wrong.'
    );
  }

  return picked;
}

/**
 * ONE-WAY: has a reel ever resolved on this launch?
 *
 * The flow's step list is filtered on this rather than on resolveTasteReel
 * directly, and the difference is a crash-shaped bug. A catalog refresh can
 * REMOVE videos (that is exactly what the denylist does), so a predicate that
 * re-answered honestly could take the taste step out of the list while the user
 * was standing on it — the host would find index -1 for the current step, clamp
 * it to 0, and throw them back to screen 1 mid-flow.
 *
 * So availability only ever goes false to true. If the reel does empty out
 * underneath someone, the step is still there and shows its waiting state with
 * a live button, which is a screen rather than a teleport.
 *
 * Launch-scoped by design: a fresh process re-asks.
 */
let reelHasResolved = false;

export function tasteAvailable(catalog: Video[]): boolean {
  if (!reelHasResolved && resolveTasteReel(catalog).length > 0) {
    reelHasResolved = true;
  }
  return reelHasResolved;
}

/**
 * Tagged like the rest of checkpoint H's logs, but declared HERE rather than
 * imported from flow.ts.
 *
 * THIS MODULE HAS NO RUNTIME IMPORTS, and that is load-bearing rather than
 * tidy: scripts/taste-walkthrough.test.mts imports TASTE_REEL and WALKTHROUGH
 * under plain node to check them against the catalog, and flow.ts reaches
 * react-native-mmkv through the storage seam, which node cannot load. One
 * console.log is a cheap price for a script whose numbers are verifiable in CI.
 */
function reelLog(message: string): void {
  console.log(`[loro:H] ${message}`);
}
