import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EMPTY_SAVE_PROMPT_STATE,
  SAVE_PROMPT,
  savePromptVariant,
  type SavePromptState,
} from './savePrompt.ts';

const state = (p: Partial<SavePromptState>): SavePromptState => ({
  ...EMPTY_SAVE_PROMPT_STATE,
  ...p,
});
const shown = (words: number) => ({ shownAt: 1, words, outcome: 'shown' as const });
const dismissed = (words: number) => ({ shownAt: 1, words, outcome: 'dismissed' as const });

const onVocab = { signedIn: false, surface: 'vocab' as const };

describe('savePromptVariant', () => {
  it('does not appear below the threshold', () => {
    assert.equal(
      savePromptVariant(EMPTY_SAVE_PROMPT_STATE, {
        ...onVocab,
        savedCount: SAVE_PROMPT.FIRST_AT_WORDS - 1,
      }),
      null
    );
  });

  it('appears at the threshold for an anonymous user on vocab', () => {
    assert.equal(
      savePromptVariant(EMPTY_SAVE_PROMPT_STATE, {
        ...onVocab,
        savedCount: SAVE_PROMPT.FIRST_AT_WORDS,
      }),
      1
    );
  });

  it('never appears for signed-in users', () => {
    assert.equal(
      savePromptVariant(EMPTY_SAVE_PROMPT_STATE, {
        signedIn: true,
        surface: 'vocab',
        savedCount: 999,
      }),
      null
    );
  });

  it('never mounts from the feed (or anywhere but vocab)', () => {
    for (const surface of ['feed', 'other'] as const) {
      assert.equal(
        savePromptVariant(state({ sessions: 99 }), {
          signedIn: false,
          surface,
          savedCount: 999,
        }),
        null
      );
    }
  });

  it('a pending (crashed mid-show) prompt 1 re-shows; a dismissed one does not', () => {
    const ctx = { ...onVocab, savedCount: SAVE_PROMPT.FIRST_AT_WORDS };
    assert.equal(savePromptVariant(state({ p1: shown(10) }), ctx), 1);
    assert.equal(savePromptVariant(state({ p1: dismissed(10) }), ctx), null);
  });

  it('dismissal persists: prompt 2 waits for ITS threshold', () => {
    const s = state({ p1: dismissed(10) });
    assert.equal(
      savePromptVariant(s, { ...onVocab, savedCount: SAVE_PROMPT.SECOND_AT_WORDS - 1 }),
      null
    );
  });

  it('prompt 2 fires at the word threshold OR the session threshold', () => {
    assert.equal(
      savePromptVariant(state({ p1: dismissed(10) }), {
        ...onVocab,
        savedCount: SAVE_PROMPT.SECOND_AT_WORDS,
      }),
      2
    );
    assert.equal(
      savePromptVariant(
        state({ p1: dismissed(10), sessions: SAVE_PROMPT.SECOND_AT_SESSIONS }),
        { ...onVocab, savedCount: SAVE_PROMPT.FIRST_AT_WORDS }
      ),
      2
    );
  });

  it('after prompt 2 is dismissed, nothing ever fires again', () => {
    const s = state({ p1: dismissed(10), p2: dismissed(30), sessions: 50 });
    assert.equal(savePromptVariant(s, { ...onVocab, savedCount: 500 }), null);
  });

  it('a converted prompt 1 ends the sequence (they have an account)', () => {
    const s = state({ p1: { shownAt: 1, words: 12, outcome: 'converted' } });
    assert.equal(savePromptVariant(s, { ...onVocab, savedCount: 500 }), null);
  });
});
