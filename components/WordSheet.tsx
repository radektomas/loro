'use client';

import type { Cue, Word } from '@/types';
import { CloseIcon, BookmarkIcon } from '@/components/icons/Icons';
import { LoroMascot } from '@/components/LoroMascot';

export type WordSheetData = {
  word: Word;
  cue: Cue;
  cueIndex: number;
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
  // TODO(dictionary): replace this with a real per-word dictionary lookup.
  // For now we surface the whole-cue translation as context for the word.
  const contextTranslation =
    data.cue.translations[language] ?? data.cue.translations.en;

  return (
    <div className="absolute inset-0 z-30" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 animate-fade-in"
      />
      <div className="absolute inset-x-0 bottom-0 animate-sheet-up rounded-t-3xl bg-surface-raised px-6 pt-5 pb-safe shadow-[0_-8px_40px_rgba(0,0,0,0.5)]">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-text/15" />
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="text-3xl font-bold tracking-tight text-text">
              {data.word.text}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {contextTranslation}
            </p>
            <p className="mt-1 text-xs text-muted/60">
              From the sentence — word-level dictionary coming soon
            </p>
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
            <LoroMascot state={saved ? 'happy' : 'idle'} size={56} />
          </div>
        </div>
      </div>
    </div>
  );
}
