This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## UGC: creators & admin review

Creator pipeline screens (step 2 of the UGC pipeline; the n8n import workflow is step 1):

- `/creator/apply` — application form; shows pending/approved/rejected status after applying.
- `/creator` — approved-creator dashboard: videos, learning impact (words saved / mastered per video — the future revenue-share metric).
- `/creator/upload` — upload (90 s / 200 MB validated client-side, rights checkbox), then a live processing state via Supabase realtime. ffmpeg.wasm (lazy-loaded single-thread core, no SharedArrayBuffer needed; COOP/COEP headers are set on this route only in `next.config.ts`) runs in the browser before upload: it transcodes the video to H.264 MP4 (yuv420p, AAC, +faststart, long edge ≤1280 — iPhone HEVC .mov renders black in Chrome/Firefox, so only H.264 ever reaches storage; skipped when the input already is H.264 MP4 ≤50 MB) and extracts a mono 16 kHz m4a audio track uploaded as `<user_id>/<video_id>.audio.m4a` — the pipeline transcribes the audio file, so the old 25 MB Whisper limit is gone.
- `/admin/creators` — review applications, list approved creators with video counts.
- `/admin/videos` — review flagged clips with the word-synced SubtitleTrack overlay; approve/reject, pull published videos back. Note: NEW uploads are transcoded to H.264 MP4 in the browser before storage, so they play everywhere; .mov files uploaded before that change are HEVC and won't decode in Chromium browsers (the player says so and links the raw file — review those in Safari, or re-upload).
- The home feed merges published `loro_videos` rows (mapped to the `Video` shape, creator name joined from `loro_creators`) after the static `data/videos.json` set; if Supabase is unreachable the feed is exactly the static set.

Setup:

1. Run `supabase/migrations/20260718000000_ugc_creators.sql` in the Supabase SQL editor. It creates `loro_creators`, `loro_videos`, `loro_admins`, RLS, the learning-impact counter triggers, the public `loro-videos` storage bucket, and enables realtime on `loro_videos`. Then run `supabase/migrations/20260718110000_video_audio_path.sql` (adds `loro_videos.audio_path`) and `supabase/migrations/20260718120000_public_creator_read.sql` (public read of approved creator rows, needed for creator names in the feed).
2. Seed yourself as admin: `insert into public.loro_admins (user_id) values ('<your auth uuid>');`
3. Env (in `.env`): `N8N_IMPORT_WEBHOOK_URL` — the n8n import webhook, kept server-side and called via `/api/creator/import`. Optional: `NEXT_PUBLIC_LORO_VIDEOS_BUCKET` (defaults to `loro-videos`).

The n8n workflow should use the service-role key (bypasses RLS) to move videos through `uploaded → processing → published | pending_review` and fill `cues`/`dictionary`. The webhook payload is `{ video_id, creator_id, storage_path, audio_path, duration }` — **transcribe from `audio_path`** (browser-extracted mono 16 kHz m4a, a few hundred KB); `storage_path` is the playable video and should never be sent to Whisper.

## Discovery: YouTube candidate harvest

Third source of feed content, alongside the static `data/videos.json` seed set and
creator uploads. Pulls **metadata only** for short Spanish videos from the YouTube
Data API v3 into `loro_video_candidates`, filters them for eligibility, and leaves
them waiting for transcription. Nothing is ever downloaded — no yt-dlp, no media
fetching of any kind.

### License is the whole legal posture

Every candidate carries a `license`, and the two values are **not interchangeable**:

| `license`        | What we may do                                  |
| ---------------- | ----------------------------------------------- |
| `creativeCommon` | Download and self-host with attribution         |
| `youtube`        | Play via the official iframe embed **only**     |

A row whose license the API did not report is rejected as `license_unknown` — unknown
rights are never defaulted into the usable branch. Keep these paths separate in any
code that consumes this table.

### Setup

1. Run `supabase/migrations/20260721000000_video_candidates.sql` in the Supabase SQL
   editor. Creates `loro_video_candidates` and `loro_harvest_runs`, both with RLS
   enabled and **no policies** — they are server-side only, reachable exclusively
   through the service-role key.
2. Add to `.env`: `YOUTUBE_API_KEY` (Google Cloud → Credentials, with "YouTube Data
   API v3" enabled) and `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Settings → API).

### Running it

```bash
npm run harvest -- --plan      # where the next run resumes; no network, no quota
npm run harvest -- --dry-run   # real API reads, writes nothing (still costs quota)
npm run harvest                # harvest until the quota budget is spent
npm run harvest -- --topic food --region MX --license cc --limit 4
```

Selection flags (`--topic` / `--region` / `--license`) mark the run **exploratory**:
quota is still recorded, but the sweep cursor is left untouched so an ad-hoc probe
can't corrupt the full sweep's resume point.

### Quota and resumability

`search.list` costs 100 units, `videos.list` costs 1, and the default allowance is
10,000 units/day — about 95 searches. The full matrix (35 Spanish queries × 7 regions
× 2 license branches = 490 searches) is therefore a **multi-day sweep**, not one run.

- `QUOTA_BUDGET` in `scripts/config/harvest-queries.mts` caps a single run; the day's
  real remaining allowance (from earlier runs recorded in `loro_harvest_runs`) caps it
  further. The lower wins, and a call never starts unless it is affordable in full.
- Progress is checkpointed to `loro_harvest_runs.cursor` after every combination, so a
  crash, a Ctrl-C, or a quota wall all resume exactly where they stopped.
- The quota day resets at **midnight Pacific**, which is what the accounting uses.
- Re-harvesting is idempotent: an existing row keeps its `status`, `reject_reason`,
  `difficulty_level` and `detected_language`, and only refreshes volatile facts
  (view/like counts, title, thumbnail, license). Topic tags are unioned, never replaced.

### Filtering

`scripts/lib/candidateFilter.mts` is a pure function — no network, no database — so it
is unit-tested and can be re-run over the stored table after tuning without spending
quota. Every threshold lives in `scripts/config/harvest-queries.mts`; the filter itself
contains no literals. Rejections always record a specific `reject_reason`
(`duration_too_short`, `category_music`, `dubbing_suspected`, `channel_saturated`, …),
never a generic "filtered", so you can see which threshold is actually costing content:

```sql
select reject_reason, count(*) from loro_video_candidates
where status = 'rejected' group by 1 order by 2 desc;
```

### Layout

| Path                                       | What it is                                        |
| ------------------------------------------ | ------------------------------------------------- |
| `scripts/harvest-youtube.mts`               | The CLI: matrix walk, quota, report                |
| `scripts/config/harvest-queries.mts`        | Topics, queries, regions, thresholds — tune here   |
| `scripts/lib/candidateFilter.mts`           | Pure eligibility filter                           |
| `scripts/lib/youtube.mts`                   | Typed API client, backoff, quota meter            |
| `scripts/lib/candidates.mts`                | Row shape, mapping, idempotent upsert             |
| `scripts/lib/harvestState.mts`              | Search matrix, resume cursor, quota accounting    |
| `scripts/lib/supabaseAdmin.mts`             | Service-role client — **CLI only, never in lib/** |

Scripts are `.mts` and run straight through Node's built-in type stripping
(`node scripts/harvest-youtube.mts`) — no TS runner, no build step, no new dependency.
`npm run typecheck` covers them; `npm test` runs the filter and harvest unit tests via
Node's built-in test runner.

### Channel blocklist

`BLOCKED_CHANNELS` in `scripts/config/harvest-queries.mts` is an **editorial
override, not a classifier**. Blocked channels' videos stay in the table as
`status='rejected'`, `reject_reason='channel_blocked'` — never deleted, because
deleted rows get rediscovered and re-judged on every future harvest and we lose
the fact that we already judged them.

After editing the list (or any threshold, or the dubbing patterns), make it
retroactive with **zero quota**:

```bash
npm run refilter              # preview every transition
npm run refilter -- --apply   # commit
```

`refilter` only revises rows at `discovered` / `eligible` / `rejected`. Rows at
`processing` / `ready` / `published` are downstream of a transcription or a
human decision and are never reset by a config edit. Note it inverts the
harvest's flag convention: it writes nothing without `--apply`, because
rewriting existing verdicts in bulk does not deserve the same default as
appending new rows.

Why a manual list rather than a rule: measured against the 172 channels in the
table as of 2026-07-21, every available metadata signal failed to separate
scripted voiceover-over-B-roll from a person speaking on camera. View count
spans 3 400× *within* the same genre; emoji density is a thumbnail convention
that flags the best channel in the pool as strongly as the worst; `category_id`
is uploader-declared and was wrong on 3 of 5 Gaming rows; title-pattern
regexes ran ~60–70% precision with errors in both directions. The distinction
is visual and acoustic, and no `search.list` or `videos.list` field observes it.

### Deferred — do not lose

1. **Speech-register tag.** Narrated-over-footage channels (CuriosaMente,
   Palaeos, Perros Curiosos, …) are deliberately NOT blocked: clean
   articulation, no overlapping speakers and slower delivery make that register
   *better* A1/A2 material than real conversation. But it must not be
   indistinguishable from conversational content — the feed needs to tell them
   apart. Needs a tag; not built.
2. **Speech-style scoring, orthogonal to `difficulty_level`.** "How hard" and
   "what kind of speech" are two axes and the feed will want to filter on both.
   Derivable from the Whisper word-level timings the pipeline already produces,
   at zero extra API quota: pause structure, words-per-minute variance,
   disfluency rate (`eh`, `o sea`, repairs), speaker turn-taking. This is the
   scalable answer to the problem the blocklist only patches.
3. **`CHANNEL_POLICY` keyed by channelId with `'seed' | 'block'`**, replacing
   separate seed and block lists, to be adopted when channel-seeded discovery
   lands. Two lists over the same key can contradict each other.
4. **Channel-seeded discovery is ~50–100× cheaper than search.** `channels.list`
   (1 unit) → `contentDetails.relatedPlaylists.uploads` → `playlistItems.list`
   (1 unit per 50 videos) enumerates a whole channel for ~2 units per 50 videos,
   against 100 units per ≤50 ids for `search.list`. Search's unique value is
   *finding channels we don't know about*; it is a poor way to enumerate videos.
   `MAX_ELIGIBLE_PER_CHANNEL` will fight this head-on and needs to become
   source-aware first.
5. **Remove the report's `"that share is the self-host-vs-embed answer"` line.**
   It is wrong under any license-weighted sample, and once the `any` branch is
   dropped it reads 100% CC forever — a tautology printed as a finding.
6. **Drop the `any` / `license='youtube'` branch.** Embed-only content cannot
   feed the transcription pipeline: no lawful audio access for videos we don't
   own, and YouTube captions lack the word-level timestamps Loro's core loop is
   built on. Existing `youtube`-licence rows stay; the branch stops being
   harvested. Halves the matrix to 245 combinations.

### Note: `channel_saturated` is now binding

As of the 2026-07-21 sweep (617 CC eligible, 302 distinct channels), the
`MAX_ELIGIBLE_PER_CHANNEL` cap is actively rejecting content — 64 rows — and it
is binding on exactly the four channels with the most eligible videos:
Resilentos, Romancito, Tiitanes Futbol and Lugares Extraordinarios del Mundo,
all pinned at 16.

The cap is deliberately unchanged, but it is **the wrong mechanism at this
stage** and should be visible as such. It encodes "don't let one channel
dominate a feed assembled from untrusted search results" — a discovery-time
concern. What it actually does now is throttle our *best-known* sources at the
moment we want more from them, and it will fight channel-seeded discovery head
on (see Deferred #4). Source diversity is a property of the feed the learner
sees, not of the candidate pool, so this belongs at feed assembly rather than
at ingestion.

## YouTube embeds: the feed's discovery-sourced content

The discovery pipeline's eligible candidates become feed slides via the
**official YouTube iframe player** — no media is ever downloaded, no yt-dlp,
no storage. Transcripts come from YouTube's own word-timed ASR caption tracks
(the `es/asr` track carries per-word `tOffsetMs`), converted to Loro's
`Cue`/`Word` shape by the same chunker rules as `transcribe.py`, then
translated and glossed by the same GPT-4o prompts. Whisper is not involved:
the caption track replaces it as the timing source.

### Publishing content (this is the launch step)

```bash
npm run publish-embeds -- --dry-run    # see what would be picked
npm run publish-embeds -- --limit 12   # fetch captions, gloss, publish
```

Run it on your own machine (the caption fetch behaves like a browser loading
the watch page — residential connection, not CI). If a batch comes back all
skipped, diagnose with `npm run probe-captions -- <videoId>`, which prints
every step of both fetch strategies.

Two YouTube hardenings the fetcher handles, both observed live:
* **EU consent wall** — cookie-less requests bounce to consent.youtube.com, so
  the watch-page strategy sends the standard pre-granted consent cookies.
* **PO-token gating** — caption URLs issued to the *web* client return an empty
  200 body. The primary strategy therefore asks the InnerTube **ANDROID**
  client, whose caption URLs are not gated; the watch page is the fallback. Output lands in
`data/embedVideos.json`, which ships with the app: the feed shows the new
slides on the next reload or deploy. Candidates move to `published`;
caption-less ones are rejected as `no_captions` and never retried.

Nightly-ish upkeep: `npm run sweep-embeds` (official API, ~1 quota unit per
50 videos) reports embeds that died — deleted, privated, embed-disabled —
and `-- --apply` prunes them.

### The embed slide's layout — compliance by construction

The embed terms prohibit drawing anything over the player, so embed slides do
not reuse the full-bleed layout: the player renders in a 9:16 box and ALL Loro
UI — subtitles, action rail, progress bar, paused indicator, attribution —
lives in the band below it. The harvest thumbnail sits *under* the player (not
an overlay) until the first frame.

**The split is flexbox, never pixel constants.** The slide is a flex column:
a top spacer sized `env(safe-area-inset-top) + 3.25rem` (the chrome's real
height — a fixed constant put the pills over the player on every notched
phone), then the player as `flex-1 min-h-0`, then the band in normal flow at
its natural height. A first version hardcoded a 236px band when the real one
was ~578px, so the entire UI painted over the player. Do not reintroduce a
magic band height. The action rail also switches to a **horizontal row** on
embed slides: the vertical stack is ~316px, most of the band's budget alone.
Measured result: band 306px, player 228x405 on an iPhone 14.

Attribution renders in the band on every embed slide: channel name linking to
the channel, a `CC BY` chip linking to the licence deed on Creative Commons
videos, and a YouTube link to the original watch page. Both licence branches
may be embedded — `youtube`-licence rows are embeds *forever*, while
`creativeCommon` rows may later also move to the self-hosted path via creator
permission (the clean parallel track for downloads; see Deferred).

### How playback stays feature-identical

`types/index.ts` defines `FeedMedia` — the minimal media surface the feed
drives (`currentTime` r/w, `paused`, `muted`, `play/pause`, events).
`HTMLVideoElement` satisfies it structurally; `lib/youtubePlayer.ts`
implements it over the IFrame API with a local optimistic clock (the iframe
reports time at ~4Hz; reads are extrapolated, and writes reflect instantly so
SubtitleTrack's blank-hold re-seat logic converges instead of fighting the
async seek). Blanks, SRS recall, word taps, glossary — all unchanged, because
they only ever talked to the interface. The player boots lazily on a slide's
first activation, so fifty embed slides mount one iframe, not fifty.

Known, accepted trade-offs: pause lands ~100-250ms after the blanked word's
end (audible blip before the clamp-back; the native path is frame-exact), and
the caption transcript is lowercase/unpunctuated ASR (cue splits lean on
pauses and caps rather than sentence boundaries).

### Legal posture, stated once

| Piece | Status |
| --- | --- |
| iframe playback | Officially sanctioned, both licences |
| Caption/transcript fetch | Undocumented endpoint — accepted grey zone; fetched once per video, cached in-repo forever; breakage risk, not enforcement risk |
| Media download | **Out**, regardless of CC licence (YouTube ToS) |
| CC BY attribution | Name+link, licence chip, source link, in the band; modifications (subtitling) noted here |

The Creative Commons videos in `data/embedVideos.json` are modified relative
to their originals only in presentation (our subtitle rendering alongside the
unaltered player stream); the transcripts are derivative text used for
language-learning display with attribution.
