/**
 * ============================================================================
 * ALL ONBOARDING COPY LIVES HERE. ONE FILE, NOTHING INLINE IN THE SCREENS.
 * ============================================================================
 *
 * TONE: warm, plain, second person. Short sentences. Spanish only where it is
 * doing something (the buttons, which teach three words by using them).
 * Encouraging without being chirpy, and never corporate.
 *
 * NO EM-DASHES IN ANY STRING BELOW. They read as machine-written, so every
 * clause that wanted one is a comma, a full stop, or a rewritten sentence.
 * That rule holds for this whole file, comments included. Grep the file for
 * the character before adding copy: there should be zero hits.
 *
 * Blocks are tagged one of three ways:
 *
 *   REWRITTEN   written for this flow. Yours to change freely.
 *   PORTED      the web shows this exact string (app/welcome/page.tsx).
 *               Changing it here makes the two products say different things
 *               at the same moment.
 *   DIVERGED    started as the web's, changed here. The divergence is noted
 *               so it can be pushed back to the web or reverted on purpose.
 *
 * The option `id` fields are NOT copy. They are the values written to MMKV:
 * renaming a label is free, renaming an id changes stored data.
 */

// ---------------------------------------------------------------- 1. hook

/** PORTED, app/welcome/page.tsx:366-375. No em-dash, nothing to fix. */
export const HOOK = {
  title: 'Learn Spanish from real people talking.',
  body: 'Not textbook Spanish. Real clips, real speed, real accents.',
  cta: 'Empezar',
};

// ------------------------------------------------------------ 2. motivation

/** REWRITTEN. Multi-select, so the body has to say so before the first tap.
    Answers persist to loro.mobile.motivation as an array. */
export const MOTIVATION = {
  title: 'What’s pulling you toward Spanish?',
  body: 'Pick as many as you like. It helps us choose what to put in front of you.',
  options: [
    { id: 'travel', label: 'Travel', body: 'So I can actually talk when I get there.' },
    { id: 'people', label: 'People', body: 'Family, a partner, friends.' },
    { id: 'work', label: 'Work', body: 'I need it for my job.' },
    { id: 'culture', label: 'Culture', body: 'Music, film, football, books.' },
  ],
  cta: 'Continuar',
};

// ----------------------------------------------------------- 3. self-assess

/**
 * DIVERGED from app/welcome/page.tsx:381-406.
 *
 * The web asks "How much Spanish do you have?", which nobody says out loud,
 * and its third option ("I want to grow my vocabulary") answers a different
 * question from the other two. Both are fixed here. The body also loses an
 * em-dash and makes a truer promise: the level is not locked in because the
 * feed reorders around what you actually do, not because there is a setting.
 *
 * The three ids are core's SelfLevel union and must not be renamed: they are
 * written to loro.level and routed on.
 */
export const SELF_LEVEL = {
  title: 'How much Spanish do you know already?',
  body: 'This only sets your starting point. Your feed moves as you do.',
  options: [
    {
      id: 'zero' as const,
      label: 'I’m starting from zero',
      body: 'We’ll build your first words together.',
    },
    {
      id: 'some' as const,
      label: 'I know a bit',
      body: 'A quick word check tunes where you start.',
    },
    {
      id: 'confident' as const,
      label: 'I’m fairly comfortable',
      body: 'Jump into real videos and mine them for words.',
    },
  ],
};

// ------------------------------------------------------ 4. calibration intro

/** REWRITTEN. No web counterpart: the web drops straight into the grid. This
    screen exists so the grid does not read as a test. */
export const CALIBRATION_INTRO = {
  title: 'Quick word check.',
  body: 'Fifteen words, about twenty seconds. Nothing is graded, so be generous with yourself.',
  cta: 'Vale',
};

// ---------------------------------------------------------------- 5. grid

/** DIVERGED, app/welcome/page.tsx:435-467: the body's em-dash became a full
    stop. Both button labels are the web's, which switches on whether anything
    is selected. */
export const GRID = {
  title: 'Tap the words you already know.',
  body: 'No timer, no right answers. It just tunes where you start.',
  ctaSome: 'Continuar',
  ctaNone: 'None of these yet',
};

// --------------------------------------------------------------- 6. result

/** PORTED (kicker) + REWRITTEN (body, cta). The web shows only the kicker and
    the level, then auto-advances into the guided video after 1900ms. We have
    no guided video yet, so this screen ends in a tap and needs a line saying
    what the level actually means. */
export const RESULT = {
  kicker: 'Empecemos con',
  body: 'That’s where your feed starts. Watch, save what you don’t know, and it moves with you.',
  cta: 'Seguir',
};

// --------------------------------------------------------- 7. how it works

/** PORTED (title, app/welcome/page.tsx:534-537) + REWRITTEN (steps, cta). */
export const HOW_IT_WORKS = {
  title: 'Save what you don’t know, and it comes back right before you forget it.',
  steps: [
    'Watch real clips. Words light up as they’re spoken.',
    'Tap anything you don’t recognise. That saves it.',
    'It returns days later, right as it’s about to slip away.',
  ],
  cta: 'Continuar',
};

// -------------------------------------------------------------- 8. blanks

/** REWRITTEN. No web counterpart. The mock underneath is the real dashed slot,
    so this teaches the mechanic before it interrupts a video. */
export const BLANKS = {
  title: 'This is how a word comes back.',
  body: 'It turns into a gap in the subtitles. The video waits for you, you type it, and it carries on.',
  mockSentence: ['Vivo', 'en', '__BLANK__', 'ciudad'],
  mockGloss: 'this',
  cta: 'Entendido',
};

// ------------------------------------------------------------ 9. frequency

/**
 * REWRITTEN. No web counterpart. Answers persist to loro.mobile.frequency.
 *
 * NOTIFICATION PERMISSION IS NEVER REQUESTED IN THIS FLOW, AND THAT IS A RULE
 * RATHER THAN A GAP. The app does send reminders, and expo-notifications is
 * installed, so nothing technical is stopping a prompt here. It is deliberately
 * absent: iOS grants one system prompt per install, and spending it on someone
 * who has not yet felt what a reminder is for is how an app ends up permanently
 * unable to send any. The ask happens after the user's first correct answer,
 * behind an in-app explainer, in the feed. See src/platform/notifications.ts.
 *
 * Do not add a permission request, a reminder-time step, or a "turn on
 * notifications" screen to this flow. The reminder time is set in Progress, by
 * people who have already opted in.
 *
 * THE BODY MAKES NO PROMISE ABOUT REMINDERS EITHER WAY. It used to say "No
 * reminders, no pressure", which was true when nothing could send one and
 * became a broken promise the moment daily reminders shipped. This screen asks
 * about practice frequency; what it must not do is describe notification
 * behaviour it does not control.
 */
export const FREQUENCY = {
  title: 'How often do you want to practise?',
  body: 'There is no wrong answer. It just sets the pace we aim for.',
  options: [
    { id: 'light', label: 'A few times a week', body: 'About 5 minutes.' },
    { id: 'daily', label: 'Every day', body: 'About 10 minutes.' },
    { id: 'serious', label: 'As much as I can', body: '20 minutes or more.' },
  ],
};

// ------------------------------------------------------- 10. fluency goal

/**
 * PLACEHOLDER. No web counterpart. Display only: the number the user picks and
 * the date derived from it are never written anywhere.
 *
 * Month names are listed rather than formatted through Intl, so the derived
 * line reads identically on every device and Hermes' ICU build never comes
 * into it.
 */
export const FLUENCY_GOAL = {
  title: 'When do you want to be fluent in Spanish?',
  body: 'Drag to set your target. Nothing is locked in, and you can move it whenever you like.',
  /** Suffixed with the number, so singular matters. */
  unitOne: 'month',
  unitMany: 'months',
  derivedPrefix: 'On track for',
  cta: 'Continuar',
  months: [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ],
};

// -------------------------------------------------------- 11. plan build

/**
 * REWRITTEN twice, and the history is the guardrail.
 *
 * WHAT THIS SLOT USED TO HOLD. First, "Make twice as much progress with
 * Loro" over a precise 2:1 bar chart against "Other apps" — a comparative
 * performance claim nothing in this repo measures. Then a static reassurance
 * screen. Separately, the step after this one was once a fake "Building your
 * plan" loader that sat for four seconds rotating five-star testimonials
 * attributed to invented people. Chart, multiplier and testimonials were all
 * deleted, not disabled.
 *
 * WHAT IT IS NOW — a plan-build loader again, and the difference is that
 * every line it shows is TRUE: the level line is the one the calibration
 * grid derived (or the A1 the zero path writes), the pace line is the
 * frequency option the user tapped two screens ago, and the recall line
 * describes the scheduling the app actually does. The bar paces the reveal;
 * it does not claim computation that is not happening — the plan really is
 * assembled from these answers, this screen just shows the assembly.
 *
 * KEEP IT THAT WAY. No competitor names, no multipliers, no testimonials,
 * and no line on this screen that is not a statement of the user's own
 * answers or of shipped behaviour. Evidence first, then copy.
 */
export const PLAN_BUILD = {
  title: 'Building your customized plan',
  /** Under point A, whose badge is the derived level. */
  todayLabel: 'Today',
  /** Point B's badge. "Fluent" is the user's own stated aim — it is the word
      the goal screen's question uses — not a promise of outcome; the label
      under it is the month they picked. */
  goalBadge: 'Fluent',
  /** Used only if frequency is somehow unanswered — the screen order makes
      that unreachable, but a fallback beats rendering "undefined". */
  paceFallback: 'Paced to fit your routine',
  /** Restates RESULT's established claim (level-tuned feed that moves with
      you) — it introduces no new promise. */
  clips: 'Real clips at your level, and the feed moves up as you do',
  recall: 'Saved words return right before they slip away',
  /**
   * The sum line: their pace × their window, as hours. Arithmetic on the
   * user's own two answers, rounded and hedged with "about" — the one kind
   * of number this screen is allowed (see the block comment above). It says
   * what the plan ADDS UP TO, never what it guarantees.
   */
  totalLead: 'At your pace, that adds up to',
  totalUnit: 'hours',
  totalBodyPrefix: 'of real Spanish between now and ',
  /**
   * The verdict under the number — coaching on the SIZE OF THE COMMITMENT,
   * chosen by hour tier (see PLAN_VERDICT_* in steps.tsx). These may advise
   * and encourage; what they must never do is promise an outcome. "You will
   * be like a native" was the requested high line and is deliberately not
   * here — it is a performance guarantee nothing measures, the same species
   * of claim as the deleted 2x chart. The shipped lines stay on the honest
   * side: a recommendation, an assessment of feasibility, a description of
   * exposure.
   */
  verdictLow:
    'Honestly? That’s light for fluency. Even one more session a week would move this number a lot.',
  verdictMid: 'That’s a real runway. At your pace, this goal is very doable.',
  verdictHigh:
    'That’s immersion territory. Live with this much Spanish and it stops sounding foreign.',
  cta: 'Continuar',
};

// ---------------------------------------------------------------- taste reel

/**
 * REWRITTEN. No web counterpart.
 *
 * ALMOST NO COPY, AND THAT IS THE SCREEN. This step is three real clips with
 * the real karaoke line and the real word sheet, so anything written over it
 * competes with the thing it is trying to sell. The instructions the user needs
 * were already given by the screen before it, which says "Swipe it like
 * anything else, and tap a word the moment it stops making sense" — read HANDOFF
 * and this block together, because they are now one beat.
 *
 * `waiting` is the honest state for a first launch whose catalog has not
 * downloaded yet. It promises nothing and blames nobody; the screen keeps
 * asking for the catalog behind it, and the button below stays live so the
 * flow is never a dead end. Do not turn this into an apology or an error.
 */
export const TASTE = {
  cta: 'Continuar',
  waiting: 'Getting your first videos ready. This needs a connection, and it only happens once.',

  /**
   * THE COACHED BEATS. One short line each, because every one of them is read
   * over a paused video the user would rather be watching.
   *
   * The second person and the present tense are doing work here: "Tap it" and
   * "It comes back" describe what is happening on screen right now, not what
   * the product does in general. The general version of each sentence was
   * already made on screens 7 and 8; this is the same claim, demonstrated.
   */
  /** The opening nudge. The clip autoplays muted (WebKit's rule), and the
      FIRST tap on the video is wired to be the unmute, with the band's 🔇
      pill as the fallback — so this card teaches the cheap gesture rather
      than a hunt for a control. It yields to every scripted beat and
      clears itself the moment sound is on. */
  sound: {
    title: 'Turn the sound on.',
    body: 'Tap the video once. The 🔇 button below works too.',
  },
  /** Sharpened 2026-09-01: the old pair ("Tap the word you don't know" /
      "This one is highlighted") read as a suggestion, and people watched
      the ring breathe without touching it — and a missed tap costs the
      next clip its promised blank. The instruction now points at the glow
      and says what a tap does, in that order. */
  tap: {
    title: 'Tap the glowing word.',
    body: 'It’s pulsing in the sentence below. A tap saves it.',
  },
  saved: {
    title: 'Saved.',
    /** Ends on the instruction: this card marks the end of a beat, and a
        finished beat must always name the next move — the swipe hint alone
        arrived seconds later and left a gap where people wondered. */
    body: 'It comes back as a blank in the videos you scroll, right before you would forget it. Swipe up when you are ready.',
  },
  scrollHint: 'Swipe up for the next one',
  fill: {
    /** Shown as the blank arrives, so the gap is not a surprise. */
    title: 'There it is.',
    body: 'The video waits. Type it and it carries on.',
  },

  /**
   * The outro, raised when they pull past the last clip.
   *
   * IT NAMES THE WORDS TAB ON PURPOSE and is the only place in onboarding that
   * does. The tab is behind the paywall, so this is a description of what is
   * being bought rather than a pointer to somewhere they can go.
   *
   * "One word at a time" rather than a number: nothing here should imply a
   * catalog size or a daily quota that the app does not enforce.
   */
  outro: {
    title: 'That’s how Loro works.',
    body: 'Watch real Spanish, tap what you don’t know, and fill it back in when it returns. Everything you save collects in Words, where you can practise it one word at a time.',
    /** The last button in the flow, and the fourth Spanish word it teaches by
        using it. HOOK opens on the same verb, so the intro and the handover
        rhyme. */
    cta: 'Empezar',
    /** Shown under the button, the way a gloss sits under a subtitle. The word
        is doing double duty as copy and as vocabulary, so it has to be
        readable as both. */
    ctaGloss: 'start',
  },
};

// -------------------------------------------------------------- 12. paywall

/** REWRITTEN, and dark. Nothing renders while PAYWALL_ENABLED is false. */
export const PAYWALL = {
  title: 'Loro Pro',
  body: 'Placeholder surface. No plans, no prices, nothing to buy. This screen holds the space for when entitlements land.',
  cta: 'Continuar',
  dismiss: 'Not now',
};

// ------------------------------------------------------------- 13. handoff

/** PORTED (cta, app/welcome/page.tsx:550) + REWRITTEN (title, body). */
export const HANDOFF = {
  title: '¡Listo!',
  body: 'Your feed is ready. Swipe it like anything else, and tap a word the moment it stops making sense.',
  cta: '¡Vamos!',
};

// -------------------------------------------------------------- chrome

/** PORTED. The web shows a Skip on every phase (app/welcome/page.tsx:351-359)
    and it commits the same finish() as completing the flow. */
export const CHROME = {
  skip: 'Skip',
  back: 'Back',
};
