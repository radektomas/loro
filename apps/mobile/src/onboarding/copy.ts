/**
 * ============================================================================
 * ALL ONBOARDING COPY LIVES HERE. ONE FILE, NOTHING INLINE IN THE SCREENS.
 * ============================================================================
 *
 * Every block below is tagged one of two ways, and the difference matters:
 *
 *   PLACEHOLDER    invented for this flow. Rewrite freely — nothing else in
 *                  the app says these words. Grep "PLACEHOLDER" to find them
 *                  all; there are seven blocks.
 *
 *   PORTED         the web already shows this exact string
 *                  (app/welcome/page.tsx). Changing it here makes the two
 *                  products say different things at the same moment, so
 *                  change the web too or decide the divergence on purpose.
 *
 * The option IDs (`id` fields) are NOT copy — they are what gets written to
 * MMKV. Renaming a label is free; renaming an id changes stored data.
 */

// ---------------------------------------------------------------- 1. hook

/** PORTED — app/welcome/page.tsx:366-375. */
export const HOOK = {
  title: 'Learn Spanish from real people talking.',
  cta: 'Empezar',
};

// ------------------------------------------------------------ 2. motivation

/** PLACEHOLDER — no web counterpart. Answers persist to loro.mobile.motivation
    and are inert today; the ids are the stored values. */
export const MOTIVATION = {
  title: 'What brings you to Spanish?',
  body: 'No wrong answer — it just helps us pick what to show you.',
  options: [
    { id: 'travel', label: 'Travel', body: 'I want to get by when I go.' },
    { id: 'people', label: 'People', body: 'Family, a partner, friends.' },
    { id: 'work', label: 'Work', body: 'I need it professionally.' },
    { id: 'culture', label: 'Culture', body: 'Music, film, football, books.' },
  ],
};

// ----------------------------------------------------------- 3. self-assess

/** PORTED — app/welcome/page.tsx:381-406. The three ids are core's SelfLevel
    union and must not be renamed: they are written to loro.level and routed on. */
export const SELF_LEVEL = {
  title: 'How much Spanish do you have?',
  body: 'This just picks your starting point — nothing is locked in.',
  options: [
    {
      id: 'zero' as const,
      label: 'Starting from zero',
      body: 'We’ll build your first words together before the videos.',
    },
    {
      id: 'some' as const,
      label: 'I know some Spanish',
      body: 'A quick word check tunes where you start.',
    },
    {
      id: 'confident' as const,
      label: 'I want to grow my vocabulary',
      body: 'Jump into real videos and mine them for words.',
    },
  ],
};

// ------------------------------------------------------ 4. calibration intro

/** PLACEHOLDER — no web counterpart. The web drops straight into the grid;
    this screen exists so the grid does not read as a test. */
export const CALIBRATION_INTRO = {
  title: 'Fifteen words. Tap the ones you know.',
  body: 'It takes about twenty seconds and sets where your feed starts. You can be generous — nothing is graded.',
  cta: 'Vale',
};

// ---------------------------------------------------------------- 5. grid

/** PORTED — app/welcome/page.tsx:435-467. Both button labels included: the web
    switches on whether anything is selected. */
export const GRID = {
  title: 'Tap the words you already know.',
  body: 'No timer, no right answers — this just tunes where you start.',
  ctaSome: 'Continuar',
  ctaNone: 'None of these yet',
};

// --------------------------------------------------------------- 6. result

/** PORTED (kicker) + PLACEHOLDER (body, cta) — the web shows only the kicker
    and the level, then auto-advances into the guided video after 1900ms. We
    have no guided video yet, so this screen has to end in a tap and needs a
    line explaining what the level means. */
export const RESULT = {
  kicker: 'Empecemos con',
  body: 'That sets where your feed starts. Watch and save, and it moves on its own.',
  cta: 'Seguir',
};

// --------------------------------------------------------- 7. how it works

/** PORTED (title) + PLACEHOLDER (steps, cta) — the title is the web's closing
    line, app/welcome/page.tsx:534-537. */
export const HOW_IT_WORKS = {
  title: 'Save what you don’t know, and it comes back right before you forget it.',
  steps: [
    'Watch a real clip with the words lit up as they’re spoken.',
    'Tap any word you don’t know to save it.',
    'It returns days later, right when it’s about to slip.',
  ],
  cta: 'Continuar',
};

// -------------------------------------------------------------- 8. blanks

/** PLACEHOLDER — no web counterpart. The mock underneath is the real dashed
    slot, so this screen teaches the mechanic before it appears mid-video. */
export const BLANKS = {
  title: 'That’s a blank.',
  body: 'Your saved words come back as gaps in the subtitles. The video waits, you type, and it carries on.',
  mockSentence: ['Vivo', 'en', '__BLANK__', 'ciudad'],
  mockGloss: 'this',
  cta: 'Entendido',
};

// ------------------------------------------------------------ 9. frequency

/** PLACEHOLDER — no web counterpart. Answers persist to loro.mobile.frequency
    and are inert today; the ids are the stored values. No notification
    permission is requested — that would need expo-notifications and a rebuild. */
export const FREQUENCY = {
  title: 'How often do you want to practise?',
  body: 'Nothing is enforced and there are no reminders yet — this sets the pace we aim for.',
  options: [
    { id: 'light', label: 'A few times a week', body: 'Around 5 minutes.' },
    { id: 'daily', label: 'Every day', body: 'Around 10 minutes.' },
    { id: 'serious', label: 'Seriously', body: '20 minutes or more.' },
  ],
};

// -------------------------------------------------------------- 10. paywall

/** PLACEHOLDER — and dark. Nothing renders while PAYWALL_ENABLED is false. */
export const PAYWALL = {
  title: 'Loro Pro',
  body: 'Placeholder surface — no plans, no prices, no purchase. This screen exists so the flow has the right shape when entitlements land.',
  cta: 'Continuar',
  dismiss: 'Not now',
};

// ------------------------------------------------------------- 11. handoff

/** PORTED (cta) + PLACEHOLDER (title, body) — '¡Vamos!' is the web's,
    app/welcome/page.tsx:550. */
export const HANDOFF = {
  title: 'Listo.',
  body: 'Your feed is ready. Swipe through it like any other, and tap a word the moment it stops making sense.',
  cta: '¡Vamos!',
};

// -------------------------------------------------------------- chrome

/** PORTED — the web shows a Skip on every phase (app/welcome/page.tsx:351-359)
    and it commits the same finish() as completing the flow. */
export const CHROME = {
  skip: 'Skip',
  back: 'Back',
};
