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

// -------------------------------------------------------- 11. reassurance

/**
 * REWRITTEN. No web counterpart.
 *
 * WHAT THIS BLOCK USED TO BE, because the screen still occupies its slot. It
 * was "Make twice as much progress with Loro", drawn as a precise 2:1 bar
 * chart against a bar labelled "Other apps". Nothing in this repo measures
 * that, so it was a comparative performance claim with no data under it, and
 * the chart asserted the ratio whatever the headline above it said. Both are
 * gone. The screen now describes what Loro does and leaves ranking out of it.
 *
 * KEEP IT THAT WAY. Copy here that names a competitor, a category of app, or a
 * multiplier needs evidence before it ships.
 *
 * The screen that followed this one, a fake "Building your plan" loader with
 * four invented five-star testimonials attached to invented people, is gone
 * outright. It is not commented out and it is not waiting for real quotes:
 * both the copy and the step were deleted. If real, attributable testimonials
 * ever exist, that is a new screen written from scratch.
 */
export const PROGRESS_COMPARISON = {
  title: 'Make significant progress',
  body: 'You learn from real speech at real speed, and the words you save come back on a schedule. A few minutes a day is enough to keep moving.',
  cta: 'Continuar',
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
