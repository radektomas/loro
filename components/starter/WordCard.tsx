'use client';

/**
 * One starter-deck word card: the word, its translation, and the know / don't
 * know sort. Everything else the user might want to read is deliberately absent
 * — no example sentence, no gloss notes — because the example is about to
 * arrive as real speech, and printing one here would spoil the clip.
 *
 * PROGRESS IS FRAMED AGAINST THE REWARD, never as a countdown. "2 more, then
 * you'll hear them" tells the user what they are working towards; "12 / 74"
 * (what this screen used to show) tells them how much chore is left. The card
 * therefore never learns the total word count — it only knows how many cards
 * stand between here and the clip.
 */

export function WordCard({
  word,
  translation,
  /** Cards after this one in the round. 0 = the clip is next. */
  remainingAfter,
  saveFailed,
  onAnswer,
}: {
  word: string;
  translation: string;
  remainingAfter: number;
  saveFailed: boolean;
  onAnswer: (knewIt: boolean) => void;
}) {
  const reward =
    remainingAfter === 0
      ? 'Last one — then you’ll hear all of them in a real clip.'
      : `${remainingAfter} more, then you’ll see them in the clip.`;

  return (
    <>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center text-center">
        {/* key remounts per word so the fade replays on every card. */}
        <div key={word} className="animate-fade-in w-full">
          <p className="text-5xl font-bold tracking-tight text-text">{word}</p>
          <p className="mt-3 text-xl text-muted">{translation}</p>
          <p className="mt-8 text-sm font-medium text-accent">{reward}</p>
        </div>
      </div>

      <div className="mx-auto w-full max-w-md pb-6">
        {saveFailed && (
          <p className="mb-3 text-center text-xs text-red-400" role="alert">
            Couldn’t save that word — your browser storage may be full.
          </p>
        )}
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => onAnswer(false)}
            className="flex-1 rounded-2xl bg-surface py-4 text-lg font-bold text-text transition-transform hover:bg-surface-raised active:scale-[0.98]"
          >
            Don’t know yet
          </button>
          <button
            type="button"
            onClick={() => onAnswer(true)}
            className="flex-1 rounded-2xl bg-accent py-4 text-lg font-bold text-background transition-transform active:scale-[0.98]"
          >
            I know it
          </button>
        </div>
      </div>
    </>
  );
}
