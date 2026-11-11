# Scaler dashboard: what wins on Instagram, and a scaler that plans the next batch

Date: 2026-11-11 · Owner: Radek · Status: draft for approval (builder check done)

## Intent

Instagram is "the most important part of Loro right now" (Radek). He posts reels on three accounts
(@radek.spanish, @radek.explains.spanish, @loro.app), all cut through getloro.app/cut. He wants to see
clearly what is working across the three, test things, and carry what made a winner into the next
videos ("with a winner, I try to implement things that led to the win in the next videos").

A specialised agent, **the scaler**, studies the winners and proposes the next batch, aiming at two
things: views, and taps through the link (downloads). It **proposes a plan that Radek approves**. Once
it has proven itself, he may let it do more on its own, so its track record has to be visible.

## Goals

1. One dashboard (on /marketing) showing all three channels and every reel, with the numbers that
   say whether a reel won, scored against its own channel.
2. Every reel knows *why* it might have won: its hook, its lines, its demo, its channel. That is
   automatic for reels cut on /cut, and read from the cover for the ~150 posted before /cut.
3. A "Winners" view that ranks hooks and formats (hook kind, demo kind, channel, line variants) with
   enough honesty about sample size that one lucky reel doesn't look like a law.
4. Conversion measured per channel (bio-link taps, App Store installs), plus the best per-reel proxy
   Instagram gives (comments on the "comment Spanish" CTA, shares, saves).
5. The scaler: a skill run in chat that writes a plan for the next batch, with a reason for each reel,
   and shows it on the dashboard for Radek to approve. It also records how its past plans actually
   did, so trusting it more is a decision made on evidence.

## Non-goals

- No unattended agent. The scaler runs in a chat with Radek, like cutting does. A headless
  `claude -p` watcher was blocked by the auto-mode classifier on 2026-11-11.
- No auto-posting to Instagram. Radek posts by hand.
- No paid ads or boosting.
- Not a general social media tool: three accounts, reels.

## Anti-goals (a failure even if it "works")

- Ranking on raw views. @loro.app's usual reel gets ~130 views and @radek.explains.spanish's ~1,450.
  Raw views would only ever say "post on the big account". Every reel is scored as a multiple of its
  own channel's usual views (the existing `lib/marketingStats.ts` idea).
- Declaring a winner from one reel. Every ranking shows n, and a hook with one post is "promising",
  not "winning".
- A dashboard that needs typing to stay true. Links, hooks and numbers fill themselves. Typing is only
  for corrections.
- A scaler that just repeats the top hook everywhere. Instagram demotes identical content across
  accounts (already a cut-reels rule), and every plan keeps some slots for tests.

## Constraints (verified 2026-11-11)

- Instagram API with Instagram Login (graph.instagram.com), all three accounts connected with tokens
  valid to 2027-01-10 that renew themselves. 150 posts synced (newest 50 per account; radek.spanish
  has 149 in total).
- Per-reel metrics available: views, reach, likes, comments, shares, saved, reposts,
  total_interactions, ig_reels_avg_watch_time, ig_reels_video_view_total_time, reels_skip_rate
  (several are marked "in development" by Meta, so tolerate their absence per metric).
- **No per-reel link taps, profile visits or follows** for reels. **No bio-link taps at account
  level** either: `profile_links_taps` only covers contact buttons. So link conversion must be
  measured on our side.
- All three bios link straight to `https://apps.apple.com/app/id6799623319` today, with no tag, so
  downloads can't be attributed to a channel yet.
- No video duration or file on the media object for Instagram Login. `thumbnail_url` (the cover) is
  available for video. `media_url` is missing for reels with licensed audio.
- Insights lag up to 48 h. Reels under 48 h old are still climbing (already excluded from baselines).
- Loro conventions: `.mts` scripts run by Node 24, migrations applied by Radek in the Supabase SQL
  editor, `loro_` table prefix, admin-only pages behind `loro_is_admin`.

## Approaches considered

- **A. /cut becomes the hub.** Results live next to recipes. Not picked.
- **B. /marketing becomes the dashboard, /cut stays the cutting room (PICKED by Radek).** /marketing
  already holds the Instagram data and the per-account scoring. /cut keeps cutting, notes and review.
  The two are joined by linking each cut reel to its Instagram post, so a reel's numbers also show on
  /cut and its recipe shows on /marketing.
- **C. A new /scale page.** A third page to keep in sync, for no gain over B. Dropped.

## The design

Four parts, built in this order. Part 1 goes first because tap data only starts once the bios change.

### 1. Tracked bio links (conversion per channel)

- `getloro.app/go/<channel>` (`radek-spanish`, `radek-explains`, `loro-app`) records a tap (channel,
  time, nothing about the person: no IP, no cookie) in a new table `loro_marketing_link_taps`, then
  302-redirects to the App Store with Apple's campaign parameters (`pt=<provider token>&ct=<channel>`),
  so App Store Connect's App Analytics reports installs by channel.
- Radek puts each link in its account's bio (one-time).
- The provider token `pt` comes from App Store Connect (Apps → Loro → App Analytics → Acquisition →
  Campaigns → Generate a Campaign Link). It is unrelated to the Instagram tokens. **pt = 129194904**
  (Radek, 2026-11-11). Campaign names are `ig-radek-spanish`, `ig-radek-explains`, `ig-loro-app`, and
  Apple lists a ct after its first install. Example:
  `https://apps.apple.com/app/apple-store/id6799623319?pt=129194904&ct=ig-loro-app&mt=8`.
- Dashboard: taps per channel per day, and installs per channel. Installs come from App Store Connect.
  Typing them in weekly is the first version; the App Store Connect Analytics API is a later step.
- Per-reel conversion is inferred, never claimed: tap spikes are shown on the same timeline as the
  reels posted that day.

### 2. Fuller data, linking, and hooks for old reels

- **Sync everything:** page through all media, not just the newest 50. Re-read insights daily for 60
  days (existing window). Add reels_skip_rate and ig_reels_video_view_total_time where Meta returns
  them.
- **Link /cut reels to Instagram posts automatically.** Candidates are posts on the same account
  published after the cut reel's latest version. Compare each candidate's cover (`thumbnail_url`)
  against frames of our rendered video with a perceptual hash, and when one clearly matches, set
  `ig_media_id` on `loro_cut_reels`. A pasted link on /cut still works and wins over the guess.
  Marking a reel "Posted" by hand becomes optional.
- **Hooks for reels posted before /cut:** read the hook text off each cover with Apple's on-device text
  recognition (Vision framework, a small Swift script like `sdr.swift`). It's free and runs locally.
  Stored per post with its source (`cut` | `cover` | `manual`). Radek can correct a misread on the
  dashboard.
- **Tags:** each post carries the attributes the rankings group by:
  - hook kind (question / statement), from the quotes rule and the text
  - demo kind (reels / Peppa / other)
  - channel
  - line set
  For /cut reels these come from the job. For old ones, the hook kind is inferred from the text and
  the demo kind is "unknown" until tagged.

### 3. The dashboard (/marketing)

Tabs:
- **Overview:** the three channels side by side, each with:
  - usual views (the baseline)
  - the trend in that baseline
  - followers
  - link taps and installs
  - its best reel of the last 14 days
- **Reels:** every reel from all channels in one sortable list:
  - cover and hook
  - channel
  - posted date
  - views, plus the multiple vs its channel
  - comments, shares and saves per 1k views
  - watch time and skip rate
  - whether it came from /cut, linking to its recipe there
- **Winners:** hooks, hook kinds, demo kinds and line sets ranked by median multiple, with n and the
  range. A row needs at least 3 posts to say "winning". Fewer shows "promising".
- **Plan:** the scaler's latest proposal (see 4), with Approve / Reject per reel and for the whole
  plan, plus the track record of past plans.

On /cut, a posted reel shows its multiple and views next to the video. The existing Hooks tab there
reads the same numbers.

### 4. The scaler

- **When it runs (Radek, 2026-11-11):** after Radek has dropped his clips into the REELS folders and
  before anything is cut. It checks which formats and hooks are winning, then assigns each clip pair a
  channel, hook and lines, acting on the winners **but still mixing hooks so the videos stay diverse**.
  A plan item is therefore tied to an actual me + demo pair in the inbox, not a brief for filming.
  Lines still follow the cut-reels rule of matching what the demo shows. The scaler picks the line-1
  variant and voice, and cut-reels adapts the wording to the footage.
- A rejected item gets re-planned in the same chat. The scaler never falls back silently to the hook
  bank's default order.
- A skill in the repo, `.claude/skills/scaler/SKILL.md`, used in chat ("plan the next batch",
  "/scaler"). Cutting a new batch runs the scaler first.
- It reads a report from a script (`scripts/scale/report.mts`): rankings, recent winners and losers,
  untested hooks from `scripts/cut/hooks.json`, and what's waiting in the REELS inbox folders.
- It writes a plan to a new table, `loro_scale_plans`: one row per batch, with per-reel items. Each
  item has:
  - channel
  - hook
  - lines
  - demo kind
  - role: **exploit** (a winner's pattern) or **test** (a new hook or format)
  - a one-line reason
  - the multiple it expects
- **Diversity is a rule, not a nicety:** no hook twice in one batch (on any account), no single hook
  kind or line-1 variant on every reel, and a share of test slots (starting at about 1 in 3, the
  builder's call).
- Radek approves on /marketing → Plan. The cut-reels skill reads the approved plan when it cuts the
  next batch, so hooks and lines come from the plan instead of the hook bank's default order.
- **Track record:** once the planned reels are posted and settled (48 h+), the plan shows expected vs
  actual multiples and how the exploit slots did against the test slots. That's the evidence for
  later giving the scaler more autonomy.

## Calls made after the builder check (Claude's, Radek can override)

- **Scope:** Winners ranks every reel. Each post gets a top-level `format` tag:
  - `cut` (the /cut format: hook clip, demo, 3 lines)
  - `phrases` (the "Things to say when…" reels)
  - `outline-game`
  - `other`
  Rankings are filtered per format, with `cut` as the default view. Channel baselines stay "all of the
  channel's reels", as today, so a multiple means "better than this channel's usual post". Radek said
  all new videos will go through /cut, so reading hooks off covers is a backfill plus a catch-all for
  any post that didn't come from /cut. The scaler plans the `cut` format only, because that's the one
  the tool can cut.
- **Comment proxy:** comments per 1k views, using the existing `comments` metric. No reading of
  comment text, so no new permission and no token regeneration. Counting only the "Spanish" keyword
  is a later step. The CTA is in the caption ("comment "Spanish" and i will send you the link…").
- **Line set:** reels group by the **line-1 variant**, meaning what it says about how you learn
  ("scrolling reels" / "Peppa Pig" / "ummm by…" answer), and by **voice** (I / you). Exact line text
  is shown but never ranked.
- **Old reels** are scored against their channel's baseline at the time they were posted, not
  today's.
- **Tap counting** ignores obvious crawler and link-preview hits (Instagram's in-app preview,
  bots by user agent).

## Left to the builder

- Table shapes and migrations, which Radek applies in the SQL editor.
- Perceptual hash choice and match threshold.
- How the hook kind is inferred for old reels.
- Dashboard component structure, reusing `components/admin/RadekDashboard` cards and `DASH` colours.
- The exact report format for the scaler.
- Tests for the scoring and ranking arithmetic (pure functions in `lib/`, `node --test`, like
  `marketingStats.test.mts`).
