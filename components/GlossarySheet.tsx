'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Video } from '@/types';
import { storage } from '@/lib/storage';
import { buildGlossary, type GlossaryEntry } from '@/lib/glossary';
import { glossText, lookupGloss } from '@/lib/dictionary';
import { formatDue, MAX_BOX } from '@/lib/srs';
import { Sheet } from '@/components/Sheet';
import {
  CheckIcon,
  CloseIcon,
  PlusIcon,
  TrashIcon,
} from '@/components/icons/Icons';

type GlossarySheetProps = {
  video: Video;
  language: string;
  onClose: () => void;
};

const CHIP_STYLE: Record<GlossaryEntry['state'], string> = {
  // Three unmistakable reads: UNKNOWN is the bright, inverted chip — the one
  // state with an action left to take. LEARNING keeps its green box-number
  // style. KNOWN is dimmed to a whisper (done, no action) and collapsed
  // behind a toggle by default.
  known: 'bg-white/[0.04] text-muted/50',
  learning: 'bg-accent-soft text-accent',
  unknown: 'bg-text text-background',
};

/**
 * Per-video glossary bottom sheet: every spoken word, coloured by how well
 * the user knows it, with the coverage summary as the hero.
 *
 * Tapping a chip only INSPECTS: it fills the detail card with the word's
 * gloss and status. Saving is always an explicit "Save word" press on that
 * card (the same entry point into the Leitner flow as the subtitle
 * tap -> WordSheet save) with a visible confirmation — nothing here saves
 * silently.
 */
export function GlossarySheet({ video, language, onClose }: GlossarySheetProps) {
  const [savedWords, setSavedWords] = useState(() => storage.getSavedWords());
  const [calibrationKnown] = useState(() => storage.getCalibrationKnown());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [showKnown, setShowKnown] = useState(false);
  // The word saved from the detail card just now — drives the "Saved"
  // button confirmation and the chip's one-time glow as it flips to learning.
  const [justSavedKey, setJustSavedKey] = useState<string | null>(null);

  useEffect(
    () => storage.onWordsChanged(() => setSavedWords(storage.getSavedWords())),
    []
  );

  const { entries, knownCount, total } = useMemo(
    () => buildGlossary(video, savedWords, calibrationKnown),
    [video, savedWords, calibrationKnown]
  );

  const pct = total > 0 ? Math.round((knownCount / total) * 100) : 0;

  // Actionable words lead: unknown first, then learning, each in sentence
  // order. Known words render only behind the toggle below.
  const groups = useMemo(
    () => ({
      unknown: entries.filter((e) => e.state === 'unknown'),
      learning: entries.filter((e) => e.state === 'learning'),
      known: entries.filter((e) => e.state === 'known'),
    }),
    [entries]
  );

  // An all-known video would otherwise render an empty list.
  const knownVisible = showKnown || groups.unknown.length + groups.learning.length === 0;

  const selected = selectedKey
    ? entries.find((e) => e.key === selectedKey) ?? null
    : null;

  const handleTap = (entry: GlossaryEntry) => {
    setSelectedKey((k) => (k === entry.key ? null : entry.key));
    // The "Saved" confirmation lives only until the next interaction — a
    // revisited learning word shows its normal controls (status + remove).
    setJustSavedKey(null);
  };

  const handleSave = (entry: GlossaryEntry) => {
    // Same save path as the subtitle tap -> WordSheet save: per-word gloss
    // becomes the recall prompt, sentence translation only as fallback.
    const gloss = lookupGloss(video, entry.word.text);
    const cue = video.cues[entry.cueIndex];
    const { ok } = storage.saveWord({
      text: entry.word.text,
      translation:
        (gloss && glossText(gloss, language)) ??
        cue?.translations[language] ??
        cue?.translations.en ??
        '',
      videoId: video.id,
      cueIndex: entry.cueIndex,
    });
    // Only a verified write earns the confirmation state.
    if (ok) setJustSavedKey(entry.key);
  };

  const chip = (entry: GlossaryEntry) => (
    <button
      key={entry.key}
      type="button"
      onClick={() => handleTap(entry)}
      aria-label={`${entry.key} — ${entry.state}`}
      className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-[15px] font-semibold transition-all active:scale-95 ${
        CHIP_STYLE[entry.state]
      } ${entry.key === selectedKey ? 'ring-2 ring-accent' : ''} ${
        entry.key === justSavedKey ? 'animate-card-glow' : ''
      }`}
    >
      {entry.state === 'known' && (
        <CheckIcon width={12} height={12} className="text-muted/40" />
      )}
      {entry.state === 'learning' && (
        <span className="flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ring-1 ring-accent/60">
          {(entry.saved?.box ?? 0) + 1}
        </span>
      )}
      {entry.state === 'unknown' && (
        <PlusIcon width={12} height={12} className="text-background/70" />
      )}
      {entry.key}
    </button>
  );

  return (
    <Sheet onClose={onClose}>
      {/* Hero: coverage summary */}
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
            This video
          </p>
          <p className="mt-1 text-4xl font-bold tracking-tight text-text">
            You know <span className="text-accent">{pct}%</span>
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
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mb-4 mt-2 flex items-center justify-between">
        <p className="text-xs text-muted">
          {knownCount} of {total} words
        </p>
        {groups.unknown.length > 0 && (
          <p className="text-xs font-semibold text-muted">
            {groups.unknown.length} to learn
          </p>
        )}
      </div>

      {selected ? (
        <SelectedDetail
          entry={selected}
          video={video}
          language={language}
          justSaved={selected.key === justSavedKey}
          onSave={handleSave}
          onUnsave={(e) => {
            if (e.saved) storage.removeWord(e.saved.text, e.saved.videoId);
          }}
        />
      ) : (
        // Tap no longer saves, so teach the new gesture where the card will be.
        <div className="mb-3 rounded-2xl bg-surface p-4">
          <p className="text-sm leading-relaxed text-muted">
            Tap any word to see its translation.
          </p>
        </div>
      )}

      <div className="no-scrollbar -mx-1 max-h-[40dvh] min-h-[8rem] overflow-y-auto px-1 pb-6">
        <div className="flex flex-wrap gap-2">
          {groups.unknown.map(chip)}
          {groups.learning.map(chip)}
        </div>

        {groups.known.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setShowKnown((v) => !v)}
              aria-expanded={knownVisible}
              className="mt-4 flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:text-text"
            >
              <CheckIcon width={12} height={12} />
              {knownVisible
                ? 'Hide known'
                : `Show known (${groups.known.length})`}
            </button>
            {knownVisible && (
              <div className="mt-3 flex flex-wrap gap-2">
                {groups.known.map(chip)}
              </div>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

function SelectedDetail({
  entry,
  video,
  language,
  justSaved,
  onSave,
  onUnsave,
}: {
  entry: GlossaryEntry;
  video: Video;
  language: string;
  justSaved: boolean;
  onSave: (entry: GlossaryEntry) => void;
  onUnsave: (entry: GlossaryEntry) => void;
}) {
  const gloss = lookupGloss(video, entry.word.text);
  const text = gloss ? glossText(gloss, language) : null;
  const cue = video.cues[entry.cueIndex];
  const sentence = cue?.translations[language] ?? cue?.translations.en ?? '';

  return (
    <div className="animate-fade-in mb-3 rounded-2xl bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-3xl font-bold tracking-tight text-text">
            {entry.key}
            {gloss && gloss.lemma !== entry.key && (
              <span className="ml-2 text-sm font-normal text-muted">
                → {gloss.lemma} · {gloss.pos}
              </span>
            )}
          </p>
          {text ? (
            <p className="mt-1 text-base font-semibold text-accent">{text}</p>
          ) : (
            <p className="mt-1 text-base text-muted">≈ {sentence}</p>
          )}
          <p className="mt-1.5 text-xs text-muted">
            {entry.state === 'known' &&
              (entry.saved
                ? 'Known — earned by recall'
                : 'Known — you marked it or it’s a common word')}
            {entry.state === 'learning' &&
              entry.saved &&
              `Learning — box ${entry.saved.box + 1} of ${MAX_BOX + 1} · ${formatDue(
                entry.saved.dueAt
              )}`}
            {entry.state === 'unknown' && 'Not in your words yet'}
          </p>
        </div>
        {entry.state === 'learning' && entry.saved && !justSaved && (
          <button
            type="button"
            onClick={() => onUnsave(entry)}
            aria-label={`Remove "${entry.key}" from saved words`}
            className="shrink-0 rounded-full bg-surface-raised p-2.5 text-muted transition-colors hover:text-text"
          >
            <TrashIcon width={16} height={16} />
          </button>
        )}
      </div>

      {/* The one and only save action in this sheet — explicit and confirmed.
          After a verified save the entry re-renders as learning and the same
          slot shows the acknowledgement instead of flipping straight to the
          remove control. */}
      {entry.state === 'unknown' && (
        <button
          type="button"
          onClick={() => onSave(entry)}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-background transition-transform active:scale-95"
        >
          <PlusIcon width={14} height={14} />
          Save word
        </button>
      )}
      {justSaved && entry.state === 'learning' && (
        <div className="animate-fade-in mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-accent-soft px-4 py-2.5 text-sm font-semibold text-accent">
          <CheckIcon width={14} height={14} />
          Saved — first review {entry.saved ? formatDue(entry.saved.dueAt) : 'in 1 min'}
        </div>
      )}
    </div>
  );
}
