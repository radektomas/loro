/**
 * WHAT THE NOTIFICATIONS SAY (Radek, 2026-10-02: "i want the notifications
 * more creative"). Pure: no native module, no storage. notifications.ts
 * gathers the user's own material and this turns it into a line, so the copy
 * can be read and checked without a phone.
 *
 * THE MATERIAL IS THE USER'S, NOT A TEMPLATE'S. A real word they learned, the
 * word they are on, the city they are in and its local word, the next stop.
 * "Your words are waiting" could be any app; "¿Te acuerdas de esposa?" is
 * only Loro. And Loro is a character: a parrot with his bags packed, cheeky,
 * never a scold.
 *
 * Rules carried over from the copy this replaces, and still binding:
 *   - Encouraging, never guilt-tripping: no "don't lose it", no countdown.
 *   - Nothing untrue: no "new videos just landed", no invented friends.
 *   - No em dashes; they read as machine-written. No emoji (no emoji in Loro's UI).
 *   - Deterministic per day (the caller passes the day's variant), because
 *     reconcile() rewrites pending notifications many times a day.
 */

export type NotifRoute = 'review' | 'words';

export type NotifCopy = { title: string; body: string; route: NotifRoute };

export type CopyContext = {
  /** A word the user has learned, to ask back: { text, meaning }. */
  recall: { text: string; meaning: string } | null;
  /** The word they are on, saved but not trained yet. */
  toTrain: string | null;
  /** Where the trip is. */
  trip: {
    city: string;
    /** 0 = Madrid, the first stop. */
    stage: number;
    learnedHere: number;
    toNext: number;
    nextCity: string;
    nextCountry: string;
    /** The next stop is in a different country. */
    newCountryNext: boolean;
    /** The city's own local word (countries.CITIES). */
    local: { word: string; meaning: string } | null;
  };
  /** Days in a row, as of the morning of the day the line is for. */
  streak: number;
  /** Yesterday was missed and the weekly freeze covered it. */
  frozen: boolean;
  /** The run just ended; this is how long it was (0 = nothing ended). */
  endedRun: number;
  /** Words learned in all. */
  learned: number;
};

/** Pick one of `n` with the day's number, offset per pool so pools do not move in lockstep. */
const pick = <T,>(pool: readonly T[], day: number, salt = 0): T => pool[(((day + salt) % pool.length) + pool.length) % pool.length];

/** "quedemos is waiting" -> "Quedemos is waiting"; leaves ¡ and ¿ lines alone. */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const words = (n: number) => `${n} ${n === 1 ? 'word' : 'words'}`;

// ------------------------------------------------------------- the pools

/** Ask a learned word back. Opens the feed, where it comes back as a blank. */
function recallLine(w: { text: string; meaning: string }, day: number): NotifCopy {
  const lines: [string, string][] = [
    [`¿Te acuerdas de ${w.text}?`, 'Loro does. Two minutes in your videos and you will too.'],
    [`Quick one: ${w.text}`, 'You learned it. Loro wants to see if it stuck.'],
    [`${w.text}. Ring a bell?`, 'It is hiding in your videos today. Catch it when it shows up.'],
    [`Loro keeps saying ${w.text}`, 'He will not stop until you say it back. Help.'],
  ];
  const [title, body] = pick(lines, day, 1);
  return { title: cap(title), body, route: 'review' };
}

/** The word they are on. Opens Words, where tapping it trains it. */
function trainLine(w: string, t: CopyContext['trip'], day: number): NotifCopy {
  const lines: [string, string][] = [
    [`${w} is waiting for you`, `Three quick exercises and it is yours. ${t.nextCity} is ${words(t.toNext)} away.`],
    [`Today's word: ${w}`, `Train it in Words. Every word gets you closer to ${t.nextCity}.`],
    [`Loro saved you a spot`, `Next up on your trip: ${w}. One tap to train it.`],
  ];
  const [title, body] = pick(lines, day, 2);
  return { title: cap(title), body, route: 'words' };
}

/** The trip itself. Opens Words, on the map. */
function tripLine(t: CopyContext['trip'], day: number): NotifCopy {
  if (t.newCountryNext) {
    const lines: [string, string][] = [
      [`Next stop: ${t.nextCountry}`, `Finish ${t.city} and you fly to ${t.nextCity}. New country, new local word.`],
      [`${t.nextCountry} is calling`, `${words(t.toNext)} left in ${t.city}, then Loro packs the bags.`],
    ];
    const [title, body] = pick(lines, day, 3);
    return { title, body, route: 'words' };
  }
  if (t.stage > 0 && t.learnedHere === 0) {
    return {
      title: `Welcome to ${t.city}`,
      body: 'Loro landed. Now fill the city up: save a few words in your videos.',
      route: 'words',
    };
  }
  const lines: [string, string][] = [
    [`${t.nextCity} is ${words(t.toNext)} away`, 'Loro has the bags packed. A few minutes and you are on your way.'],
    [`Next stop: ${t.nextCity}`, `Your boarding pass is almost ready. ${words(t.toNext)} to go.`],
    [`Still in ${t.city}?`, `Lovely place. But ${t.nextCity} is only ${words(t.toNext)} away.`],
  ];
  const [title, body] = pick(lines, day, 4);
  return { title, body, route: 'words' };
}

/** The city's local word, from the postcard. Opens Words. */
function localLine(t: CopyContext['trip'], day: number): NotifCopy | null {
  if (!t.local) return null;
  const { word, meaning } = t.local;
  const lines: [string, string][] = [
    [`In ${t.city} they say ${word}`, `It means ${meaning}. Use it on your next video.`],
    [`Local tip from ${t.city}`, `${word}: ${meaning}. Loro has been saying it all day.`],
  ];
  const [title, body] = pick(lines, day, 5);
  return { title, body: cap(body), route: 'words' };
}

/** Loro being Loro. Opens the feed. */
function loroLine(day: number): NotifCopy {
  const lines: [string, string][] = [
    ['Squawk. Spanish time.', 'Real people, real Spanish, a few minutes. Loro is ready when you are.'],
    ['Loro is bored', 'He has been watching Spanish videos alone. Join him?'],
    ['Two minutes?', 'That is all Loro is asking. One video, a word or two.'],
    ['Loro picked a video for you', 'He has good taste. Mostly. Come see.'],
  ];
  const [title, body] = pick(lines, day, 6);
  return { title, body, route: 'review' };
}

function streakLine(n: number, day: number): NotifCopy {
  const lines: [string, string][] = [
    [`${n} days in a row`, 'Loro is impressed. A short session keeps it going.'],
    [`Day ${n + 1} is right there`, 'A few words does it. Loro is counting with you.'],
    [`${n} days. Look at you.`, 'Loro told all the other parrots. Keep it going?'],
  ];
  const [title, body] = pick(lines, day, 7);
  return { title, body, route: 'review' };
}

// -------------------------------------------------------------- the picks

/**
 * THE DAILY REMINDER. A missed day the freeze covered, and a run that just
 * ended, keep their own honest lines (they say something only that day can).
 * Otherwise one of the pools the user has material for, rotating by day, so
 * the week reads as a word, the trip, the city, Loro, the streak, a word...
 */
export function dailyCopy(ctx: CopyContext, day: number): NotifCopy {
  if (ctx.frozen && ctx.streak >= 1) {
    return {
      title: 'Your streak is safe',
      body: `Yesterday is covered by your weekly freeze. ${ctx.streak} days still stand, and today keeps them.`,
      route: 'review',
    };
  }
  if (ctx.streak === 0 && ctx.endedRun >= 2) {
    return {
      title: 'New run, new start',
      body: `${ctx.endedRun} days was a good run. Day one of the next one is here whenever you are.`,
      route: 'review',
    };
  }
  const options: NotifCopy[] = [];
  if (ctx.recall) options.push(recallLine(ctx.recall, day));
  options.push(ctx.toTrain ? trainLine(ctx.toTrain, ctx.trip, day) : tripLine(ctx.trip, day));
  const local = localLine(ctx.trip, day);
  if (local) options.push(local);
  if (ctx.toTrain) options.push(tripLine(ctx.trip, day));
  options.push(loroLine(day));
  if (ctx.streak >= 2) options.push(streakLine(ctx.streak, day));
  return pick(options, day);
}

/**
 * 20:30, only on a day not yet done. Short, warm, one small ask; the trip
 * when there is a city to get closer to.
 */
export function atRiskCopy(ctx: CopyContext, day: number): NotifCopy {
  const lines: NotifCopy[] = [
    { title: 'Still time today', body: 'Two minutes is plenty. Loro is still up.', route: 'review' },
    {
      title: `${ctx.trip.nextCity} is ${words(ctx.trip.toNext)} away`,
      body: 'One more step before bed? Loro will hold the map.',
      route: 'words',
    },
    { title: 'Loro is yawning', body: 'But he will stay up for one quick video with you.', route: 'review' },
  ];
  if (ctx.recall) {
    lines.push({
      title: `Before bed: ${ctx.recall.text}`,
      body: 'Remember what it means? One video and you will.',
      route: 'review',
    });
  }
  return pick(lines, day, 8);
}
