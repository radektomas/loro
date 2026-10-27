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

/** DIVERGED from app/welcome/page.tsx:366-375 (2026-10-27, with the
    lyrics hero): the headline says the outcome, the line under it says how. */
export const HOOK = {
  title: 'Understand real Spanish.',
  body: 'Learn from real people talking. Tap any word you don’t get.',
  cta: 'Empezar',
};

// ------------------------------------------------------------ 2. motivation

/** REWRITTEN. Multi-select, so the body has to say so before the first tap.
    Answers persist to loro.mobile.motivation as an array. */
export const MOTIVATION = {
  title: 'What’s pulling you toward Spanish?',
  body: '',
  options: [
    { id: 'travel', label: 'Travel', body: '', es: 'viajar' },
    { id: 'people', label: 'People', body: '', es: 'mi gente' },
    { id: 'work', label: 'Work', body: '', es: 'el trabajo' },
    { id: 'culture', label: 'Culture', body: '', es: 'la cultura' },
  ],
  cta: 'Continuar',
};

/**
 * WHAT THEY LIKE WATCHING (Radek, 2026-10-06: "every question adds to the
 * user feeling they gave more"). Multi-select, and the promise is exactly
 * what the feed does: it leans that way and still shows everything. Ids are
 * stored (loro.mobile.topics) and match scripts/tag-topics.mts.
 */
export const TOPICS = {
  title: 'What do you love watching?',
  body: '',
  options: [
    { id: 'travel', label: 'Travel and places', pill: 'Travel', es: 'los viajes' },
    { id: 'food', label: 'Food', pill: 'Food', es: 'la comida' },
    { id: 'love', label: 'Love, family and friends', pill: 'Love & family', es: 'el amor' },
    { id: 'money', label: 'Money and work', pill: 'Money & work', es: 'el dinero' },
    { id: 'funny', label: 'Funny, everyday life', pill: 'Everyday fun', es: 'el humor' },
    { id: 'mind', label: 'Health, sport and mind', pill: 'Health & mind', es: 'la salud' },
  ],
  cta: 'Continuar',
  /** How each topic is named when the plan says it back ("more food and travel"). */
  short: {
    travel: 'travel',
    food: 'food',
    love: 'love and family',
    money: 'money and work',
    funny: 'funny everyday stuff',
    mind: 'health and mind',
  } as Record<string, string>,
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
  body: '',
  options: [
    {
      id: 'zero' as const,
      label: 'I’m starting from zero',
      body: '',
      es: 'desde cero',
    },
    {
      id: 'some' as const,
      label: 'I know a bit',
      body: '',
      es: 'un poco',
    },
    {
      id: 'confident' as const,
      label: 'I’m fairly comfortable',
      body: '',
      es: 'bastante',
    },
  ],
};

// ------------------------------------------------------- 7b. the lesson

/**
 * REWRITTEN 2026-10-27. The two hands-on screens that replaced "how it
 * works" (WordLesson.tsx): tap a word and save it, then type it back into a
 * gap. Radek: "yayyy first word learned or something like that".
 *
 * "Saved" and never "saved to your Words": nothing is written to storage
 * (see WordLesson's header), so the copy must not say it is waiting there.
 */
export const LESSON = {
  steps: ['Tap it', 'It comes back', 'It’s yours'],
  stepsDone: 'All 3 steps done',
  /** The screen before the lesson. */
  introLoro: { es: '¡Vamos a probar!', en: 'Let’s try it!' },
  introTitle: 'Learn your first word in 30 seconds.',
  introSteps: [
    { head: 'Tap it', body: 'Tap a word you don’t know and save it.' },
    { head: 'It comes back', body: 'Loro brings it back in another video.' },
    { head: 'It’s yours', body: 'Type it in, and you’ve got it.' },
  ],
  introCta: '¡Vamos!',
  tapTitle: 'Tap the word you don’t know.',
  tapHint: 'Tap the glowing word. Others show their meaning too.',
  save: 'Save word',
  saved: '✓ Saved',
  savedBody: 'Loro brings saved words back right before you’d forget them.',
  tapWaiting: 'Tap the glowing word',
  tapCta: 'Continuar',
  backTitle: 'A few videos later, it comes back. Type it in.',
  placeholder: 'Type the Spanish word',
  hintPrefix: 'Almost. It starts with',
  hintTail1: '.',
  hintTail2: '. Or let Loro show you.',
  reveal: 'Show me',
  backWaiting: 'Type the word above',
  wonTitle: 'That’s how Loro works.',
  /** Loro's answer on the win, in his usual bubble (LoroSays). */
  wonLoro: { es: '¡Muy bien! ¡Perfecto!', en: 'Very good! Perfect!' },
  wonLoroRevealed: { es: '¡Eso es! Ahora es tuya.', en: 'That’s it! Now it’s yours.' },
  /** The little achievement card under him. */
  badgeHead: 'Your first Spanish word',
  backCta: 'Continuar',
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
  body: '',
  options: [
    { id: 'light', label: 'A few times a week', body: 'About 5 minutes.', minutes: '5', es: 'a veces' },
    { id: 'daily', label: 'Every day', body: 'About 10 minutes.', minutes: '10', es: 'cada día' },
    { id: 'serious', label: 'As much as I can', body: '20 minutes or more.', minutes: '20+', es: 'mucho' },
  ],
  /** Under the empty week, before anything is picked. */
  pickPrompt: 'Pick a pace. You can change it anytime.',
  cta: 'Continuar',
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
  body: '',
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
  title: 'Building your plan',
  /** The title once the ring is full. */
  titleDone: 'Your plan is built',
  /** The checklist's last line: shipped behaviour (the Words path brings
      trained words back into the feed), said in six words. */
  recallShort: 'Words come back before you forget',
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

// -------------------------------------------------------- 11b. plan ready

/**
 * THE SUMMARY THAT SELLS, one screen after the plan assembles and one screen
 * before the wall. Radek, 2026-09-07: "congratulations, your plan is
 * finished (fluency by the date he chose), then a summary of how many
 * minutes a day, what he's doing it for, and a couple more things that
 * could convince him to pay".
 *
 * SAME RULES AS PLAN_BUILD: every line is the user's own answer read back
 * (pace, why, level, date) or shipped behaviour (clips at level, recall
 * before slipping, the daily goal, the weekly freeze). "Fluent by <date>"
 * is the user's target in the user's word — the goal screen asked "when do
 * you want to be fluent" — never a promise of outcome. No em dashes.
 */
export const PLAN_READY = {
  title: '¡Enhorabuena!',
  gloss: 'congratulations',
  /** Under the title, above the boarding pass. */
  sub: 'Your plan is ready. Here’s your ticket.',
  /** Followed by the date. */
  targetPrefix: 'Your plan is ready, and it points at one date: fluent by ',
  /** Row 1 body, after the pace line. Prefixed with the plan's number. */
  goalBody: ' words a day is the goal. The streak keeps score, and one freeze a week means a busy day never costs you.',
  /** Row 2, when no reason was picked. */
  whyFallback: 'For you',
  whyTail: 'Real clips, so what you learn is the Spanish people actually speak.',
  /** Row 3, after "Starting at <level>". */
  clips: 'Clips at your level from day one, and the feed moves up as you do.',
  /** Row 4. */
  recallHead: 'Nothing you learn slips away',
  recall: 'Train the words you save in a few quick exercises. Then they come back in your videos until they are yours.',
  cta: '¡Vamos!',
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
  body: '',
  cta: '¡Vamos!',
};

// ----------------------------------------------------------- Loro says

/**
 * LORO'S LINES ON THE QUESTION SCREENS (LoroSays.tsx, 2026-10-27). `open`
 * is what he says on arrival; each answer id gets a reaction, shown for
 * the last option tapped. Spanish first, its English under it: every line
 * is a phrase people really say, so the questions teach too. Keyed on the
 * stored option ids, like the art maps in steps.tsx.
 */
export const LORO_LINES = {
  motivation: {
    open: { es: '¡Hola! Soy Loro.', en: 'Hi! I’m Loro.' },
    travel: { es: '¡Vámonos de viaje!', en: 'Let’s go travelling!' },
    people: { es: '¡Qué bonito!', en: 'How lovely!' },
    work: { es: '¡A trabajar!', en: 'Let’s get to work!' },
    culture: { es: '¡Olé!', en: 'Bravo!' },
  },
  selfLevel: {
    open: { es: '¿Hablas español?', en: 'Do you speak Spanish?' },
    zero: { es: '¡Empezamos juntos!', en: 'We’ll start together!' },
    some: { es: '¡Muy bien!', en: 'Very good!' },
    confident: { es: '¡Genial!', en: 'Great!' },
  },
  topics: {
    open: { es: '¿Qué te gusta ver?', en: 'What do you like watching?' },
    travel: { es: '¡A la aventura!', en: 'Off on an adventure!' },
    food: { es: '¡Qué rico!', en: 'Yum!' },
    love: { es: '¡Ay, el amor!', en: 'Ah, love!' },
    money: { es: '¡Dinero, dinero!', en: 'Money, money!' },
    funny: { es: '¡Jajaja!', en: 'Hahaha!' },
    mind: { es: '¡Mente sana!', en: 'Healthy mind!' },
  },
  frequency: {
    open: { es: '¿Cuánto tiempo tienes?', en: 'How much time do you have?' },
    light: { es: '¡Poco a poco!', en: 'Little by little!' },
    daily: { es: '¡Cada día un poco!', en: 'A little every day!' },
    serious: { es: '¡Así se hace!', en: 'That’s the spirit!' },
  },
} as Record<string, Record<string, { es: string; en: string }>>;

// -------------------------------------------------------------- chrome

/** PORTED. The web shows a Skip on every phase (app/welcome/page.tsx:351-359)
    and it commits the same finish() as completing the flow. */
export const CHROME = {
  skip: 'Skip',
  back: 'Back',
};
