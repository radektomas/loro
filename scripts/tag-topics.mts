/**
 * WHAT EACH VIDEO IS ABOUT — the "for you" topics (Radek, 2026-10-06: a
 * question in onboarding, "and the feed leans that way ... I would still show
 * other topics, just less").
 *
 * The harvest's topic_tags are the SEARCH that found a video ("conversation",
 * "talking-head"), not what it is about, and nothing in them says love or
 * money or funny. So each video is read once — its channel and its first
 * lines, Spanish and English — by the cheap model, which picks 0-2 of the
 * TOPICS below. Cached per video in data/videoTopics.json: a re-run only pays
 * for new videos. score-videos.mts ships the result inside feed/scores.json,
 * so new tags reach installed apps without a release.
 *
 *   node scripts/tag-topics.mts           (tags untagged videos, ~$0.0001 each)
 *
 * The ids are stored on devices (loro.mobile.topics) and in the onboarding
 * step — do not rename them.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv, REPO_ROOT } from './lib/env.mts';
import { chatJson } from './lib/glossCues.mts';
import { setBudget, spentUsd } from './lib/openaiCost.mts';

export const TOPIC_IDS = ['travel', 'food', 'love', 'money', 'funny', 'mind'] as const;
const DESCRIBE: Record<(typeof TOPIC_IDS)[number], string> = {
  travel: 'travel, places, cities, countries, living abroad, transport',
  food: 'food, cooking, eating, restaurants, drinks',
  love: 'love, dating, relationships, couples, family, friends',
  money: 'money, salaries, jobs, work, careers, prices, business, law',
  funny: 'humour, pranks, jokes, everyday life moments, street questions for fun',
  mind: 'health, body, fitness, sport, psychology, self-improvement, books',
};
const CACHE = path.join(REPO_ROOT, 'data', 'videoTopics.json');
const SOURCES = ['embedVideos.json'];
const BATCH = 25;
const MODEL = 'gpt-4o-mini';

type V = { id: string; attribution?: { channelTitle?: string }; creator?: string; cues: { words: { text: string }[]; translations?: Record<string, string> }[] };
const videos: V[] = SOURCES.flatMap((f) => JSON.parse(readFileSync(path.join(REPO_ROOT, 'data', f), 'utf8')));
const cache: Record<string, string[]> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
const todo = videos.filter((v) => !(v.id in cache));
console.log(`${videos.length} videos, ${todo.length} to tag`);

loadEnv();
setBudget(0.5);
const describe = TOPIC_IDS.map((t) => `${t}: ${DESCRIBE[t]}`).join('\n');
for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH);
  const lines = batch.map((v) => {
    const es = v.cues.slice(0, 6).map((c) => c.words.map((w) => w.text).join(' ')).join(' ').slice(0, 300);
    const en = v.cues.slice(0, 6).map((c) => c.translations?.en ?? '').join(' ').slice(0, 300);
    return `[${v.id}] channel "${v.attribution?.channelTitle ?? v.creator ?? ''}" — ${es} — (${en})`;
  });
  const prompt =
    `Each line is a short Spanish video: its id, channel and first sentences. Pick what each video is ABOUT ` +
    `from these topics (0, 1 or 2 per video; none if nothing fits):\n${describe}\n\n` +
    `Return JSON {"topics": {"<id>": ["travel"], ...}} with every id.\n\n${lines.join('\n')}`;
  const out = (await chatJson(prompt, MODEL)) as { topics?: Record<string, unknown> };
  for (const v of batch) {
    const got = out.topics?.[v.id];
    if (!Array.isArray(got)) continue;
    cache[v.id] = got.filter((t): t is string => (TOPIC_IDS as readonly string[]).includes(String(t))).slice(0, 2);
  }
  const sorted = Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(CACHE, JSON.stringify(sorted) + '\n');
  console.log(`  tagged ${Math.min(i + BATCH, todo.length)}/${todo.length}  $${spentUsd().toFixed(4)}`);
}
const counts = Object.fromEntries(TOPIC_IDS.map((t) => [t, Object.values(cache).filter((ts) => ts.includes(t)).length]));
console.log('per topic', counts, 'none', Object.values(cache).filter((ts) => ts.length === 0).length, `spent $${spentUsd().toFixed(4)}`);
