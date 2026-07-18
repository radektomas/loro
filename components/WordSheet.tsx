'use client';

import type { Cue, Gloss, Word } from '@/types';
import { glossText, normalizeSurface } from '@/lib/dictionary';
import { CloseIcon, BookmarkIcon } from '@/components/icons/Icons';
import { LoroMascot } from '@/components/LoroMascot';
import { Sheet } from '@/components/Sheet';

export type WordSheetData = {
  word: Word;
  cue: Cue;
  cueIndex: number;
  /** dictionary entry for this word, or null if it's somehow missing */
  gloss: Gloss | null;
};

type WordSheetProps = {
  data: WordSheetData;
  language: string;
  saved: boolean;
  onSave: () => void;
  onClose: () => void;
};

/**
 * Bottom sheet shown when a Spanish word is tapped. The video is paused
 * by the parent while this is open and resumed on close.
 */
export function WordSheet({ data, language, saved, onSave, onClose }: WordSheetProps) {
  const { word, cue, gloss } = data;
  const contextTranslation =
    cue.translations[language] ?? cue.translations.en ?? '';
  const wordGloss = gloss ? glossText(gloss, language) : null;
  const surface = normalizeSurface(word.text);
  const showLemma = gloss && wordGloss && gloss.lemma !== surface;

  return (
    <Sheet onClose={onClose}>
      <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="text-3xl font-bold tracking-tight text-text">
              {word.text}
            </p>

            {wordGloss ? (
              <>
                <p className="mt-1.5 text-xl font-semibold text-accent">
                  {wordGloss}
                </p>
                {showLemma && (
                  <p className="mt-1.5 text-xs text-muted">
                    {surface} → {gloss.lemma} · {gloss.pos}
                  </p>
                )}
                {gloss?.note && (
                  <p className="mt-1 text-xs italic text-muted">{gloss.note}</p>
                )}
                <p className="mt-3 text-xs leading-relaxed text-muted/60">
                  In this sentence:{' '}
                  <span className="text-muted">{contextTranslation}</span>
                </p>
              </>
            ) : (
              // No dictionary entry — fall back to the sentence translation,
              // clearly marked approximate instead of posing as a word gloss.
              <>
                <p className="mt-1.5 text-base leading-relaxed text-text/85">
                  ≈ {contextTranslation}
                </p>
                <p className="mt-1 text-xs text-amber-400/90">
                  approximate — whole-sentence translation
                </p>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-4 shrink-0 rounded-full bg-surface p-2 text-muted transition-colors hover:text-text"
          >
            <CloseIcon width={18} height={18} />
          </button>
        </div>
        <div className="mt-6 mb-6 flex items-center gap-3">
          <button
            type="button"
            onClick={onSave}
            disabled={saved}
            className={`flex flex-1 items-center justify-center gap-2 rounded-2xl py-3.5 text-base font-semibold transition-all active:scale-[0.98] ${
              saved
                ? 'bg-accent-soft text-accent'
                : 'bg-accent text-background hover:brightness-110'
            }`}
          >
            <BookmarkIcon width={18} height={18} />
            {saved ? 'Saved' : 'Save word'}
          </button>
          <div className="shrink-0">
            {/* 'happy' is reserved for correct typed recall, not saving */}
            <LoroMascot state="idle" size={56} />
          </div>
        </div>
    </Sheet>
  );
}
