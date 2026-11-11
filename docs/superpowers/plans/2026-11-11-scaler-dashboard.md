# Scaler Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** /marketing becomes a three-channel dashboard (Overview, Reels, Winners, Plan) that shows which
hooks and formats win against each channel's usual reel. It adds tracked bio links for conversion and a
`scaler` skill that proposes each batch for Radek to approve.

**Architecture:** Instagram data keeps flowing through the existing daily sync (`app/api/_lib/instagram.ts`),
now covering all posts plus two more reel metrics. Anything that needs the Mac (Apple Vision OCR on covers,
frame hashing against our rendered reels) runs in a local enrich script that the scaler runs before planning.
Pure arithmetic (baselines at post time, rankings, verdicts, track record) lives in `lib/scaleStats.ts` with
`node --test` tests. The dashboard is client components fed by `/api/marketing`.

**Tech Stack:**
- Next.js App Router, TypeScript, Supabase (service role server-side only)
- Node 24 `.mts` scripts using type-stripping
- Swift + Apple Vision for OCR
- Python + Pillow from `~/.venvs/reels` for dHash
- ffmpeg

**Spec:** `docs/superpowers/specs/2026-11-11-scaler-dashboard-design.md`

## Global Constraints

- Every reel is scored as a multiple of its channel's usual views: the median of its 12 most recent settled
  (48 h+) posts, taken **at the time it was posted** for old reels. Never rank on raw views.
- Verdicts: n ≥ 3 and median multiple ≥ 1.5 → **winning**. n < 3 and median ≥ 1.5 → **promising**.
  n ≥ 3 and median < 0.8 → **losing**. Anything else → **ordinary**. Every ranking row shows n.
- Comment proxy = comments per 1k views. No comment-text reads and no new IG permissions.
- Bio links: `getloro.app/go/radek-spanish` | `radek-explains` | `loro-app` → 302 to
  `https://apps.apple.com/app/apple-store/id6799623319?pt=129194904&ct=ig-<slug>&mt=8`.
- A tap stores the channel, time and a UA class only. No IP, no cookie, no full user agent.
- Tables use the `loro_` prefix, RLS on with no policies, and are read and written only by the service
  role. The migration is applied by Radek in the Supabase SQL editor.
- The scaler only plans the `cut` format, is tied to actual me + demo pairs in the inbox, and never uses
  the same hook twice in a batch on any account. About 1 in 3 slots are `test`. Radek approves every
  plan.
- No commits to main, no push and no `eas build` without Radek's explicit word. Work on branch
  `scaler-dashboard`, cut from `cut-tool` (e35ea3f).
- Winners' default view is **all formats**, because the old reels are mostly untagged; the format is a
  filter. (This deviates from the spec's "cut by default"; the reason is that history would otherwise be
  empty.)
- UI: reuse `DASH` colours and `Card`/`CardTitle`/`KpiCard` from `components/admin/RadekDashboard.tsx`.
  It must work at phone width (Radek checks on his phone), with a 16 px gutter and no horizontal page
  scroll. Load the `dataviz` skill before writing any chart or sparkline.

## Review Focus

1. A channel with fewer than 3 settled posts at a reel's posting time: the baseline is null, the multiple
   shows "–", and the reel never counts as a winner. (Test in Task 3.)
2. An OCR'd cover that is noise (`гV(+5+22201`) or empty: no hook is stored, the reel shows "add hook",
   and it is never grouped under a garbage hook. (Test in Task 3, `cleanCoverText`.)
3. Two IG posts that both look like one cut reel, e.g. a repost: no auto-link unless the best match is
   unique and clearly better than the runner-up. (Test in Task 5.)
4. Link previews and crawlers hitting `/go/*` (facebookexternalhit, Instagram's preview,
   Twitterbot, Slackbot, curl): they redirect but are stored with `ua_kind='bot'` and excluded from tap
   counts. (Test in Task 2.)
5. A metric Meta stops returning, such as `reels_skip_rate`: the sync stores null for it and keeps every
   other metric, without falling back to the core six. (Test in Task 4, `readInsights`.)

---

### Task 1: Branch + migration

**Files:**
- Create: `supabase/migrations/20261111000000_scaler_dashboard.sql`

- [ ] **Step 1:** `git -C ~/loro-cut switch -c scaler-dashboard` (from cut-tool at e35ea3f).
- [ ] **Step 2: Write the migration.** Same header style as `20261026000000_marketing_instagram.sql`
  ("SERVER-ONLY TABLES. RLS on, NO policies"). Use `create … if not exists` and
  `alter … add column if not exists`:
  - `loro_marketing_ig_media_daily`: add `skip_rate numeric` and `view_total_ms bigint`.
  - `loro_marketing_link_taps`:
    - `id bigint generated always as identity primary key`
    - `channel text not null check (channel in ('radek.spanish','radek.explains.spanish','loro.app'))`
    - `at timestamptz not null default now()`
    - `ua_kind text not null check (ua_kind in ('human','bot'))`
    - index on `(channel, at desc)`
  - `loro_marketing_post_tags`:
    - `media_id text primary key references loro_marketing_ig_media on delete cascade`
    - `hook text`
    - `hook_source text check (hook_source in ('cut','cover','manual'))`
    - `hook_kind text check (hook_kind in ('question','statement'))`
    - `format text not null default 'other' check (format in ('cut','phrases','outline-game','other'))`
    - `demo_kind text not null default 'unknown' check (demo_kind in ('reels','peppa','other','unknown'))`
    - `line1_variant text`
    - `voice text check (voice in ('i','you'))`
    - `cut_reel_id uuid references loro_cut_reels on delete set null`
    - `manual boolean not null default false` (true means Radek edited it, so enrich never overwrites it)
    - `updated_at timestamptz not null default now()`
  - `loro_marketing_installs`:
    - `channel text` (same check as above), `week date` (Monday), `installs int not null`
    - primary key `(channel, week)`
  - `loro_scale_plans`:
    - `id uuid pk default gen_random_uuid()`
    - `batch text not null`
    - `status text not null default 'proposed' check (status in ('proposed','approved','rejected','cut'))`
    - `summary text`
    - `created_at timestamptz default now()`, `decided_at timestamptz`
  - `loro_scale_plan_items`:
    - `id uuid pk`, `plan_id uuid not null references loro_scale_plans on delete cascade`
    - `slot int not null`, `account text not null` (same check)
    - `me_file text not null`, `demo_file text not null`
    - `hook text not null`, `hook_kind text`, `line1_variant text`, `voice text`, `demo_kind text`
    - `role text not null check (role in ('exploit','test'))`
    - `reason text not null`, `expected_multiple numeric`
    - `status text not null default 'proposed' check (status in ('proposed','approved','rejected','cut'))`
    - `cut_reel_id uuid references loro_cut_reels on delete set null`
    - `unique (plan_id, slot)`
- [ ] **Step 3:** Ask Radek to paste the file into the Supabase SQL editor. Verify with
  `curl …/rest/v1/loro_scale_plan_items?select=id&limit=1` and `…/loro_marketing_ig_media_daily?select=skip_rate&limit=1`.
  Expected: `[]`, not `42P01` or `42703`.
- [ ] **Step 4:** Commit the migration.

### Task 2: Tracked bio links `/go/<slug>`

**Files:**
- Create: `lib/goLinks.ts`, `app/go/[slug]/route.ts`
- Test: `app/api/_lib/goLinks.test.mts`

**Interfaces:**
- Produces:
  - `GO_SLUGS: Record<'radek-spanish'|'radek-explains'|'loro-app', Account>`
  - `appStoreUrl(slug: string): string | null`
  - `uaKind(ua: string | null): 'human' | 'bot'`

- [ ] **Step 1: Failing tests.**
  - `appStoreUrl('loro-app') === 'https://apps.apple.com/app/apple-store/id6799623319?pt=129194904&ct=ig-loro-app&mt=8'`
  - `appStoreUrl('nope') === null`
  - `uaKind` returns `'bot'` for each of: `facebookexternalhit/1.1`, `Instagram 312.0 … (link preview)`
    (match `facebookexternalhit|Facebot|Twitterbot|Slackbot|Discordbot|WhatsApp|TelegramBot|bot|crawler|spider|curl|wget|python-requests|HeadlessChrome`
    case-insensitive), `''` and `null`.
  - `uaKind` returns `'human'` for a real iPhone Instagram in-app UA
    (`Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) … Instagram 356.0.0`).
- [ ] **Step 2:** `node --test app/api/_lib/goLinks.test.mts`. It FAILS (module missing).
- [ ] **Step 3: Implement.** In `lib/goLinks.ts`, define the slugs, `appStoreUrl` and `uaKind`, with plain
  relative imports so node --test can load them. In `app/go/[slug]/route.ts`: `GET`, `dynamic = 'force-dynamic'`.
  - Unknown slug → 302 to `https://getloro.app`.
  - Known slug → insert `{channel, ua_kind}` with `getServiceRole()`. Don't await failure handling past a
    `.then`: a failed insert must never block the redirect.
  - Then 302 to `appStoreUrl`, with `Cache-Control: no-store`.
- [ ] **Step 4:** The tests PASS. `npm run typecheck` is clean.
- [ ] **Step 5:** Commit.

### Task 3: Scoring, rankings and text helpers (`lib/scaleStats.ts`)

**Files:**
- Create: `lib/scaleStats.ts`
- Test: `app/api/_lib/scaleStats.test.mts`

**Interfaces:**
- Consumes: `MarketingPost`, `median`, `BASELINE_POSTS` from `lib/marketingStats.ts`.
- Produces:
  - `type PostTags = { hook: string|null; hookSource: 'cut'|'cover'|'manual'|null; hookKind: 'question'|'statement'|null; format: 'cut'|'phrases'|'outline-game'|'other'; demoKind: 'reels'|'peppa'|'other'|'unknown'; line1Variant: string|null; voice: 'i'|'you'|null; cutReelId: string|null; manual: boolean }`
  - `type ScoredPost = MarketingPost & { tags: PostTags|null; baseline: number|null; multiple: number|null; commentsPer1k: number|null; sharesSavesPer1k: number|null; settled: boolean }`
  - `baselineAt(posts: MarketingPost[], igUserId: string, at: Date): number | null`: the median of that
    account's 12 most recent posts that were posted ≥ 48 h before `at` and have views.
  - `scorePosts(posts: MarketingPost[], tags: Map<string, PostTags>, now?: Date): ScoredPost[]`
  - `type Dimension = 'hook'|'hookKind'|'format'|'demoKind'|'line1Variant'|'voice'|'account'`
  - `type Verdict = 'winning'|'promising'|'ordinary'|'losing'`
  - `type RankRow = { key: string; n: number; medianMultiple: number|null; min: number|null; max: number|null; totalViews: number; verdict: Verdict; examples: string[] /* mediaIds, best first, max 3 */ }`
  - `rankBy(posts: ScoredPost[], dim: Dimension): RankRow[]`: only settled posts with a multiple; null
    keys skipped; sorted by verdict order (winning, promising, ordinary, losing), then median desc.
  - `verdictOf(n: number, med: number|null): Verdict`
  - `inferHookKind(hook: string): 'question'|'statement'`: question if it contains `?` or starts with a
    quote char.
  - `line1Variant(line: string): string`: `'reels'` if /reel|scroll/i, `'peppa'` if /peppa/i,
    `'answer'` if /^(u+m+|m+)\b/i; otherwise the first 4 words lowercased.
  - `voiceOf(lines: string[]): 'i'|'you'|null`: `'you'` if /\byou\b/i appears in any line, `'i'` if
    /\b(i|me|my)\b/i does, otherwise null.
  - `type OcrLine = { text: string; h: number /* box height, 0..1 of the image */ }`
  - `cleanCoverText(lines: OcrLine[]): string | null`: lines arrive top to bottom. See below.
  - `textSimilarity(a: string, b: string): number`: 0..1, the Dice coefficient on lowercase letter
    bigrams.
  - `type PlanItemResult = { expected: number|null; actual: number|null; role: 'exploit'|'test' }` and
    `trackRecord(items: PlanItemResult[]): { exploit: {n:number; median:number|null}; test: {n:number; median:number|null}; hitRate: number|null /* share of settled items with actual ≥ expected */ }`

- [ ] **Step 1: Failing tests** (with the `post()` fixture style from `marketingStats.test.mts`):
  - `baselineAt` uses only posts from ≥ 48 h before `at`, for that account. A 2026-10-20 reel is scored
    against posts before 2026-10-18, not against later ones.
  - `baselineAt` returns null when there are no prior settled posts (Review Focus 1), and then
    `scorePosts` gives `multiple: null`.
  - `verdictOf(3, 1.5) === 'winning'`, `verdictOf(2, 4) === 'promising'`, `verdictOf(5, 0.7) === 'losing'`,
    `verdictOf(5, 1.0) === 'ordinary'`, `verdictOf(1, null) === 'ordinary'`.
  - `rankBy(…, 'hook')` groups by `hookKey`-normalised hook (lowercase, quotes and emoji stripped; use
    `hookKey` from `lib/cutReels.ts`), counts n, and skips posts under 48 h old.
  - `cleanCoverText` on `[{text:'3 years of studying',h:.04},{text:'Spanish and i just find',h:.04},{text:'this now... like wtfo',h:.04},{text:'Is green pools',h:.012},{text:'The da',h:.01}]`
    `=== '3 years of studying Spanish and i just find this now... like wtf'`.
  - `cleanCoverText([{text:'гV(+5+22201',h:.05}])` and `cleanCoverText([])` both `=== null` (Review Focus 2).
  - `inferHookKind('"How did you learn 1000 words??"😭') === 'question'`.
  - `line1Variant('ummm by literally scrolling Spanish reels') === 'reels'`, and `line1Variant('Learn by literally watching Spanish Peppa Pig') === 'peppa'`.
  - `voiceOf(['The app makes you write the words you hear']) === 'you'`.
  - `textSimilarity('Day 400 of my streak', 'day 400 of my streak') === 1`, and `< 0.3` against an
    unrelated hook.
  - `trackRecord`: exploit vs test medians, and `hitRate` over items with both values.
- [ ] **Step 2:** Run them: FAIL.
- [ ] **Step 3: Implement.** `cleanCoverText` algorithm (lines arrive top-to-bottom from OCR):

```text
1. drop lines with fewer than 3 letters, or where under 50% of the characters are Latin letters
1b. the hook is the big text: drop lines whose h < 0.7 × the tallest surviving line's h
2. keep the first run of consecutive surviving lines (it stops at the first dropped line once the run
   has started)
3. join them with spaces
4. strip trailing [®©™°] and any non-letter junk
5. if the last word is a known short word plus 1 extra letter (wtf+o, lol+o: an emoji misread),
   drop that letter. The known words are wtf, lol, now, this, omg.
6. return null if fewer than 3 words remain
```

- [ ] **Step 4:** The tests PASS.
- [ ] **Step 5:** Commit.

### Task 4: Fuller sync (all posts + new metrics)

**Files:**
- Modify: `app/api/_lib/instagram.ts` (`fetchMedia`, `fetchInsights`, `REEL_METRICS`, `InsightRow`)
- Create: `scripts/scale/sync.mts` (a local run of `syncAll`, using `getAdminClient()` from `scripts/lib/supabaseAdmin.mts`)
- Test: `app/api/_lib/instagramParse.test.mts`

**Interfaces:**
- Produces:
  - `readInsights(data: Insight[]): InsightRow`, exported from `instagram.ts`
  - `InsightRow` gains `skip_rate: number|null` and `view_total_ms: number|null`

- [ ] **Step 1: Failing test.** `readInsights` on a payload with `views`, `comments` and
  `ig_reels_video_view_total_time`, but no `reels_skip_rate`, returns those values plus
  `skip_rate: null`, and every other absent metric as null (Review Focus 5). `total_value.value` and
  `values[0].value` are both read.
- [ ] **Step 2:** FAIL. (Importing `instagram.ts` in node works because the window guard only throws in
  a browser.)
- [ ] **Step 3: Implement.**
  - `fetchMedia` follows `paging.next` until there's no next page or 20 pages have been read (limit 50).
  - `REEL_METRICS` adds `reels_skip_rate` and `ig_reels_video_view_total_time`.
  - `fetchInsights` tries the full list. On failure it retries **without the "in development" ones**
    (`reels_skip_rate`, `ig_reels_video_view_total_time`, `ig_reels_avg_watch_time`, `reposts`) before
    falling back to `CORE_METRICS`.
  - The upsert writes the two new columns.
  - Insights are still only read for posts from the last 60 days. Older posts get one insight read on
    their first sync, when they have no `media_daily` row yet, so history has numbers. Check existing
    ids with one `select media_id` on `loro_marketing_ig_media_daily`.
- [ ] **Step 4:** The tests PASS. Then run `node scripts/scale/sync.mts`. Expected output: three
  `SyncResult`s with `ok: true`, radek.spanish with `posts` ≈ 149 and no `last_error`.
- [ ] **Step 5:** Commit.

### Task 5: Enrich: cover hooks, tags from /cut, auto-link

**Files:**
- Create: `scripts/scale/ocr.swift` (Vision `VNRecognizeTextRequest`, accurate, language correction on,
  languages `en-US`, `es-ES`). Args are image paths. It prints one JSON line per image:
  `{"path":…, "lines":[{"text","h"}…top-to-bottom…]}`, where `h` is the bounding box height.
- Create: `scripts/scale/dhash.py` (Pillow). `dhash.py img…` prints `{"path", "hash"}`, a 64-bit hex
  string: 9×8 grayscale, horizontal difference.
- Create: `scripts/scale/enrich.mts`
- Create: `lib/linkMatch.ts`
- Test: `app/api/_lib/linkMatch.test.mts`

**Interfaces:**
- Consumes: `cleanCoverText`, `inferHookKind`, `line1Variant`, `voiceOf` and `textSimilarity` (Task 3),
  plus `PostTags`.
- Produces:
  - `hamming(a: string, b: string): number` (hex dHash)
  - `type Candidate = { mediaId: string; hashDist: number|null; textSim: number|null }`
  - `pickMatch(cands: Candidate[]): string | null`: match when `hashDist ≤ 12` **or**
    `textSim ≥ 0.75`, and the best one is unique. Rank by hashDist ascending, with ties broken by textSim.
    The runner-up must be ≥ 6 bits worse, or ≥ 0.15 lower on textSim, otherwise return null.

- [ ] **Step 1: Failing tests** for `hamming` and `pickMatch`:
  - one clear match → its id
  - two near-identical candidates (dist 4 and 6) → null (Review Focus 3)
  - none under the thresholds → null
  - text-only match (hashDist null, textSim 0.9) → its id
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement.** `enrich.mts` does, in order:
  1. Load IG media (REELS), tags, and `loro_cut_reels` with `status in ('approved','posted')`.
  2. **Auto-link.** For each cut reel without `ig_media_id` and without a `permalink`, the candidates are
     same-account posts from ≥ the reel's `updated_at` minus 1 day, not already linked to another cut
     reel.
     - Hash each candidate cover (download `thumbnail_url` into `~/.cache/loro-cut/covers/<media_id>.jpg`).
     - Hash our frames at 0.1 s, 0.5 s and 1.0 s of the reel's local mp4 (`job.out`), using ffmpeg to
       extract them into the cache. Keep the minimum distance.
     - `textSim` is the reel's hook against the cleaned OCR of the cover.
     - On a match, set `ig_media_id`, `status='posted'`, and `posted_at` = the IG timestamp if it's empty.
  3. **Tags from /cut.** For each IG post linked to a cut reel (by `ig_media_id` or permalink shortcode,
     using `shortcodeOf`), upsert tags from the reel unless `manual`:
     - `hook`, `hook_source='cut'`, `format='cut'`
     - `demo_kind` from the job: `'peppa'` if a line matches /peppa/i, otherwise `'reels'`
     - `line1_variant` and `voice` from the lines, `hook_kind` from `inferHookKind`
     - `cut_reel_id`
  4. **Cover hooks.** For IG reels with no tag row, OCR the covers in one `swift` call. On a non-null
     `cleanCoverText`, upsert `hook_source='cover'`, `hook_kind`, `format='other'` and
     `demo_kind='unknown'`. On null, upsert a row with `hook: null`, so it isn't retried every run; the
     UI shows "add hook".
  5. Print a summary: `linked N · tagged from /cut N · hooks read N · unreadable N`.
- [ ] **Step 4:** The tests PASS. Run `node scripts/scale/enrich.mts`. Expected: @loro.app 2026-11-11 #1
  is linked to its post from 2026-11-11, and ≥ 100 hooks are read. Spot-check 10 hooks against the
  covers by eye, reading the cache jpgs.
- [ ] **Step 5:** Commit.

### Task 6: API: everything the dashboard needs, plus edits

**Files:**
- Modify: `app/api/marketing/route.ts`, `app/api/_lib/instagram.ts` (`loadMarketingData`),
  `lib/marketingStats.ts` (types)
- Create: `app/api/marketing/tags/route.ts`, `app/api/marketing/installs/route.ts`,
  `app/api/marketing/plan/route.ts`

**Interfaces:**
- Produces:
  - `MarketingData` gains these fields:
    - `tags: Record<string, PostTags>`
    - `taps: { channel: Account; day: string; taps: number }[]` (human only, last 90 days)
    - `installs: { channel: Account; week: string; installs: number }[]`
    - `plans: ScalePlan[]`
    - `cutReels: Record<string /*mediaId*/, { id: string; batch: string; slot: number }>`
  - `ReelMetrics` gains `skipRate` and `viewTotalMs`.
  - `type ScalePlan = { id; batch; status; summary; createdAt; decidedAt; items: ScalePlanItem[] }`.
    `ScalePlanItem` mirrors the table in camelCase, plus `actualMultiple: number|null` (from the linked
    cut reel's IG post, when posted and settled).
  - `loadMarketingData` drops `limit(300)` in favour of `limit(2000)`, and the daily window becomes
    400 days (old reels have a single row).
  - `PATCH /api/marketing/tags {mediaId, hook?, format?, demoKind?, hookKind?}` sets `manual=true` and
    `hook_source='manual'` when the hook changes.
  - `PUT /api/marketing/installs {channel, week, installs}` upserts.
  - `PATCH /api/marketing/plan {planId, status}` or `{itemId, status}`, where status is
    `approved|rejected`. Approving a plan approves its still-proposed items. `decided_at` is set to now.
  - All of these call `requireAdmin` first, like the existing routes.
- [ ] **Step 1:** Implement. Validate enums against the migration's check lists, and return 400 with a
  plain message on bad input.
- [ ] **Step 2:** `npm run typecheck` is clean. With `next dev` (no `--turbopack` in the worktree), GET
  `/api/marketing` as the admin returns `tags` with ≥ 100 entries.
- [ ] **Step 3:** Commit.

### Task 7: Dashboard shell + Overview tab

**Files:**
- Modify: `app/marketing/page.tsx` (tabs and the URL hash `#overview|#reels|#winners|#plan`, so a tab
  survives refresh and can be linked)
- Create: `components/admin/scale/Overview.tsx`, `components/admin/scale/ui.tsx` (shared pieces:
  `ChannelChip`, `MultipleBadge` moved here from `MarketingDashboard.tsx`, `Cover`, `Sparkline`, `Pill`,
  `Empty`)
- Modify: `components/admin/MarketingDashboard.tsx` (keep `AccountsPanel`, which moves to the bottom of
  Overview, and remove what moved)

- [ ] **Step 1:** Load the `dataviz` skill before writing `Sparkline` or any chart.
- [ ] **Step 2: Header + tabs.** Sticky on scroll: a row with the title, "Synced 06:12 · Sync now",
  then the 4 tabs as large pills.
- [ ] **Step 3: Overview**, one card per channel in a 3-column grid (1 column on a phone), each in its
  channel colour (radek.spanish `DASH.green`, radek.explains.spanish `DASH.blue`, loro.app
  `DASH.orange`). Each card shows:
  - the usual views, with a sparkline of the baseline over the last 30 days
  - followers and the 7-day gain
  - link taps over 7 days, with a sparkline
  - installs from the last typed week, with an inline "+ add week" input (calls `PUT installs`)
  - its best reel of the last 14 days (cover, hook, multiple)

  Below the cards:
  - **This week's winners**: the top 5 reels across all channels by multiple, settled ones only.
  - A **Taps timeline**: taps per day, per channel, with dots on the days reels were posted. Hovering or
    tapping a dot shows the hooks.
  - `AccountsPanel`.
- [ ] **Step 4:** Check by eye in the browser at 390 px and 1280 px wide. No horizontal scroll, and
  numbers readable without zoom.
- [ ] **Step 5:** Commit.

### Task 8: Reels tab

**Files:**
- Create: `components/admin/scale/Reels.tsx`

- [ ] **Step 1: Filters**, as one row of pills: channel (All / 3 channels), format, verdict band (3×+,
  1–3×, under 1×), "needs a hook". Plus a search box over hooks.
- [ ] **Step 2: The list.** Rows on desktop, cards on a phone. Each shows:
  - the cover (64 px)
  - the hook (editable inline: click → input → Enter saves via `PATCH tags`; shows `cover`/`cut`/`edited`
    as a tiny tag)
  - the channel chip and the posted date
  - views and a big `MultipleBadge`
  - comments/1k, shares+saves/1k, avg watch, skip rate
  - format and demo selects (saved on change)
  - a "/cut" link when a cut reel is linked (`/cut#<reel id>`) and an Instagram link

  Sortable by multiple (the default), views, date, comments/1k. A reel under 48 h old shows a "still
  climbing" chip and no verdict.
- [ ] **Step 3:** Check it in the browser: edit one hook, reload, and the edit persists with an "edited"
  tag.
- [ ] **Step 4:** Commit.

### Task 9: Winners tab

**Files:**
- Create: `components/admin/scale/Winners.tsx`

- [ ] **Step 1:** Dimension pills: Hooks · Hook style · Line 1 · Voice · Demo · Format · Channel. Plus
  the format and channel filters (default: all).
- [ ] **Step 2: A row per `RankRow`:**
  - the key
  - the verdict as a coloured word (winning green, promising blue, ordinary muted, losing red)
  - the median multiple as a horizontal bar on a shared log scale centred at 1×, with min–max whiskers
  - "n reels", and total views
  - up to 3 example covers that open the reel's Instagram link

  A one-line explainer above the list: "1× = that channel's usual reel. Winning = 3+ reels at 1.5× or
  better."
- [ ] **Step 3:** Check by eye that Hooks shows real rows with n, and that a hook with one reel reads
  "promising", not "winning".
- [ ] **Step 4:** Commit.

### Task 10: Plan tab + /cut multiples

**Files:**
- Create: `components/admin/scale/Plan.tsx`
- Modify: `components/admin/CutStudio.tsx` (a posted reel shows `views · 2.4× its channel` next to the
  video), `app/api/cut/route.ts` (adds `multiple` per reel via `baselineAt`), `lib/cutReels.ts`
  (`CutReel.multiple: number|null`)

- [ ] **Step 1: Plan tab.**
  - The latest `proposed` plan first: its summary, then one card per item, each showing:
    - channel chip, slot, exploit/test tag
    - hook, line-1 variant, voice, demo kind, me + demo file names
    - the reason
    - "expects 2.1×"
    - Approve / Reject buttons
  - "Approve all" at the top.
  - Below it, past plans with a **Track record** card from `trackRecord`: exploit median vs test median,
    and hit rate, each with n.
  - An empty state saying: "No plan yet. Drop clips in the REELS folders and tell Claude 'plan the next
    batch'."
- [ ] **Step 2: /cut.** Implement the multiple via `baselineAt` over the account's IG posts.
- [ ] **Step 3:** Check in the browser that approving an item flips it and survives reload.
- [ ] **Step 4:** Commit.

### Task 11: The scaler skill + report

**Files:**
- Create: `scripts/scale/report.mts`, `scripts/scale/plan.mts`, `.claude/skills/scaler/SKILL.md`
- Modify: `.claude/skills/cut-reels/SKILL.md` ("New batch" gets step 0: run the scaler and cut only from
  an approved plan), `scripts/cut/publish.mts` (when `job.plan_item_id` is set, set that item to
  `status='cut'` and `cut_reel_id`)

- [ ] **Step 1: `report.mts`.** It runs `enrich.mts` first, then prints markdown:
  - each channel's baseline
  - Winners for each dimension, with n and verdict
  - the last 14 days' top 5 and bottom 5, with hooks
  - hooks in `scripts/cut/hooks.json` never posted on each account
  - the inbox: me/demo pairs per account, in filename order, with durations (same pairing rule as
    cut-reels)
  - the track record of past plans
- [ ] **Step 2: `plan.mts <plan.json>`.** It inserts a plan plus its items from
  `{batch, summary, items:[{slot, account, me_file, demo_file, hook, hook_kind, line1_variant, voice, demo_kind, role, reason, expected_multiple}]}`.
  - It validates: no hook twice (by `hookKey`), ≥ 1 test slot when there are ≥ 3 items, files exist,
    enums match.
  - It prints the dashboard link `getloro.app/marketing#plan`.
- [ ] **Step 3: `SKILL.md`** (trigger phrases: "plan the next batch", "/scaler", and also before
  "cut the reels"). The steps:
  1. Run `report.mts`.
  2. Assign each inbox pair:
     - exploit slots take the winning patterns (hook kind, line-1 variant, voice, demo) on the channel
       where they won, with a *different* hook from the bank of the same kind
     - test slots take untested hooks or new formats
     - diversity rules from the Global Constraints
  3. Write the plan json and run `plan.mts`.
  4. Tell Radek in chat, one line per reel, plus the link.
  5. After approval, cut-reels cuts with those hooks and the line-1 variant, adapting the wording to the
     footage, and sets `plan_item_id` in each job.

  Record that autonomy grows only when Radek says so, citing the track record.
- [ ] **Step 4: Dry run.** Copy one current inbox pair, or use the existing 2026-11-11 sources as a
  pretend inbox, then run report + plan. The plan shows on `/marketing#plan`. Delete the dry-run plan
  afterwards.
- [ ] **Step 5:** Commit.

### Task 12: Whole-branch check + handover

- [ ] **Step 1:** `npm test` and `npm run typecheck` pass, and lint shows no new errors in the touched
  files.
- [ ] **Step 2:** Screenshots at phone width and desktop width of all 4 tabs, read back by eye.
- [ ] **Step 3:** Tell Radek what's ready. Merging and pushing waits for his word. After the deploy, he
  swaps the 3 bio links to `getloro.app/go/…` and adds installs weekly.
