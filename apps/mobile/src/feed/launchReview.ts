import type { SavedWord } from '@loro/core/types';
import { storage } from '@loro/core/storage';
import { getCatalog } from '@loro/core/catalog';
import { pickFirstBlankTarget, pickReviewTarget } from '@loro/core/occurrences';
import { track } from '../platform/analytics';
import { enableRecallForSession } from './recall';
import { requestReviewTarget } from './reviewTarget';

/**
 * THE ONE WAY INTO A REVIEW SESSION — for every door that promises one.
 *
 * Three surfaces say "N words ready" and offer a button: the Words tab's
 * card, the Progress tab's Reviews card, and the daily reminder itself.
 * Until 2026-09-07 only the first of them actually pointed the feed at a
 * due word; the other two called enableRecallForSession() and switched tab,
 * which with RECALL_ENABLED already true is a no-op followed by a random
 * video. Measured on the newest real user: 178 due words, 57 of them buried
 * in already-watched videos the shuffle had no reason to resurface. The
 * reminder said "5 words ready", the feed showed none, and they left.
 *
 * So every door now does the same three things, in this order:
 *   1. find the first due word the catalog will actually BLANK
 *      (pickFirstBlankTarget — the Words tab's own logic, moved here);
 *   2. park it for the feed (requestReviewTarget), which also re-cuts the
 *      feed so the videos after the landing carry more due words
 *      (FeedScreen listens for the same request);
 *   3. arm recall and report the launch, with whether it landed, so the
 *      dashboard can finally see which door works.
 *
 * The caller switches tab afterwards — Shell owns tabs, and the Words tab
 * has its own modal-dismissal dance to run first (VocabScreen).
 */
export type ReviewSource = 'words' | 'progress' | 'notification';

export type ReviewLaunch = {
  /** Due words at the moment of the tap. */
  due: number;
  /** A landing was parked — the feed will jump. */
  landed: boolean;
  /** ...and the landing will genuinely blank the word, not merely speak it. */
  willBlank: boolean;
  /** The word the feed was pointed at, for logs. */
  word: string | null;
};

export function launchReview(source: ReviewSource): ReviewLaunch {
  const all = storage.getSavedWords();
  const at = Date.now();
  // Most urgent first: slipped words, then earliest due.
  const due = all
    .filter((w) => w.dueAt <= at)
    .sort(
      (a, b) =>
        Number(b.state === 'lapsed') - Number(a.state === 'lapsed') ||
        a.dueAt - b.dueAt
    );
  const found =
    due.length > 0 ? pickFirstBlankTarget(getCatalog(), due, all, { now: at }) : null;

  if (found) {
    requestReviewTarget({
      videoId: found.landing.videoId,
      word: found.word.text,
      startsAt: found.landing.startsAt,
    });
    console.log(
      `[loro:review] ${source} -> "${found.word.text}" in ${found.landing.videoId} ` +
        `@${found.landing.startsAt.toFixed(1)}s` +
        (found.landing.willBlank ? '' : ' (SPOKEN ONLY — no due word blanks anywhere)')
    );
  } else if (due.length > 0) {
    console.log(
      `[loro:review] ${source}: none of ${due.length} due word(s) is spoken in ` +
        'the catalog — no jump parked'
    );
  } else {
    console.log(`[loro:review] ${source}: nothing due — plain feed`);
  }

  enableRecallForSession();

  const launch: ReviewLaunch = {
    due: due.length,
    landed: found !== null,
    willBlank: found?.landing.willBlank ?? false,
    word: found?.word.text ?? null,
  };
  track('review_started', {
    source,
    due: launch.due,
    landed: launch.landed,
    willBlank: launch.willBlank,
  });
  return launch;
}

/**
 * REVIEW ONE CHOSEN WORD — the Progress picker's launch.
 *
 * The same jump the Words tab's detail sheet makes (VocabScreen.reviewWord),
 * with the same two conditions or the button lies: the word must be DUE, or
 * computeBlankPlan will not blank it (reviewNow brings it forward; a no-op
 * for a word the picker listed as ready), and the feed must land somewhere
 * the word is genuinely ASKED — pickReviewTarget runs the real plan against
 * each candidate video and returns the cue and second, so the feed opens
 * three seconds before the word rather than at the top of a clip. A word no
 * video speaks falls back to the plain armed feed; the picker greys those
 * out, so it should not happen from there.
 */
export function launchReviewOfWord(word: SavedWord, source: ReviewSource): ReviewLaunch {
  storage.reviewNow(word.text, word.videoId);
  const all = storage.getSavedWords();
  const at = Date.now();
  const target = pickReviewTarget(getCatalog(), word, all, { now: at });
  if (target) {
    requestReviewTarget({ videoId: target.videoId, word: word.text, startsAt: target.startsAt });
    console.log(
      `[loro:review] ${source} picked "${word.text}" -> ${target.videoId} ` +
        `@${target.startsAt.toFixed(1)}s` + (target.willBlank ? '' : ' (SPOKEN ONLY)')
    );
  } else {
    console.log(`[loro:review] ${source} picked "${word.text}": spoken nowhere — plain feed`);
  }
  enableRecallForSession();
  const launch: ReviewLaunch = {
    due: all.filter((w) => w.dueAt <= at).length,
    landed: target !== null,
    willBlank: target?.willBlank ?? false,
    word: word.text,
  };
  track('review_started', {
    source,
    due: launch.due,
    landed: launch.landed,
    willBlank: launch.willBlank,
    picked: true,
  });
  return launch;
}
