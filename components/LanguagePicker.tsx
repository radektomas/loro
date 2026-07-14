'use client';

import { useState } from 'react';
import { languageLabel } from '@/lib/languages';
import { CheckIcon, CloseIcon, GlobeIcon } from '@/components/icons/Icons';

type LanguagePickerProps = {
  /** Language codes discovered from the seed data — never hardcoded. */
  languages: string[];
  value: string;
  onChange: (code: string) => void;
};

/**
 * Pill in the top-right of the feed; opens a sheet listing every
 * translation language present in the data.
 */
export function LanguagePicker({ languages, value, onChange }: LanguagePickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-black/40 px-3.5 py-2 text-sm font-medium text-text backdrop-blur-md transition-colors hover:bg-black/55"
      >
        <GlobeIcon width={15} height={15} className="text-accent" />
        {languageLabel(value)}
      </button>

      {open && (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/50 animate-fade-in"
          />
          <div className="absolute inset-x-0 bottom-0 animate-sheet-up rounded-t-3xl bg-surface-raised px-4 pt-5 pb-safe shadow-[0_-8px_40px_rgba(0,0,0,0.5)]">
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-text/15" />
            <div className="mb-3 flex items-center justify-between px-2">
              <h2 className="text-lg font-semibold text-text">Translate to</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-full bg-surface p-2 text-muted transition-colors hover:text-text"
              >
                <CloseIcon width={16} height={16} />
              </button>
            </div>
            <ul className="mb-6 space-y-1">
              {languages.map((code) => (
                <li key={code}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(code);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-2xl px-4 py-3.5 text-left text-base transition-colors ${
                      code === value
                        ? 'bg-accent-soft font-semibold text-accent'
                        : 'text-text hover:bg-surface'
                    }`}
                  >
                    {languageLabel(code)}
                    {code === value && <CheckIcon width={18} height={18} />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
