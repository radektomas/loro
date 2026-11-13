import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MarketingPost } from '../../../lib/marketingStats.ts';
import {
  baselineAt,
  cleanCoverText,
  inferHookKind,
  line1Variant,
  rankBy,
  scorePosts,
  textSimilarity,
  trackRecord,
  verdictOf,
  voiceOf,
  type PostTags,
} from '../../../lib/scaleStats.ts';

const NOW = new Date('2026-11-11T12:00:00Z');

function post(id: string, postedAt: string, views: number | null, igUserId = 'A', comments: number | null = null): MarketingPost {
  return {
    mediaId: id,
    igUserId,
    caption: null,
    mediaType: 'VIDEO',
    productType: 'REELS',
    permalink: null,
    thumbnailUrl: null,
    postedAt,
    latest:
      views === null
        ? null
        : { views, reach: null, likes: null, comments, shares: null, saved: null, reposts: null, avgWatchMs: null, skipRate: null, viewTotalMs: null },
    viewsByDay: [],
  };
}

function tags(hook: string | null, extra: Partial<PostTags> = {}): PostTags {
  return {
    hook,
    hookSource: hook ? 'cover' : null,
    hookKind: null,
    format: 'other',
    demoKind: 'unknown',
    line1Variant: null,
    voice: null,
    cutReelId: null,
    manual: false,
    ...extra,
  };
}

test('baselineAt scores a reel against the posts before it, not later ones', () => {
  const posts = [
    post('a', '2026-10-01T10:00:00Z', 100),
    post('b', '2026-10-05T10:00:00Z', 200),
    post('c', '2026-10-10T10:00:00Z', 300),
    post('later', '2026-10-25T10:00:00Z', 90000),
    post('other-account', '2026-10-09T10:00:00Z', 5000, 'B'),
  ];
  assert.equal(baselineAt(posts, 'A', new Date('2026-10-20T10:00:00Z')), 200);
});

test('baselineAt skips posts under 48h before the reel', () => {
  const posts = [
    post('a', '2026-10-01T10:00:00Z', 100),
    post('b', '2026-10-02T10:00:00Z', 100),
    post('c', '2026-10-03T10:00:00Z', 100),
    post('recent', '2026-10-19T10:00:00Z', 9999),
  ];
  assert.equal(baselineAt(posts, 'A', new Date('2026-10-20T10:00:00Z')), 100);
});

test('a baseline needs 3 earlier settled reels: 1 or 2 would make fake 10x winners', () => {
  const posts = [post('a', '2026-10-01T10:00:00Z', 50), post('b', '2026-10-03T10:00:00Z', 500), post('c', '2026-10-06T10:00:00Z', 600)];
  assert.equal(baselineAt(posts, 'A', new Date('2026-10-06T10:00:00Z')), null);
  const by = Object.fromEntries(scorePosts(posts, new Map(), NOW).map((x) => [x.mediaId, x]));
  assert.equal(by.b.multiple, null);
  assert.equal(by.c.multiple, null);
});

test('a channel with no earlier settled posts has no baseline and no multiple', () => {
  const posts = [post('first', '2026-10-01T10:00:00Z', 500)];
  assert.equal(baselineAt(posts, 'A', new Date('2026-10-01T10:00:00Z')), null);
  const [s] = scorePosts(posts, new Map(), NOW);
  assert.equal(s.baseline, null);
  assert.equal(s.multiple, null);
});

test('scorePosts gives multiple, comments per 1k and settled', () => {
  const posts = [
    post('a', '2026-10-01T10:00:00Z', 100),
    post('b', '2026-10-02T10:00:00Z', 100),
    post('b2', '2026-10-03T10:00:00Z', 100),
    post('hit', '2026-10-10T10:00:00Z', 400, 'A', 8),
    post('fresh', '2026-11-11T06:00:00Z', 50),
  ];
  const by = Object.fromEntries(scorePosts(posts, new Map(), NOW).map((s) => [s.mediaId, s]));
  assert.equal(by.hit.multiple, 4);
  assert.equal(by.hit.commentsPer1k, 20);
  assert.equal(by.hit.settled, true);
  assert.equal(by.fresh.settled, false);
});

test('verdicts need 3 reels to call a winner', () => {
  assert.equal(verdictOf(3, 1.5), 'winning');
  assert.equal(verdictOf(2, 4), 'promising');
  assert.equal(verdictOf(5, 0.7), 'losing');
  assert.equal(verdictOf(5, 1.0), 'ordinary');
  assert.equal(verdictOf(1, null), 'ordinary');
});

test('rankBy hook groups the same hook despite emoji and case, and skips unsettled reels', () => {
  const base = [post('p1', '2026-09-01T10:00:00Z', 100), post('p2', '2026-09-02T10:00:00Z', 100), post('p3', '2026-09-03T10:00:00Z', 100)];
  const posts = [
    ...base,
    post('h1', '2026-10-01T10:00:00Z', 300),
    post('h2', '2026-10-03T10:00:00Z', 200),
    post('h3', '2026-10-05T10:00:00Z', 250),
    post('h4-fresh', '2026-11-11T09:00:00Z', 10),
    post('q1', '2026-10-07T10:00:00Z', 50),
  ];
  const t = new Map<string, PostTags>([
    ['h1', tags('Day 400 of my streak 😭')],
    ['h2', tags('day 400 of my streak')],
    ['h3', tags('DAY 400 of my streak!!')],
    ['h4-fresh', tags('Day 400 of my streak')],
    ['q1', tags('Why is your Spanish so good?')],
  ]);
  const rows = rankBy(scorePosts(posts, t, NOW), 'hook');
  const day = rows.find((r) => r.key === 'day 400 of my streak')!;
  assert.equal(day.n, 3);
  assert.equal(day.verdict, 'winning');
  assert.deepEqual(day.examples, ['h1', 'h3', 'h2']); // by multiple: 3x, 2.5x, 2x
  assert.equal(rows[0].key, 'day 400 of my streak');
  assert.equal(rows.find((r) => r.key === 'why is your spanish so good')!.n, 1);
});

test('cleanCoverText keeps the big hook lines and drops the small background text', () => {
  assert.equal(
    cleanCoverText([
      { text: '3 years of studying', h: 0.05 },
      { text: 'Spanish and i just find', h: 0.05 },
      { text: 'this now... like wtfo', h: 0.042 },
      { text: 'Is green pools', h: 0.016 },
      { text: 'The da', h: 0.015 },
      { text: 'No le so You dost IF :2', h: 0.025 },
    ]),
    '3 years of studying Spanish and i just find this now... like wtf'
  );
  assert.equal(
    cleanCoverText([
      { text: 'Day 400 of my streak', h: 0.042 },
      { text: 'and i still cant order a', h: 0.034 },
      { text: 'coffee', h: 0.034 },
    ]),
    'Day 400 of my streak and i still cant order a coffee'
  );
});

test('cleanCoverText returns null for noise or nothing', () => {
  assert.equal(cleanCoverText([{ text: 'гV(+5+22201', h: 0.05 }]), null);
  assert.equal(cleanCoverText([]), null);
  assert.equal(cleanCoverText([{ text: 'ok', h: 0.05 }]), null);
});

test('hook kind, line 1 variant and voice', () => {
  assert.equal(inferHookKind('"How did you learn 1000 words??"😭'), 'question');
  assert.equal(inferHookKind('3 years of studying Spanish and i just find this now'), 'statement');
  assert.equal(line1Variant('ummm by literally scrolling Spanish reels'), 'reels');
  assert.equal(line1Variant('Learn by literally watching Spanish Peppa Pig'), 'peppa');
  assert.equal(line1Variant('mmm i started with the app'), 'i started with the');
  assert.equal(line1Variant('The English is right under every line'), 'the english is right');
  assert.equal(voiceOf(['The app makes you write the words you hear']), 'you');
  assert.equal(voiceOf(['The app makes me write the words i hear']), 'i');
  assert.equal(voiceOf(['Spanish Peppa Pig']), null);
});

test('textSimilarity', () => {
  assert.equal(textSimilarity('Day 400 of my streak', 'day 400 of my streak'), 1);
  assert.ok(textSimilarity('Day 400 of my streak', 'Some people STILL use duolingo') < 0.3);
  assert.equal(textSimilarity('', 'x'), 0);
});

test('trackRecord compares exploit with test and counts hits', () => {
  const r = trackRecord([
    { role: 'exploit', expected: 2, actual: 3 },
    { role: 'exploit', expected: 2, actual: 1 },
    { role: 'exploit', expected: 2, actual: 2.5 },
    { role: 'test', expected: 1, actual: 0.5 },
    { role: 'test', expected: 1, actual: null },
  ]);
  assert.deepEqual(r.exploit, { n: 3, median: 2.5 });
  assert.deepEqual(r.test, { n: 1, median: 0.5 });
  assert.equal(r.hitRate, 0.5);
  assert.equal(trackRecord([]).hitRate, null);
});

test('cleanCoverText drops an emoji misread after ?? and mends words split across lines', async () => {
  assert.equal(
    cleanCoverText([
      { text: '"How did you get soo', h: 0.04 },
      { text: 'good in Spanish soo', h: 0.04 },
      { text: '-quick?? t"', h: 0.04 },
    ]),
    '"How did you get soo good in Spanish soo quick??"'
  );
  assert.equal(cleanCoverText([{ text: '"How did your Spanish', h: 0.04 }, { text: 'improve SO MUCH in', h: 0.04 }, { text: 'just one month??t"', h: 0.04 }]), '"How did your Spanish improve SO MUCH in just one month??"');
  assert.equal(cleanCoverText([{ text: 'Things a Spanish-', h: 0.04 }, { text: 'speaking Mom will say to', h: 0.04 }, { text: 'you', h: 0.04 }]), 'Things a Spanish-speaking Mom will say to you');
});

test('inferFormat spots phrase reels by their hook', async () => {
  const { inferFormat } = await import('../../../lib/scaleStats.ts');
  assert.equal(inferFormat('Things to say at a restaurant in Spanish'), 'phrases');
  assert.equal(inferFormat('Spanish phrases to use in a bar'), 'phrases');
  assert.equal(inferFormat('Things a Spanish-speaking Mom will say to you'), 'phrases');
  assert.equal(inferFormat('"Why is your Spanish SO much better than last month??"'), 'other');
});

test('hook families: near-identical wordings rank together', async () => {
  const { hookFamilies } = await import('../../../lib/scaleStats.ts');
  const fam = hookFamilies([
    'How did you memorize 1000 Spanish words in just ONE MONTH??',
    'How did you memorize 2000 Spanish words in ONE MONTH',
    'how did you memorize 2000 spanish words in one month',
    'Youre still trying to learn Spanish with Duolingo??',
    'Stages of love in Spanish',
  ]);
  const a = fam.get('how did you memorize 2000 spanish words in one month');
  assert.equal(fam.get('how did you memorize 1000 spanish words in just one month'), a);
  assert.notEqual(fam.get('youre still trying to learn spanish with duolingo'), a);
  assert.notEqual(fam.get('stages of love in spanish'), fam.get('youre still trying to learn spanish with duolingo'));
});

test('rankBy hook counts a family as one row, labelled by its most common wording', () => {
  const base = [post('p1', '2026-09-01T10:00:00Z', 100), post('p2', '2026-09-02T10:00:00Z', 100), post('p3', '2026-09-03T10:00:00Z', 100)];
  const posts = [...base, post('a', '2026-10-01T10:00:00Z', 300), post('b', '2026-10-03T10:00:00Z', 300), post('c', '2026-10-05T10:00:00Z', 300)];
  const t = new Map<string, PostTags>([
    ['a', tags('How did you memorize 1000 Spanish words in just ONE MONTH??')],
    ['b', tags('How did you memorize 2000 Spanish words in ONE MONTH')],
    ['c', tags('How did you memorize 2000 Spanish words in ONE MONTH')],
  ]);
  const rows = rankBy(scorePosts(posts, t, NOW), 'hook');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].n, 3);
  assert.equal(rows[0].label, 'How did you memorize 2000 Spanish words in ONE MONTH');
  assert.equal(rows[0].variants, 2);
});

test('cleanCoverText drops digit junk an emoji leaves at the end', () => {
  assert.equal(cleanCoverText([{ text: '"How did you memorize 1000', h: 0.04 }, { text: 'Spanish words in just', h: 0.04 }, { text: 'ONE MONTH83 6', h: 0.04 }]), '"How did you memorize 1000 Spanish words in just ONE MONTH');
  assert.equal(cleanCoverText([{ text: 'Some people still use', h: 0.04 }, { text: 'Duolingo to learn Spanish 0', h: 0.04 }]), 'Some people still use Duolingo to learn Spanish');
  assert.equal(cleanCoverText([{ text: '3000 Spanish words in 40', h: 0.04 }, { text: 'seconds', h: 0.04 }]), '3000 Spanish words in 40 seconds');
});

test('inferFormat also knows the explainer phrase reels', async () => {
  const { inferFormat } = await import('../../../lib/scaleStats.ts');
  for (const h of ['Basic Spanish phrases i learned with Loro: hello = hola', 'How to call a latina beautiful in Spanish', 'Spanish words you NEED when dating', 'Stages of love in Spanish', 'How to flirt with your latina mamii'])
    assert.equal(inferFormat(h), 'phrases', h);
  assert.equal(inferFormat('How did you learn 2000 Spanish words so FAST?'), 'other');
});

test('cleanCoverText cleans junk that sits before a closing quote', () => {
  assert.equal(cleanCoverText([{ text: '"How did you get fluent', h: 0.04 }, { text: 'in Spanish SO FAST838"', h: 0.04 }]), '"How did you get fluent in Spanish SO FAST"');
  assert.equal(cleanCoverText([{ text: '"Youre still trying to', h: 0.04 }, { text: 'learn Spanish with Duolingo • "', h: 0.04 }]), '"Youre still trying to learn Spanish with Duolingo"');
});

test('a hook that won before but flopped in its last 3 reels is fading, not winning', () => {
  const base = [post('p1', '2026-09-01T10:00:00Z', 1000), post('p2', '2026-09-02T10:00:00Z', 1000), post('p3', '2026-09-03T10:00:00Z', 1000)];
  const posts = [
    ...base,
    post('w1', '2026-09-10T10:00:00Z', 5000),
    post('w2', '2026-09-12T10:00:00Z', 4000),
    post('w3', '2026-09-14T10:00:00Z', 4500),
    post('f1', '2026-11-01T10:00:00Z', 250),
    post('f2', '2026-11-03T10:00:00Z', 260),
    post('f3', '2026-11-05T10:00:00Z', 246),
  ];
  const t = new Map<string, PostTags>(['w1', 'w2', 'w3', 'f1', 'f2', 'f3'].map((id) => [id, tags('Been learning Spanish for 3+ years and i just found this')]));
  const [row] = rankBy(scorePosts(posts, t, NOW), 'hook');
  assert.equal(row.n, 6);
  assert.ok(row.recentMedian! < 0.3, String(row.recentMedian));
  assert.equal(row.verdict, 'fading');
});

test('a hook still winning lately keeps winning', () => {
  const base = [post('p1', '2026-09-01T10:00:00Z', 1000), post('p2', '2026-09-02T10:00:00Z', 1000), post('p3', '2026-09-03T10:00:00Z', 1000)];
  const posts = [...base, post('a', '2026-10-01T10:00:00Z', 2000), post('b', '2026-10-03T10:00:00Z', 2500), post('c', '2026-10-05T10:00:00Z', 1800)];
  const t = new Map<string, PostTags>(['a', 'b', 'c'].map((id) => [id, tags('Youre still trying to learn Spanish with Duolingo??')]));
  const [row] = rankBy(scorePosts(posts, t, NOW), 'hook');
  assert.equal(row.verdict, 'winning');
  assert.ok(row.recentMedian! >= 1.5);
});
