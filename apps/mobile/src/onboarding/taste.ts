import type { Video } from '@loro/core/types';

/**
 * THE TASTE REEL — the three clips shown at the end of onboarding, immediately
 * before the paywall.
 *
 * ⚠️ CURRENTLY BENCHED: steps.tsx TASTE_BENCHED keeps this step out of the
 * flow as of 2026-09-01 — the full why lives on that constant. The script
 * below stays maintained (guard tests still run against the catalog) so the
 * step can return, interactive or as recorded footage, without re-deriving
 * every number.
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
 * `que` holds the slot (2026-09-01; it was `como` before). `como` won on
 * timing alone, but Radek watched people MISS its blank: como's only early
 * clip-2 occurrence is its cue's FIRST word, so the line rendered and froze
 * almost in one motion with the gap hard against the left edge. The beat
 * needs the gap to be SEEN inside a sentence — words filling in around a
 * hole, then the freeze landing on it. In the very same cue, `que` sits at
 * word 6 of 8:
 *
 *   clip 1  cue 1 [2.04-4.62s], "que" spoken at 4.20-4.38s — one occurrence
 *           in the whole clip, so ONE hold, and it is the final one (14s).
 *   clip 2  cue 2 [7.04-9.48s], "…como por dentro de granada y QUE se ve" —
 *           the gap renders at 7.04s with six words lighting up ahead of it,
 *           and the freeze lands at 9.08s. Two seconds of anticipation.
 *
 * The blank's cue is ENFORCED, not derived: que's true first occurrence in
 * clip 2 is cue 0 at 0.24s — before the clip even opens — so the fill beat
 * pins the cue via focusCueIndex (fill.expectedCueIndex, which used to be a
 * recorded fact and is now the instruction).
 *
 * Both clips gloss it identically ("that"), which matters: the sheet the
 * user saves from and the blank they fill have to agree.
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
  word: 'que',

  /**
   * Clip 1: where to stop the video and ask for the tap.
   *
   * ONE HOLD, because "que" is spoken exactly once in this clip. The chain of
   * second chances that `como` had (three occurrences, three holds) does not
   * exist for this word, so the single hold IS the final hold — and the
   * final hold WAITS. It used to release itself after 14s, and that timer
   * cost real runs (2026-09-01, on device): slow readers, and anyone who
   * opened the sheet and closed it without saving, got the clip back and
   * sailed past the beat. Now the ring stays until the word is saved; the
   * escapes are the swipe and the Continue bar, both live throughout, and a
   * declined tap is caught by clip 2's blue fallback blank.
   *
   * `holdAt` is just past the occurrence's END, so the word has been HEARD
   * before it is pointed at, and inside its own cue, so the karaoke line does
   * not move on underneath the ring. Measured, not chosen:
   *
   *   cue 1 [2.04-4.62]  "que" 4.20 → 4.38   hold 4.5
   *
   * The guard test checks it against the catalog.
   */
  tap: {
    /** Index into TASTE_REEL. */
    clip: 0,
    holds: [{ cueIndex: 1, holdAt: 4.5 }],
  },

  /** Clip 2: the blank is core's, but WHERE it lands is the script's. */
  fill: {
    clip: 1,
    /**
     * The cue the blank is PINNED to, via RecallHost's focusCueIndex — an
     * instruction now, not a recorded prediction. locateAsked places an
     * asked-for word at its earliest audible cue, and que's earliest is cue
     * 0 at 0.24s, before this clip even opens; cue 2 is where it sits
     * mid-sentence ("…y QUE se ve"), which is the whole reason it was
     * chosen — see "the shared word" above.
     */
    expectedCueIndex: 2,
    /**
     * OPEN THIS CLIP PART-WAY IN, a couple of seconds before the word.
     *
     * The gap renders when its cue does, at 7.04s, and the freeze lands at
     * 9.08s. Starting at 6.5s gives half a beat of real speech for context,
     * then the line with the hole in it, then two seconds of words lighting
     * up on their way to the freeze.
     *
     * This is the same lever a targeted review from the Words tab already
     * uses: loadVideoById takes a start time, so the clip OPENS here rather
     * than seeking after the fact. It must stay inside the clip and before
     * the word, which the guard test checks.
     */
    startAt: 6.5,
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
     * THE BLANK IS SCRIPTED, not planned, and it sits on the SECOND "mi".
     *
     * The clip starts from 0:00 and the opening line hands out the answer —
     * "Te voy a enseñar a hacer MI peinado siempre", the word spoken plainly
     * at 0.80s. Then the clip PLAYS: the flexstyle line, and into cue 2,
     * "empiezo seccionando MI cabello…", where the same word (2 of 8, inside
     * the line) freezes the video at 5.36–5.56s.
     *
     * The first "mi" held this slot for a morning and taught the lesson the
     * hard way (2026-09-01, Radek on device): a blank 0.96s in freezes the
     * clip before it has visibly begun — it read as "starts ON the blank"
     * rather than "gets to the blank". Five seconds of real playback first
     * is what makes the freeze an event; that the answer was literally
     * spoken in the opening line is what keeps it a guaranteed win.
     *
     * Scripted because the beat needs exactly THIS word — the one the
     * opening line just gave away — and the planner chooses by frequency
     * band, not by narrative. buildScriptedLevelBlank resolves it.
     */
    blank: { cueIndex: 2, text: 'mi' },
    /**
     * How much of the last clip must PLAY before the closing card comes up.
     * Playback, not wall clock: the accumulator only advances while the
     * player reports playing, so the blank's hold suspends it — the user
     * can sit on the answer as long as they like without the card racing
     * them.
     *
     * 7_500 = the 5.56s freeze on the cue-2 "mi" plus ~2 seconds of tail
     * after the answer, right or wrong — the beat: the giveaway line, four
     * more seconds of video, the freeze, the fill, a breath of speech,
     * Empezar. The guard test pins the freeze point and the tail together.
     * If the scripted blank fails to resolve (moved cue, lost gloss), the
     * clip simply plays 7.5s and the card comes up on its own.
     */
    outroAfterPlayedMs: 7_500,
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
