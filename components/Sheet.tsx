'use client';

import type { ReactNode } from 'react';

/**
 * The shared slide-up bottom-sheet shell used over a feed slide: tap-to-close
 * scrim, rounded top, grab handle. The parent pauses the video while any
 * sheet is open and resumes it on close.
 */
export function Sheet({
  onClose,
  children,
}: {
  onClose: () => void;
  children: ReactNode;
}) {
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
        {children}
      </div>
    </div>
  );
}
