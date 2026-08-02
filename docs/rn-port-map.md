# Loro → React Native (Expo) Port Map

Investigation date: 2026-08-02, against `main` @ `009b566`. Web app: Next.js 15.5.20 (App Router), React 19, Tailwind v4, `@supabase/supabase-js` only — no ORM, no state library, no middleware.ts. This document maps what an RN client can share with the web app and what must be rewritten. Nothing in the repo was changed.

**The one-paragraph verdict.** Loro's logic/UI split is already unusually clean: the SRS engine, level system, starter-deck planner, all merge/sync semantics, and the entire entitlement rule set are pure, node-tested TypeScript with zero React or DOM in them — they move to a shared package essentially unchanged. The two genuinely hard problems are (1) `lib/storage.ts`, whose **synchronous localStorage read/write contract** is load-bearing for the whole app (the save gate, the SRS planners, and every screen read it synchronously), while RN's AsyncStorage is async; and (2) the YouTube player layer, whose iOS-Safari "blessing" architecture partially dissolves inside an RN WebView but whose `FeedMedia` clock/contract must be preserved exactly for subtitles and blanks to work.

---

## 1. Route + screen inventory

No `middleware.ts`. Root layout (`app/layout.tsx`) mounts four global pieces: `ServiceWorkerCleanup` (web-only legacy cleanup), `SyncInit` (calls `storage.initSync()` — RN needs an equivalent at app boot), `PlayerProvider` (the single shared YouTube player — see §5), and `PaywallHost` (paywall modal host — see §2). PWA `manifest.json` sets `start_url: "/feed"` — the feed, not the landing page, is the real entry point.

### Core learner screens — need mobile equivalents at launch

| Route | File | Type | Purpose |
|---|---|---|---|
| `/feed` | `app/feed/page.tsx` (95) | client | The product: vertical snap feed, tap-to-save words, typed SRS recall + level blanks. Modes: default (seed + embeds + published UGC) and `?creator=` scoped feed. Highest-effort RN screen. |
| `/welcome` | `app/welcome/page.tsx` (548) | client | Guided first-run: hook → self-assess → calibration (tap known words) → CEFR result → scripted walkthrough on a real feed slide. localStorage only. |
| `/onboarding/starter` | `app/onboarding/starter/page.tsx` (444) | client | Starter deck: 3 interleaved rounds of word cards + a real clip speaking those words. Dynamically imports `lib/localVideos` (bundle size). |
| `/vocab` | `app/vocab/page.tsx` (542) | client | "My words": urgency-bucketed saved words (SLIPPED/READY/JUST SAVED/LEARNING/LEARNED), search, per-video filter, box meters, Review-now CTA. localStorage only. |
| `/progress` | `app/progress/page.tsx` (459) | client | Stats: tier ladder + meter, streaks, due card, word-state bar, per-video rows. Default post-sign-in destination. localStorage only. |
| `/profile` | `app/profile/page.tsx` (460) | client | Personal hub: stats, starter re-entry, Plus statistics (`GET /api/entitlements/stats`), creator section, language picker, sign in/out, account deletion (`POST /api/account/delete`). |
| `/creator/[handle]` | `app/creator/[handle]/page.tsx` (257) | **server** | Public creator profile (the only server-rendered app screen — exists for OG link previews). On RN: a plain screen; keep the web page as the share target. |
| `/auth/callback` | `app/auth/callback/page.tsx` (83) | client | PKCE/OTP exchange landing (see §6). On RN this is a deep-link handler, not a screen. |

### Creator screens — secondary (defer or keep web-only at launch)

| Route | Notes |
|---|---|
| `/creator` (312) | Studio dashboard; direct Supabase queries via `lib/creators.ts`. Portable but not learner-critical. |
| `/creator/apply` (295) | Application form. Portable. |
| `/creator/upload` (535) | **Web-specific by construction**: in-browser H.264 transcode + audio extraction via ffmpeg.wasm (`lib/prepareClip.ts`), COOP/COEP headers scoped to this route in `next.config.ts`. An RN equivalent means native transcoding (e.g. `react-native-video-processing` / server-side) — a redesign, not a port. Recommend: keep uploads on the web initially. |

### Web-only (no mobile equivalent needed)

| Route | Why |
|---|---|
| `/` (371, server) | Pre-launch founding-member marketing page + waitlist form (`POST /api/waitlist`). |
| `/privacy`, `/terms` (`app/(legal)/`) | Legal. App Store wants URLs; link out to the web pages. |
| `/brand` | Internal mascot-export tooling. |
| `/admin/creators`, `/admin/videos` | Admin review tools. |
| `/dev/paywall`, `/dev/autoplay-lab`, `/dev/starter-clips` | Dev labs, `notFound()` in production. The autoplay lab's *findings* are load-bearing docs for §5. |
| `/join` | 308 redirect to `/` (`next.config.ts`). |

### API routes — stay on the server; RN calls them over HTTPS

All identity comes from the `Authorization: Bearer <access_token>` header (verified server-side), never from the body — this contract works unchanged from RN.

| Endpoint | Purpose | Called by |
|---|---|---|
| `POST /api/waitlist` | Waitlist insert (anon key, honeypot, duplicate → `alreadyJoined`) | landing page only |
| `POST /api/account/delete` | GDPR/App-Store deletion via service role | `DeleteAccountCard` (/profile) |
| `POST /api/creator/import` | Hands an upload to the n8n pipeline | `lib/creators.ts:599` |
| `POST /api/entitlements/grandfather` | Server-recounted grandfather grant (service role) | `lib/entitlements/state.ts:300` |
| `GET /api/entitlements/stats` | Plus statistics; locked responses carry labels, no values | `PlusStatistics.tsx` |

### ⚠️ Pre-existing deep-link inconsistency (affects RN route design)

`/vocab` replay links, `/progress` video rows, and `/creator/[handle]` tiles all link to `/?v=…&t=…` / `/?creator=…&v=…` — but the feed moved to `/feed` (2026-07-27) and `/` is now the marketing page, which ignores those params. `Feed.tsx:181-199` reads `?v`/`?t` but only mounts at `/feed`. Decide the canonical deep-link scheme for RN (e.g. `loro://feed?v=…`) rather than mirroring these stale links; flagging rather than assuming intent since the web bug presumably gets fixed independently.

---

## 2. Logic vs UI split

### 2a. Pure, platform-agnostic modules — port as-is

These have **no React, no DOM, no storage access**; most are unit-tested under plain `node --test` (the `.test.mts` files), which is standing proof of platform independence.

| Module | What it owns |
|---|---|
| `lib/srs.ts` | **The whole Leitner engine**: `BOX_INTERVALS_MS` (1min → 60d, 7 boxes), `initialSrs`, `grade`, `stateForBox`, `normalizeAnswer` (NFD accent-strip), `computeBlankPlan` (cross-video due-word → cue-blank planner with throttles: ≤5 blanks/video, ≤1 in first two cues, ≥1min age, ≥0.05s audible), `formatDue`. All take `now` as a parameter. |
| `lib/levels.ts` | Level fill-in mode: 6 named tiers, frequency-band word difficulty, `computeLevelBlankPlan`, `applyLevelAnswer` meter logic. |
| `lib/progress.ts` | `dueCount`, `nextDueAt`, `dayKey`, `weekStrip`, `computeStreaks` (local-calendar-day streaks). |
| `lib/progressSync.ts` | Union-only progress merge (`mergeProgress`, `rowToSnapshot`, `sameProgress`) — "sync never moves progress backwards". |
| `lib/wordMerge.ts` | `mergeWordSets`, `mergePrefer`, `foldDuplicateWords`, `localAhead` — the anon→signed-in merge semantics. |
| `lib/savePrompt.ts` | Account-nudge decision rules (`savePromptVariant`). |
| `lib/starterEvents.ts`, `lib/entitlements/paywallEvents.ts` | Idempotent, capped event-log append/merge (funnel instrumentation). |
| `lib/starterDeck.ts`, `lib/starterRounds.ts` (993), `lib/starterTopics.ts` | The curated deck + the clip-first round planner ("pure and deterministic — no Date, no Math.random, no storage"). |
| `lib/calibration.ts` | CEFR calibration scoring. |
| `lib/dictionary.ts`, `lib/glossary.ts` | Gloss lookup, surface normalisation, per-video glossary building. |
| `lib/feedOrder.ts` | `orderVideosForLevel`: unseen-first → level-distance → Fisher-Yates within ties. Injectable `random`. |
| `lib/authRedirect.ts` | `resolveNext` open-redirect guard (web-shaped but pure). |
| `lib/entitlements/config.ts`, `limit.ts`, `plans.ts`, `stats.ts` | All monetisation numbers and rules (see 2c). |
| `lib/embedVideos.ts`, `lib/staticVideos.ts`, `lib/localVideos.ts` | The video catalog (JSON → `Video[]` mapping). Pure, but see the bundle-size risk (§8). |
| `lib/languages.ts`, `lib/reservedHandles.ts`, `types/index.ts` | Constants and types. |

Two porting footnotes: `starterDeck.ts` / `starterRounds.ts` / `starterTopics.ts` import with **explicit `.ts` extensions** (`./srs.ts`) so they run under plain node — Metro handles this fine, but keep it in mind; everything else uses the `@/` alias, which needs a matching `tsconfig`/Babel alias in the RN workspace.

### 2b. SRS / word / deck state — where it lives, how tangled

**There is no store library.** The architecture is: *localStorage is the synchronous source of truth; a `window` CustomEvent is the change notification; every component re-reads on notify.*

- **Owner:** `lib/storage.ts` (1,511 lines) — one exported `storage` object. Pure logic (SRS math, merges, gating rules) is all *imported from* the pure modules above; storage.ts owns only **persistence, transport, and orchestration**. Keys are all `loro.`-prefixed (`storage.ts:105-124`).
- **Change notification:** `'loro:words-changed'` CustomEvent on `window` (`storage.ts:127,154`), subscribed via `storage.onWordsChanged(cb)` (`storage.ts:1329`), which also listens to the native cross-tab `storage` event (dead code in RN — single process). Subscribers all follow the same `refresh(); return storage.onWordsChanged(refresh)` idiom: `useEntitlements.ts:106`, `vocab/page.tsx:312`, `progress/page.tsx:95`, `profile/page.tsx:212`, `ActionRail.tsx:61`, `FeedEndCard.tsx:42`, `GlossarySheet.tsx:53`.
- **Write paths** (only one is gated): `saveWord` (`storage.ts:997`, gated, source `'user'`), `saveWordAtBox` (`:1204`, deck grants), `saveLevelWord` (`:1123`, level blanks), `gradeWord` (`:1052`, SRS review), `removeWord` (`:1313`). Every write returns `ok` only after a **verified read-back round trip** — UI must not celebrate on `!ok`.
- **Sync engine** (also in storage.ts): inert until a session exists. `initSync()` (`:952`) wires `getSession` + `onAuthChange` → `handleSession(userId)` (`:834`), which reads the single cache-owner key `loro.syncedUser` and picks one of three modes: `hydrate` (same user), `merge-up` (anon → first sign-in: union words up, sum histories), `switch-user` (different user owned the cache: wipe locally, hydrate fresh). Writes are queued (`loro.syncQueue`), debounced (800ms), coalesced per `(text, videoId)`, retried with backoff; queue flushes on `visibilitychange`-hidden / `online` / `beforeunload` (`:966-975`) — in RN these become AppState background transitions + NetInfo. Progress, starter events, paywall events, save-prompt stats, and self-level each have their own push/merge (`:383-689`), all riding the same cache-owner verdict.
- **One-way dependency rule** (stated in three files): `follows.ts` and `entitlements/state.ts` must **never import storage.ts**. storage.ts owns the cache-owner verdict and *drives* their auth transitions (`handleFollowsAuth`, `handleEntitlementsAuth`) — which is why those functions take mode and savedCount as parameters. Preserve this shape in the port.
- **How tangled with UI?** Barely. Components call `storage.*` and the pure planners directly; the only "logic in components" is flow orchestration: `Feed.tsx:567-586` (re-plan blanks when a slide activates), `Feed.tsx:618-687` (grade → resume-timer rhythm, level-up toasts), and the onboarding state machines inside `welcome/page.tsx` and `onboarding/starter/page.tsx`. That orchestration is worth extracting into hooks in the shared package, but it is small.

**The hard part:** every read is synchronous (`storage.getSavedWords()` inside render paths, `refuseSave` inside `saveWord`). RN's AsyncStorage cannot honour this contract. The realistic port is a **synchronous in-memory cache hydrated once at boot, persisted write-through to MMKV** (`react-native-mmkv` is synchronous and is the closest drop-in; AsyncStorage would force an app-wide async rewrite of a deliberately promise-free API). With MMKV, `readJSON`/`writeJSON` (`storage.ts:131-152`) port nearly 1:1.

### 2c. Entitlement / paywall gating

- **Model:** two tiers `'free' | 'plus'` (`limit.ts:20`); every number lives in `lib/entitlements/config.ts` — `SAVE_PROMPT_THRESHOLD = 10` (anon account nudge), `FREE_TIER_SAVED_WORDS_LIMIT = 50`, `PAYWALL_ENABLED = false` (**shipping dark**), `GRANDFATHER_EXISTING_USERS = true`, `PLANS` ($9.99/mo, $59.99/yr). `effectiveLimit()` (`limit.ts:48`) returns `Infinity` for anonymous, plus, grandfathered, or paywall-off — anonymous users are *never* paywalled (they get the account prompt instead; the asks are staged 10 → account, 50 → paywall).
- **What counts:** only `source === 'user'` words (`countsTowardLimit`, `limit.ts:84`); starter-deck/calibration grants are exempt. The single counter is `storage.getCountedSavedWords()`.
- **The gate:** `refuseSave()` (`storage.ts:714-731`) — called from exactly one place (`saveWord`, new words only). On refusal it logs `save_blocked_by_limit` and calls `requestPaywall(...)`. A blocked save leaves localStorage byte-identical. Deliberately NOT gated: re-saves, deck grants, level-blank saves, all SRS review — "the limit blocks growth; it never touches the loop."
- **The bus:** `lib/entitlements/paywallBus.ts` (71 lines) — a raw `CustomEvent('loro:paywall-requested')` on `window`; API is just `requestPaywall(req)` / `onPaywallRequested(cb)`. `PaywallHost` (mounted once in the root layout) subscribes and renders `PaywallModal`. **Smallest, cleanest rewrite target**: swap for a tiny typed emitter (`mitt`) in the shared package and both platforms use the same bus.
- **Tier state:** `lib/entitlements/state.ts` (317 lines) — server-authoritative (`loro_profiles.tier`, client-write-blocked by a DB trigger), client-cached in `localStorage['loro.tier']` for the synchronous gate read, fetched on auth events, **fails open** (fetch failure → unlimited). Emits `'loro:tier-changed'`. Also POSTs to `/api/entitlements/grandfather` (server recounts; client is only the trigger). Dev overrides in sessionStorage, compiled away in prod. Needs the same in-memory+MMKV treatment as storage.ts.
- **Purity audit of the layer:** `config/limit/plans/stats/paywallEvents` + `savePrompt` = pure, port as-is. `paywallBus` + `state` = browser-coupled rewrites. `useEntitlements.ts` = React-only (no DOM) — ports unchanged once its two deps are shimmed. Components (`PaywallModal`, `PlusStatistics`, `SavedWordsCapacity`) = full UI rewrites; `PaywallModal` deliberately contains **zero digits** (all copy derives from config/plans) — keep that property.
- **Payments: none anywhere.** The CTA is a visible placeholder ("Coming soon — thanks for the nudge") that logs `paywall_cta_clicked` with the plan id. No code path writes `tier = 'plus'`. For RN this is convenient: mobile forces StoreKit/Play Billing (or RevenueCat) anyway, and `plans.ts:getPlans()` already takes-and-ignores a region argument — it is the natural adapter seam for store products. Known server gap flagged in code: `SUPABASE_SERVICE_ROLE_KEY` is absent from the deployment, so `/api/entitlements/grandfather` 503s — must land before `PAYWALL_ENABLED` flips.

### 2d. Supabase data access — where queries live

| Module | Coupling | Notes |
|---|---|---|
| `lib/supabase.ts` | Client factory | Lazy singleton, `null` when unconfigured or `typeof window === 'undefined'` (guard must change in RN, §6). Table names in `TABLES`. |
| `lib/auth.ts` | Auth API | `getSession`, `onAuthChange`, magic link, Google OAuth, `ensureProfile`, profile read/update. `redirectTo()` uses `window.location.origin` (§6). |
| `lib/storage.ts` | Sync transport | All `loro_saved_words` / `loro_progress` / `loro_profiles` mirror traffic (see 2b). |
| `lib/follows.ts` | localStorage-first cache | Same engine shape as words; union merge; `loro_follows`. |
| `lib/publishedVideos.ts` | Queries only | `fetchPublishedVideos` / `fetchCreatorFeed` → `Video[]`. Pure mapping otherwise; ports as-is once the client is injectable. |
| `lib/creators.ts` (618) | Queries + storage upload + one `document` use | Creator CRUD, admin ops, `subscribeToVideo` realtime, upload; `readVideoDuration` uses a DOM `<video>` element — needs an RN replacement. Calls `POST /api/creator/import` via `fetch`. |
| `lib/creatorProfile.ts` | Server-side queries | Used by the server-rendered profile page; web-only concern. |
| `lib/supabaseServer.ts` | Server-only client | Web-only. |
| `lib/entitlements/state.ts` | Tier fetch + grandfather POST | See 2c. |

Everything RLS-sensitive already goes through API routes with Bearer tokens, so RN needs no new server surface.

---

## 3. Browser-only dependencies

Full sweep of 108 source files under `app/`, `components/`, `lib/`, `types/` plus both CSS files (`scripts/` excluded — server-side pipeline). Headline: browser coupling is **concentrated in six files** (storage, youtubePlayer, playerContext, Feed, entitlements/state, follows); the long tail is `next/link` imports and safe-area/`dvh` CSS. `AudioContext`, `navigator.share`, `mediaSession`, IndexedDB, WebSocket, `<audio>`: **not used anywhere**. No service worker is ever *registered* (only unregistered).

### `lib/storage.ts` — the largest single dependency (47 hits)

| Line | API | Doing what |
|---|---|---|
| 129 | `typeof window !== 'undefined'` | `isBrowser` guard gating everything below |
| 134 / 145 | `window.localStorage` get/set | the generic `readJSON`/`writeJSON` helpers — **the seam to swap for MMKV** |
| 155 | `window.dispatchEvent(new Event('loro:words-changed'))` | same-tab change notification |
| 550–557 | `window.crypto.randomUUID` → `getRandomValues` → `Date.now`+`Math.random` | event-id mint; fallback chain is load-bearing (LAN device testing is an insecure context) → `expo-crypto` |
| 885–896 | `localStorage.removeItem` ×5 | switch-user wipe (levelState, level, starterDone, starterEvents, paywallEvents) |
| 971–975 | `document.visibilitychange`, `window online`, `window beforeunload` | sync-queue flush triggers → AppState + NetInfo (there is no RN `beforeunload`; flush on background instead) |
| 1340–1344 | `window.addEventListener('loro:words-changed' / 'storage')` | `onWordsChanged`; the native `storage` half is cross-tab only — dead in RN |
| 1350–1434 | `localStorage` get/set | language, onboarded, self-level, starterDone, startLevel, joinPromo |
| 1494–1509 | `window.sessionStorage` + `localStorage` | two-layer sound state: session truth vs standing choice — sessionStorage → in-memory value in RN |

### `lib/youtubePlayer.ts` — the IFrame shim (runs *inside* the WebView in RN, so most of this stays)

| Line | API | Doing what |
|---|---|---|
| 100–121 | `window.YT` global, `document.createElement('script')` → `head.appendChild` | injects `https://www.youtube.com/iframe_api` (no `next/script` anywhere — manual by design) |
| 149–158 | `document.addEventListener('pointerdown'/'touchstart'/'keydown', {once,capture,passive})` | user-activation detector (Safari lacks `navigator.userActivation`) |
| 210, 238, 526 | `HTMLElement` host; `new YT.Player(host, …)` | creates the iframe (`youtube-nocookie.com`, `playsinline:1`, `mute:1`) |
| ~11 sites | `performance.now()` | the optimistic clock model (§5b) |
| 555 | `window.location.origin` | the `origin` playerVar for the postMessage handshake — in a WebView this must be a real serving origin, not `file://` |

### `lib/playerContext.tsx` — the most RN-hostile file; **dissolves entirely** (§5d)

| Line | API | Doing what |
|---|---|---|
| 298 | `slot.getBoundingClientRect()` | reads the slot rect every tracked frame |
| 314–328 | `layer.style.opacity/pointerEvents/width/height/transform` | parks the fixed layer over the slot (`translate3d`) |
| 338–342, 404 | `requestAnimationFrame`/`cancel` | rect-tracking loop with idle-out |
| 346 | `new ResizeObserver` | wake on slot resize |
| 349, 364 | `document.querySelectorAll('[data-loro-player-slot]')`, `getComputedStyle(slot).borderRadius` | slot resolution + corner inheritance |
| 385–390 | `new MutationObserver` on `document.documentElement` | detects slot mount/unmount anywhere |
| 394–398 | `window resize/orientationchange`, `document scroll` (capture) | re-track triggers |

### `components/Feed.tsx`

| Line | API | Doing what |
|---|---|---|
| 3–4 | `next/link`, `next/navigation` (`useRouter`, `useSearchParams`) | nav + `/?v=&t=` deep links |
| 149–153 | `container.addEventListener('pointerdown', bless, {once,passive})` | captures the iOS blessing on first touch (pointerdown, not click — a swipe never becomes a click) |
| 197, 225 | `children[i].scrollIntoView`, `scrollTo({behavior:'smooth'})` | deep-link jump; end-card restart → FlatList `scrollToIndex`/`scrollToOffset` |
| 201/204/814 | `h-[100dvh]`, `snap-y snap-mandatory overflow-y-scroll`, `snap-start` | **the feed's core interaction: CSS scroll-snap** → FlatList `pagingEnabled` |
| 398–453 | `new IntersectionObserver` (threshold 0.6) | play/pause/blank-planning driver → `onViewableItemsChanged` + `viewabilityConfig` 60% |
| 421–428 | `readyState`, deferred seek via `loadedmetadata {once}` | seek-before-metadata is silently dropped by `<video>` — RN video libs have analogous ready gating |
| 549–553 | media `play`/`pause` listeners | paused-indicator state |
| 826 | `env(safe-area-inset-top)` inline calc | notch spacer on embed slides → `useSafeAreaInsets` |
| 843 | `data-loro-player-slot` attribute | hands the shared layer its target box |
| 880–892 | `<video playsInline loop muted preload="metadata">` | hosted slides → `expo-video` behind the same `FeedMedia` contract |
| 1071–1092 | `<a target="_blank">` ×3 | attribution links → `Linking.openURL` |
| 1128–1140 | rAF loop writing `bar.style.transform` | progress bar → Reanimated |

### `components/SubtitleTrack.tsx`

| Line | API | Doing what |
|---|---|---|
| 99, 192–193 | `HTMLInputElement` ref; `rAF(() => input.focus({preventScroll:true}))` | blank input focus without keyboard-shift — RN: `TextInput.focus()` + keyboard-avoiding layout |
| 173–186 | `currentTime =` write + `pause()` | the blank hold: re-seats the clock on >0.05s drift while paused |
| 209–212 | `requestAnimationFrame` loop | per-frame cue/word-index sync — the 60fps consumer of the optimistic clock |
| 272–274 | `navigator.vibrate(15)` (guarded) | haptic on correct recall (no-op on iOS Safari) → `expo-haptics`, an upgrade on iOS |

### Entitlements + follows

| File | Lines | API | Doing what |
|---|---|---|---|
| `lib/entitlements/state.ts` | 68–81, 202 | `window.localStorage` | tier cache read/write/drop |
| | 74, 142, 203 | `dispatchEvent('loro:tier-changed')` | broadcast |
| | 105–109 | `addEventListener(TIER_CHANGED/'storage')` | subscription (+cross-tab, dead in RN) |
| | 118–140 | `window.sessionStorage` | dev overrides (compiled out in prod) |
| | 300 | `fetch('/api/entitlements/grandfather')` | **relative URL** — RN needs an absolute API origin |
| `lib/entitlements/paywallBus.ts` | 55–70 | `CustomEvent('loro:paywall-requested')` on `window` | the paywall bus (§2c) → typed emitter |
| `lib/follows.ts` | 41–61, 281–285 | `localStorage`, `dispatchEvent('loro:follows-changed')`, `storage` event | same pattern as storage.ts, helpers deliberately duplicated (no-cycle rule) |

### Creator flow (web-only at launch, listed for completeness)

| File | Lines | API | Doing what |
|---|---|---|---|
| `lib/prepareClip.ts` | 25–51, 128–288 | dynamic `import('@ffmpeg/ffmpeg')`, `toBlobURL`, wasm FS, `Blob`/`File` | ~11 MB CDN-fetched wasm core; H.264 transcode + poster + 16 kHz audio extract. **No RN equivalent — redesign.** |
| `lib/avatar.ts` | 36–65 | `createImageBitmap`, `document.createElement('canvas')`, 2d ctx, `toBlob('image/webp')` | avatar crop/encode → `expo-image-manipulator` |
| `lib/creators.ts` | 493–501 | `URL.createObjectURL` + detached `document.createElement('video')` | duration probe of a picked file → media library metadata |
| | 534 | `crypto.randomUUID()` **unguarded** | upload id (unlike storage.ts's guarded version) |
| `components/creator/ProfileAction.tsx` | 4, 139–216 | `useRouter().refresh()`, object URLs, `<input type="file">` | avatar picker → `expo-image-picker` |
| `app/creator/upload/page.tsx` | 163, 387–487 | `<input type="file" accept="video/*">`, programmatic `.click()` | file picking |

### Misc app surfaces

| File | Lines | API | Doing what |
|---|---|---|---|
| `components/ServiceWorkerCleanup.tsx` | 20–34 | `navigator.serviceWorker.getRegistrations()` + unregister, `caches.delete` | legacy PWA cleanup — **web-only, not ported; nothing registers a worker anywhere** |
| `components/DeleteAccountCard.tsx` | 32–39 | prefix-sweep of `loro.`/`loro:`/`sb-` keys in local+sessionStorage | post-deletion local wipe — RN driver needs an equivalent `clearAll` |
| | 121–133 | `window.location.replace('/feed?deleted=1')` | deliberate hard navigation → RN navigation reset |
| `app/feed/page.tsx` | 28–33 | `useSearchParams`, `window.history.replaceState` | reads `?deleted=1` banner flag then scrubs the URL |
| `app/auth/callback/page.tsx` | 29 | `new URLSearchParams(window.location.search)` | PKCE/OTP param extraction (§6) |
| `components/starter/RoundClip.tsx` | 132–178, 189, 207 | `performance.now()` stall detection, rAF clip clock, safe-area calc, `data-loro-player-slot` | starter-deck clip stage |
| `components/admin/ReviewPlayer.tsx` | 34–97 | `<video controls>`, `target="_blank"` | admin-only, web-only |
| `app/api/_lib/serviceRole.ts` | 20 | `typeof window !== 'undefined'` **throw** | server-only assertion — keep as-is |
| `app/dev/*` (4 routes) | many | `matchMedia`, `navigator.userAgent/standalone/hardwareConcurrency/clipboard`, `execCommand('copy')`, literal `<iframe>`, `pagehide/pageshow` | dev diagnostics, production-`notFound()`, out of port scope |

### Next.js module imports

- **`next/link`** — 19 files (all core screens + ActionRail, FeedEndCard, SignInCard, ProfilePill, FoundingMemberRow, creator/legal pages) → Expo Router `Link`.
- **`next/navigation`** — `useRouter`: `auth/callback`, `onboarding/starter`, `welcome`, `Feed.tsx`, `ProfileAction.tsx`; `useSearchParams`: `feed/page.tsx`, `Feed.tsx`; `notFound` (server): `creator/[handle]` + 3 dev pages.
- **`next/image`** — 5 files, **all web-only surfaces** (legal layout, landing page, HeroPhone, WaitlistForm). Zero core-screen usage — the feed uses plain `<img>` for posters (`Feed.tsx:849`). One less problem.
- **`next/font`** — Geist in `app/layout.tsx` only → `expo-font`.
- **`next/script`** — unused.
- **`next/server`** — the 5 API route handlers (stay on Vercel).

### CSS that encodes behaviour (`app/globals.css`)

| Lines | Declaration | RN translation |
|---|---|---|
| 36–41 | `overscroll-behavior-y: none` on html/body | kills iOS rubber-banding → `bounces={false}` |
| 49–54 | `.no-scrollbar` | `showsVerticalScrollIndicator={false}` |
| 57–62 | `.pt-safe`/`.pb-safe` = `env(safe-area-inset-*)` | `useSafeAreaInsets()` — used by ~15 files |
| 64–319 | 14 `@keyframes` (toast/sheet/snap/bloom/particles/hop/shake/coach/glow) | Reanimated; note `loro-bloom` uses **text-shadow** and the coach/tap/glow rings use **box-shadow spread** — neither exists in RN, need sibling-view or shadow-prop workarounds |
| 323–348 | `prefers-reduced-motion` disables all animation | `AccessibilityInfo.isReduceMotionEnabled()` — port this, it's an accessibility contract |
| — | `100dvh` in 24 places, `40dvh` (GlossarySheet), `position:fixed` in 6 sheet/modal backdrops | flex-1 layouts and RN `<Modal>`; `dvh` semantics are free in RN (no URL bar) |

`app/join/join.css` (landing page): scroll-driven `animation-timeline: view()`, `steps()` typewriter with `ch` units, `transform-origin` waves — all web-only marketing, no port needed.

### Files with zero browser APIs (confirmed clean)

All of §2a's pure modules, plus `publishedVideos.ts`, `creatorProfile.ts`, `supabaseServer.ts`, and these components (Tailwind classes only): `WordSheet`, `GlossarySheet`, `SavePromptSheet`, `Sheet`, `LanguagePicker`, `LoroMascot`, `ActionRail`, `FeedEndCard`, `SignInCard`, `FoundingMemberRow`, `SyncInit`, `icons/Icons`, `creator/Avatar`, `starter/WordCard`, all four `paywall/*` components, `admin`/`legal`/`brand` pages. These need JSX→RN-primitive rewrites but contain no logic to untangle.

---

## 4. Package audit

Dependencies (`package.json`):

| Package | Verdict for RN |
|---|---|
| `@supabase/supabase-js` ^2.110.5 | **Works in RN as-is** — officially supported. Needs: `storage: AsyncStorage` (or an MMKV adapter) in `createClient` auth options, `react-native-url-polyfill/auto`, and `detectSessionInUrl: false` (already the app's setting). Realtime (`subscribeToVideo`) works in RN. |
| `@ffmpeg/ffmpeg` ^0.12.15, `@ffmpeg/util` ^0.12.2 | **Web-only, not applicable.** WASM in-browser transcode for `/creator/upload` only. RN path would be native transcode or server-side; recommend keeping uploads web-only at launch. Not needed in the learner app at all. |
| `next` 15.5.20 | **Next.js-specific, not applicable.** Routing → Expo Router; `next/link`/`next/navigation` → Expo Router equivalents; `next/font` → `expo-font`; API routes stay deployed on Vercel and are consumed over HTTPS. |
| `react` 19.1.0 | **Works** (Expo pins its own compatible version; hooks-only shared code is fine). |
| `react-dom` 19.1.0 | **Not applicable** — replaced by `react-native`. |

Dev dependencies: `tailwindcss` ^4 + `@tailwindcss/postcss` → **RN equivalent: NativeWind** (or StyleSheet; note Tailwind v4 CSS-variable theming in `globals.css` has no direct NativeWind analogue — port the token values, not the mechanism). `eslint-config-next` → N/A (use `eslint-config-expo`). `typescript`, `@types/*`, `eslint` → fine.

Notable *absences* that make the port easier: no state library, no data-fetching library, no date library, no i18n framework, no CSS-in-JS — nothing to find RN equivalents for. The flip side: the custom event-bus/storage patterns those libraries would have abstracted are hand-rolled on `window` and must be re-seamed by hand (§7).

New RN-side dependencies implied: `react-native-mmkv` (synchronous storage), `react-native-webview` (player), `expo-auth-session` + `expo-web-browser` (OAuth), `expo-linking` (magic-link deep links), NetInfo (queue flush triggers), and eventually RevenueCat/StoreKit for payments.

---

## 5. YouTube player layer — precise current behaviour

This is the most carefully engineered part of the web app. Three pieces, cleanly separated:

### 5a. The `FeedMedia` contract (`types/index.ts:129-145`)

Everything in Feed/SubtitleTrack/ProgressBar drives this interface, never a concrete player. `HTMLVideoElement` satisfies it structurally; `YouTubeMedia` implements it over the IFrame API. Contract requirements (documented at the type):

- `currentTime` readable **and writable**; a read immediately after a write must return the written value (SubtitleTrack re-seats the clock whenever a paused clock drifts >0.05s from a blank's pause point — an async-lagging read loops forever).
- `play()` rejects with `DOMException('NotAllowedError')` when gesture-gated (Feed then retries muted) and `'AbortError'` when interrupted by `pause()` (Feed ignores).
- `'play'` / `'pause'` / `'loadedmetadata'` events fire like DOM ones.

**This contract is the porting seam.** An RN `WebViewYouTubeMedia` that honours it slots under the existing SubtitleTrack/blank logic unchanged.

### 5b. `YouTubeMedia` (`lib/youtubePlayer.ts`, 703 lines) — the IFrame adapter

Design constraints it satisfies (all documented in the file header):

1. **Optimistic clock.** The iframe reports `currentTime` ~every 250ms via postMessage, but SubtitleTrack reads every animation frame. Reads are answered from a local model — last reported sample, extrapolated with `performance.now()` while playing; writes update the model **instantly** while `seekTo()` catches up. A pending seek is considered landed only when a *changed* sample lands near the target (`SEEK_CONVERGENCE_S = 0.35`) or after `SEEK_TIMEOUT_MS = 1500`. Non-finite readings are never allowed into the model (a transient `undefined` after `loadVideoById` would freeze the clock permanently — measured in `/dev/autoplay-lab`).
2. **Lazy boot.** The player is created on the first `play()`, never at mount. `pause()`/seek on a never-activated instance just update the local model.
3. **Autoplay parity.** The IFrame API has no rejection for blocked playback — a blocked play just never reaches PLAYING. Emulated: `play()` resolves on PLAYING, rejects with synthetic `NotAllowedError` after a timeout — `PLAY_TIMEOUT_MS = 2500` once `playVideo()` was genuinely issued, `BOOT_TIMEOUT_MS = 12000` covering cold boot (so a slow network never reads as an autoplay block, which would wrongly flip the feed's sound state off).
4. **Muted-start rule.** `playerVars.mute = 1` at creation is REQUIRED — mobile browsers decide gesture-free playability from the player's state *at creation*; muting later in `onReady` is too late. `onReady` mutes again regardless of stored sound preference; sound is restored only in the PLAYING handler, and only if the page has been touched (`hasUserActivation` — a capture-phase `pointerdown/touchstart/keydown` listener, because Safari lacks `navigator.userActivation`). Players wanting sound before first touch queue in `awaitingActivation`.
5. **`loadVideo(id, duration, 'cue'|'play')`** — swap videos on ONE instance via `loadVideoById`/`cueVideoById` **without rebuilding it**: on iOS the autoplay grant belongs to the player instance it was granted to; a new iframe is a new unblessed player. Resets the clock model on swap.
6. **Loop semantics.** `loop: true` (feed): on ENDED, seek 0 + replay with **no 'pause' event** (the paused indicator must not flash), but 'ended' still fires for any listener. `loop: false` (starter deck): stop, emit 'pause' + 'ended' — the deck advances rounds on it.
7. Embed host is `youtube-nocookie.com` (privacy) but the loader script must stay `www.youtube.com/iframe_api` (the nocookie variant 404s — verified in-repo 2026-07-28). Player errors 100/101/150 (removed/embed-disabled) settle pending play with `NotAllowedError` and leave the slide on its poster.

### 5c. The shared persistent player (`lib/playerContext.tsx`, 546 lines)

**Why:** iOS Safari grants playback per player *instance*. One `YouTubeMedia`, created once at the app root, blessed once by the first real gesture, is blessed for the whole session — `loadVideoById` then starts every subsequent video with no new gesture, even from timers (measured: `/dev/autoplay-lab` test 5).

Mechanics that follow from that single premise:

- The instance lives at **module scope** (survives React strict-mode double-effects), is **never destroyed, never re-created, never re-parented** — Safari reloads a moved iframe, and a reloaded iframe is unblessed.
- The iframe therefore cannot live inside a slide. It sits in a **fixed-position layer at the root**, which *positions itself* over whichever element currently carries `data-loro-player-slot` — rAF rect-tracking with an idle stop (`TRACK_IDLE_FRAMES = 20`), woken by ResizeObserver / MutationObserver on the slot attribute / scroll (capture phase) / resize / orientationchange. Hidden via `opacity: 0`, never unmount and never `display:none` (both reload the iframe). If no slot exists for `ORPHAN_PAUSE_MS = 600` (a feed swap legitimately has none for a moment), playback pauses — audio under a page with no visible player is also an embed-terms problem.
- **`SharedPlayer` API** (`PlayerContext`): `loadAndPlay(videoId)`, `bless()`, `unmute()`, `getCurrentTime()` (NaN-guarded), `subscribe(listener)`. Consumer contract: `bless()`/`unmute()` must be called *synchronously inside a real gesture handler*; `loadAndPlay` resolving does not prove pixels are moving; every surface must carry a stall path — `PLAYBACK_STALL_MS = 1500` is the one shared deadline (iOS Low Power Mode refuses even muted autoplay; real users hit this). A second context (`useSharedMedia`) exposes `{media, loadedVideoId, started}` separately so swaps never change the `SharedPlayer` identity.
- **`bless()`** with nothing loaded plays a hidden priming video (`PRIME_VIDEO_ID = 'guIID3CEwuM'`), then pauses on the 'play' confirmation. The file flags an **UNVERIFIED ASSUMPTION**: that a pause preserves the blessing (the lab measured swap-after-PLAYING, not swap-after-pause; card 10 of the lab exists to settle it on a physical iPhone). **For the RN WKWebView environment this is now settled** (measured 2026-08-02 in `react-native-webview` on a physical device, §5e): the grant survives both a swap and a pause. That measurement says nothing about mobile Safari — the web app's own assumption remains unverified there, and its lab card 10 still stands.
- Feed integration: each slide renders an empty slot div; only the *active* slide sets the attribute (`Feed.tsx:843`); the slide's poster shows through the transparent layer until `started`, hiding the black frame during swaps; a background slide "owns" the media only while `loadedVideoId === video.youtubeId` (`ownsMedia`), which is what stops the outgoing video's clock from driving the incoming slide's subtitles.
- **Embed-terms layout rule** (`Feed.tsx` header, `Feed.tsx:818-877`): *nothing may ever be drawn over the player*. Embed slides use a flexbox column — player box on top, all Loro UI (subtitles, rail, progress, attribution) in a band below, heights computed by flexbox, never pixel constants. The attribution line (channel link out, CC BY chip, watch link) is an embed-terms requirement carried in the `FeedAuthor` union so a compliant line is guaranteed by construction. **This must be preserved in RN.**

### 5d. What this means inside an RN WebView

The plan (per the task brief) is to reuse this inside a WebView. Precisely what changes:

- **Keep:** the entire `YouTubeMedia` shim (clock model, play-timeout emulation, muted-start, loop semantics) — it is plain TS + IFrame API and runs *inside* the WebView's page verbatim. Keep the `FeedMedia` contract on the RN side, implemented by a bridge that proxies to the in-WebView shim over `postMessage`/`injectJavaScript`.
- **Changes meaning — now measured (§5e):** the blessing architecture. In `react-native-webview`, `mediaPlaybackRequiresUserAction={false}` + `allowsInlineMediaPlayback={true}` make gesture-free muted playback allowed by configuration: cold autoplay, swap-while-playing, and swap-after-pause all passed on a physical iPhone with zero gestures. The `bless()`/priming-video/first-touch machinery is unnecessary in RN. Low Power Mode has since been measured too and did not suppress playback (§5e); the stall-path contract (`PLAYBACK_STALL_MS`) stays as defensive design for the conditions the spike didn't cover (see R3).
- **Dissolves:** the fixed-layer/slot-tracking apparatus (rAF rect tracking, MutationObserver, opacity games). In RN the WebView is a real native view you position directly. What must be *re-created deliberately* is the property it existed for: **one persistent WebView instance for the whole session**, never unmounted across feed/deck navigation — both to avoid reload flicker/re-boot cost and in case autoplay grants are per-page-load inside WKWebView too. Mount it once near the navigator root (the RN analogue of `PlayerProvider` in `app/layout.tsx`) and overlay/position it per screen.
- **The bridge clock — now measured (§5e):** the clock-model-in-WebView + anchors-only-across-the-bridge design works at the needed precision. Drift of the RN-side extrapolation against ground truth stayed within ~±30ms over 60s, oscillating around zero and self-correcting rather than accumulating, and the read-immediately-after-write contract held on both sides for every seek. Keep the shape exactly: model inside the WebView, anchor updates out on play/pause/seek/re-anchor/ended, never per-frame RPC — SubtitleTrack's 60fps loop reads the local model on the native side.

---

### 5e. Device measurements (2026-08-02 — RN WebView lab, physical iPhone)

Measured with the throwaway Expo Go lab in `rn-lab/` (git-ignored, not part of the app): one persistent WebView, IFrame player on `youtube-nocookie.com`, the optimistic clock inside the WebView, anchors-only across the bridge. iOS Low Power Mode OFF except where noted.

| Test | Result |
|---|---|
| Cold autoplay, zero gestures | **PASS** — reached PLAYING in 256–1403ms across runs, with `mediaPlaybackRequiresUserAction={false}` + `allowsInlineMediaPlayback={true}` |
| Swap while PLAYING (`loadVideoById`) | **PASS**, repeated 5+ times — 316–825ms to PLAYING, no new gesture |
| Swap after PAUSE | **PASS** — the grant survived the pause; B reached PLAYING in 457ms with no gesture. Settles §5c's flagged assumption *for RN WKWebView* (not for mobile Safari) |
| Clock drift over 60s (RN extrapolation vs ground-truth RPC every 5s) | **PASS** — non-linear: oscillates around zero and self-corrects rather than accumulating; samples within ~±30ms. One unexplained **−202ms outlier at t=5s**, not yet reproduced |
| Seek round trip while paused, 10 targets | **PASS** — all 10 landed within 0.35s, average 623ms to land; immediate read-after-write returned the written value on BOTH the RN side and inside the WebView, every time |
| Unmute inside a touch handler | **PASS by state** — unmuted and still PLAYING |
| Rapid swap, 5 × `loadVideoById` in 2s | **PASS** — zero non-finite readings entered the clock model; final state PLAYING; clock advance over a 2s window: 2.02s (WebView model) / 2.05s (RN extrapolation). Neither froze |

Three operational findings the RN bridge implementation must absorb — measured behaviours, not speculation:

1. **`play()` must resolve immediately when the player is already PLAYING.** The lab initially reported false `NotAllowedError` timeouts because it waited for a state transition that never came. The web adapter already handles this (`lib/youtubePlayer.ts:411` returns a resolved promise when `playing`); a bridge that misses it fires spurious autoplay-blocked recovery on the feed — muted retry plus the feed's sound state flipping off — on videos that are in fact playing.
2. **A `loadVideoById` issued while playing *may* emit a spurious 'pause'** (state 2 → anchor `playing:false` → 'pause' event) before the new video starts. Both observations on record, honestly: the sequence was seen in an earlier lab log, but the dedicated counter added afterwards reported **0 spurious pauses across the later measurement runs** (both Low Power states). It appears condition-dependent rather than universal — a bridge implementation note, not a confirmed defect. The robust design is the web app's: gate the paused indicator on an ownership check (`ownsMedia`) or a swap window, so a flash is impossible whether or not the pause fires. (The web app suppresses the pause at the loop wrap for this same class of problem.)
3. **Seeks take ~600ms to land visually** even though reads are correct immediately (the optimistic model answers the target at once). Deep-link jumps need a poster or a fade to cover the gap.

**RESOLVED — iOS Low Power Mode did NOT suppress playback inside `react-native-webview`.** Measured with the card-8 advance probe (4s window, 20 samples) on a physical iPhone:

| Condition | Advance ratio |
|---|---|
| Low Power Mode OFF | **1×** (3.860s video / 3.859s wall) |
| Low Power Mode ON | **1×** (3.843s video / 3.857s wall) |

Visually confirmed on device: frames advanced in both runs (different frames and different subtitles between them), so this is not a clock-advancing-while-frozen artifact. An earlier pre-probe run *had* appeared not to play under LPM — that observation prompted the probe and is superseded by these measurements. **This differs from the web app's environment**: in mobile Safari, LPM refusing even muted autoplay is a real, designed-for state; in an RN WKWebView with `mediaPlaybackRequiresUserAction={false}` it simply did not occur here. Caveat: the lab records neither device model nor iOS build, so this is a **single-device, single-OS-version** data point, not a matrix.

**Spike closed.** What it answered (one physical iPhone): gesture-free autoplay; grant survival across swaps and swap-after-pause; bridge clock precision (drift bounded ~±30ms, read-after-write held); seek convergence (~600ms to land visually); rapid-swap robustness with zero non-finite leaks; and Low Power Mode non-suppression. What it did not answer: mobile-Safari behaviour (the web app's own assumptions are untouched); device/OS coverage beyond the one untracked test phone; audio-focus and interruption behaviour (calls, Siri, other apps' audio); feed-scale session length and backgrounding; and true pixel presentation — the probe is a clock proxy, and the visual confirmations were human. `rn-lab/` itself is a throwaway, fully git-ignored Expo project: a measurement instrument, not part of the app. The numbers live in this section; the lab can be deleted without loss.

## 6. Supabase auth — session storage and persistence

Current web setup (`lib/supabase.ts:24-39`):

```ts
createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,   // exchange handled manually in /auth/callback
    flowType: 'pkce',
    storageKey: 'loro.auth',
  },
})
```

Browser-storage assumptions to flag:

1. **Session persistence defaults to `localStorage`** (no custom `storage` adapter is passed). RN must supply one: `storage: AsyncStorage` (supabase-js's supported RN path) or an MMKV adapter. Keep `storageKey: 'loro.auth'`.
2. **`getSupabase()` returns `null` when `typeof window === 'undefined'`** (`supabase.ts:25`) — an SSR guard that would disable Supabase entirely in some RN/Hermes contexts. The shared package needs this factory injected or the guard rewritten (`Platform`-aware), not copied.
3. **`redirectTo()` is built from `window.location.origin`** (`auth.ts:31-34`) — both magic link (`emailRedirectTo`) and Google OAuth pass `${origin}/auth/callback`. On RN this becomes the app scheme (`loro://auth/callback` via `expo-linking`), which must be added to the Supabase project's **Redirect URLs allowlist** — the code comment warns that a missing allowlist entry is *silently* replaced by the Site URL and looks exactly like a client bug.
4. **The exchange itself** (`app/auth/callback/page.tsx`): `?code=` → `supabase.auth.exchangeCodeForSession(code)`; `?token_hash=&type=` → `verifyOtp`. Because `detectSessionInUrl` is off, this logic is explicit and therefore **easy to port**: an Expo deep-link handler receives the URL, runs the identical two-branch exchange, then navigates to the resolved destination (`resolveNext` from `lib/authRedirect.ts` — its path-shape checks port as-is, though RN should validate against its own route names). Google OAuth runs through `expo-web-browser`/`expo-auth-session` instead of a full-page redirect.
5. **Everything downstream of auth is already event-driven and portable:** `onAuthChange` → `storage.handleSession` → merge/hydrate. The RN client reuses this chain untouched once the client factory and storage driver are injected. API calls authenticate with `Authorization: Bearer <session.access_token>` — no cookies anywhere, which is the best possible starting point for RN.
6. `autoRefreshToken` in RN should be paired with the documented AppState hook (`startAutoRefresh`/`stopAutoRefresh` on foreground/background) — the web app never needed this.

---

## 7. Proposed `packages/core` shared module

Suggested monorepo shape: `apps/web` (current Next app), `apps/mobile` (Expo), `packages/core`. Next needs `transpilePackages: ['@loro/core']`; Metro resolves workspace packages natively.

### 7a. What moves (verbatim or near-verbatim)

**Tier 1 — pure logic, move as-is** (only import-path changes):

```
packages/core/src/
  types.ts                    ← types/index.ts
  srs.ts                      ← lib/srs.ts
  levels.ts                   ← lib/levels.ts
  progress.ts                 ← lib/progress.ts
  progressSync.ts             ← lib/progressSync.ts
  wordMerge.ts                ← lib/wordMerge.ts
  savePrompt.ts               ← lib/savePrompt.ts
  starterEvents.ts            ← lib/starterEvents.ts
  starter/{deck,rounds,topics}.ts  ← lib/starterDeck|starterRounds|starterTopics.ts
  calibration.ts              ← lib/calibration.ts
  dictionary.ts, glossary.ts  ← lib/dictionary.ts, lib/glossary.ts
  feedOrder.ts                ← lib/feedOrder.ts
  authRedirect.ts             ← lib/authRedirect.ts
  languages.ts, reservedHandles.ts
  entitlements/{config,limit,plans,stats,paywallEvents}.ts
  catalog/{embedVideos,staticVideos,localVideos}.ts   (see risk R4)
```

Move the `.test.mts` files with their modules — the `node --test` runner is platform-neutral and the tests are the spec.

**Tier 2 — move behind small injected seams:**

| Module | Seam needed |
|---|---|
| `lib/storage.ts` → `core/storage.ts` | Inject a **synchronous `StorageDriver`** (`getItem/setItem/removeItem`, string-valued) + an **event bus** + a **lifecycle source** (visibility/online signals). Web driver = localStorage + window events (current behaviour, unchanged); RN driver = MMKV + AppState/NetInfo. `sessionStorage` (the `loro.session.unmuted` key) becomes an in-memory value in the RN driver — its whole point is "this process only". `newEventId()`'s `window.crypto` fallback chain (`storage.ts:549`) becomes `expo-crypto` on RN. |
| `lib/follows.ts` | Same driver + bus injection (it deliberately duplicates the helpers — keep the no-import-of-storage rule). |
| `lib/entitlements/state.ts` | Same, plus inject `fetch` base URL for `/api/entitlements/grandfather` (relative URL today, `state.ts:300`) — RN needs an absolute API origin. |
| `lib/entitlements/paywallBus.ts` | Replace `window.CustomEvent` with a typed in-package emitter (~20 lines or `mitt`). Web `PaywallHost` and RN both subscribe to it; API (`requestPaywall`/`onPaywallRequested`) unchanged. |
| `lib/supabase.ts`, `lib/auth.ts` | Factory takes `{url, anonKey, storage, redirectTo}`; drop the `typeof window` guard in favour of "configured or not". `TABLES` and row types move with it. |
| `lib/publishedVideos.ts` | Takes the client as an argument (or reads the injected singleton). Otherwise pure. |
| `lib/youtubePlayer.ts` | Moves as the **in-WebView payload** (it is self-contained TS targeting the IFrame API) plus the `FeedMedia` type stays in core. The RN bridge implementing `FeedMedia` over postMessage is new mobile-side code. |
| `useEntitlements.ts` and the small subscriber hooks | React-only; can live in core (`core/react/`) since hooks run on both platforms. |

**Stays web-side:** `playerContext.tsx` (the slot-tracking layer — RN re-implements the *policy*, not the code), `prepareClip.ts` + upload flow, `creatorProfile.ts`/`supabaseServer.ts`, `avatar.ts` (canvas), all components, all `app/` routes.

### 7b. Public API sketch

```ts
// initialisation (each platform, once at boot)
initCore({
  storage: StorageDriver,           // sync: getItem/setItem/removeItem
  supabase: { url, anonKey, authStorage, redirectTo } | null,
  apiBaseUrl: string,               // '' on web, https origin on RN
  lifecycle: { onFlushSignal(cb) }, // visibility/online → AppState/NetInfo
  crypto: { randomUUID() },
})

// then, exactly today's surface:
storage.getSavedWords() / saveWord() / gradeWord() / saveWordAtBox() / ...
storage.onWordsChanged(cb)
computeBlankPlan(video, words, now) / computeLevelBlankPlan(...)
grade(word, wasCorrect, now) / computeStreaks(days) / weekStrip(days)
planStarterDeck(catalog, saved, watched) / orderVideosForLevel(...)
effectiveLimit(...) / requestPaywall(...) / onPaywallRequested(cb)
getSession() / onAuthChange(cb) / signInWithMagicLink(email) / signInWithGoogle()
fetchPublishedVideos() / fetchCreatorFeed(handle)
```

The deliberate property to preserve: **the entire read API stays synchronous and promise-free.** That is not incidental — the save gate, the blank planners, and the SSR-safe render guards all rely on it, and it is why the web UI never shows loading states for local data.

### 7c. What breaks on the web side when things move — checklist

- **Import paths**: every `@/lib/X` and `@/types` referencing a moved module (roughly 40 files under `app/` + `components/`) — mechanical find/replace to `@loro/core`.
- **`next.config.ts`** needs `transpilePackages`.
- **`scripts/*.mts`** (the content pipeline) import `lib/` modules with **relative `.ts`-extension specifiers** to run under plain node (e.g. `starterRounds` importing `./srs.ts`, and check-schema/publish scripts reaching into lib). These need the same treatment in the package (keep extensioned relative imports *inside* core so `node --test` still works) — this is why core should keep the `.ts`-extension style internally rather than adopting `@/`-style aliases.
- **`npm test`** glob (`lib/**/*.test.mts`) must be re-pointed at the package.
- **`storage.ts` extraction risk**: it currently imports `localVideos` (for translation upgrades) and `starterDeck` (`STARTER_VIDEO_ID`) — both move with it, so no breakage, but the 7.5 MB catalog import comes along (see R4).
- **`paywallBus` swap**: `PaywallHost`, `PlusStatistics`, `PaywallLab`, and `storage.ts` all touch it — four call sites, same signatures, low risk.
- **Behavioural invariants that must not drift** (these have tests — run them): sum-merge on sign-in, union-only progress merge, idempotent event logs, the cache-owner verdict order in `handleSession` (words awaited first, entitlements deliberately last with the merged count).

### 7d. Flagged uncertainties (verify, don't assume)

1. **MMKV vs AsyncStorage for supabase-js's auth storage** — supabase-js's RN docs assume AsyncStorage; MMKV works via a tiny adapter but is less-trodden. Either is fine since auth storage is *supabase's* concern, not the sync engine's; just don't mix drivers for one logical store.
2. **WKWebView autoplay behaviour** — settled on device (§5e, 2026-08-02): gesture-free autoplay works, the grant survives swaps and pauses in `react-native-webview`, and Low Power Mode did not suppress playback (single device, single OS build). No `bless()`/priming machinery needed in RN. The web app's own mobile-Safari version of the assumption is a separate question and remains unverified there.
3. **`onboarding/starter`'s dynamic `import('@/lib/localVideos')`** exists purely for web bundle-splitting; whether RN wants the catalog lazily `require`d, bundled, or fetched is a product decision tied to R4.
4. **Deep-link scheme** (§1 warning): the web's `/?v=` links are already stale; canonical scheme for RN should be decided with the web fix, not inferred from current links.
5. **`fetchPublishedVideos` on RN** — the web feed merges UGC after first paint; RN should probably do the same, but confirm the product wants UGC in the mobile feed at launch at all (it adds the creator-profile surface as a dependency).

---

## 8. Risk list — the five most likely sources of pain

**R1. The synchronous-storage contract (`lib/storage.ts`).** Every screen, the save gate, and the SRS planners read localStorage synchronously; the API is deliberately promise-free and the code comments call this load-bearing. AsyncStorage breaks the contract app-wide; the MMKV/in-memory-mirror approach preserves it but touches the single largest, most invariant-dense file in the repo (1,511 lines: cache-owner verdicts, three merge modes, five debounced push channels, verified-write round trips). A subtle regression here corrupts *user data across devices*, not just UI. Mitigation: the merge semantics are already extracted and tested (`wordMerge`, `progressSync`, event logs) — port the driver seam, not the logic, and run the existing node tests against the port.

**R2. The player bridge — substantially reduced by measurement (§5e), not eliminated.** The architecture itself is no longer the risk: on a physical iPhone, the clock-model-in-WebView + anchors-only bridge held extrapolation drift to ~±30ms (bounded, self-correcting), the read-after-write contract held on both sides for every seek, and gesture-free autoplay plus blessing-free swaps — including after a pause — all passed. What remains uncertain: the one unexplained −202ms drift outlier; production-scale conditions a lab doesn't reach (feed-length sessions, app backgrounding, older devices); and everything single-device — §5e is one untracked iPhone and one iOS build. Low Power Mode is no longer on this list: measured not to suppress playback (§5e). Two requirements on the bridge implementation stand: `play()` must resolve immediately when already PLAYING (miss it and the feed fires false autoplay-blocked recoveries), and the paused indicator must be gated by ownership or a swap window so the *possibly* spurious pause on swap (§5e finding 2 — seen in one log, zero on the counter in later runs) can never flash it.

**R3. Playback stalls — Low Power Mode is off the expected-conditions list; the recovery lattice is not.** Measured (§5e): iOS Low Power Mode did **not** suppress playback inside `react-native-webview` — 1× frame advance with LPM on, visually confirmed — so LPM-refused autoplay should no longer be treated as an *expected* state on RN the way the web app must treat it in mobile Safari. The stall-path contract stays, reframed as defensive design for what this spike did not cover: poor networks and cold boots, embed errors 100/101/150 (removed or embed-disabled videos), app backgrounding, and any device or iOS version other than the single untracked iPhone the lab ran on. The web app's recovery lattice (`PLAYBACK_STALL_MS` fallbacks, muted retry in `safePlay`, gesture-gated sound restore) is cheap to port and covers all of those — keep it on every playback surface.

**R4. The 7.5 MB `data/embedVideos.json` in the bundle.** The web app statically imports the full embed-transcript catalog (and already had to split `staticVideos` out and dynamic-import `localVideos` in onboarding to contain it). Metro will happily bundle 7.5 MB of JSON into the app binary and parse it at first import on the JS thread — slow startup on low-end Android, and every catalog update becomes an app-store release. The RN client almost certainly wants the catalog served remotely (or SQLite-packaged) with local caching — but `storage.ts`'s translation-upgrade path and `/vocab`'s videoId resolution assume the catalog is synchronously available, so this interacts with R1. Decide the catalog delivery model *before* building the shared package's `catalog/` module.

**R5. Feed gesture mechanics + embed-terms layout.** The feed's feel is CSS scroll-snap (`snap-y snap-mandatory`, `h-[100dvh]` slides, `overscroll-behavior-y: none`) with an IntersectionObserver at 0.6 visibility driving play/pause/blank-planning. RN replaces all of it (FlatList `pagingEnabled` + `onViewableItemsChanged` with a 60% threshold) — mechanically straightforward, but two behaviours are compliance-critical and easy to lose: **nothing may ever be drawn over the YouTube player** (flexbox band layout, no magic heights — the repo history includes exactly this violation), and the **attribution line** (channel link, CC BY chip, watch link) must stay visible on every embed slide. Treat those as acceptance criteria for the RN feed, not styling details. The deferred-release dance during slide swaps (`ownsMedia`, `ORPHAN_PAUSE_MS`, poster-through-transparent-layer) also needs a deliberate RN equivalent or swipes will flash black frames and kill the wrong video's audio.

---

*Sections 1, 2c and 3 draw on three parallel code sweeps (routes, browser APIs, entitlements) run against the same commit; core files (storage, srs, player layer, auth, Feed) were read directly in full during assembly. §5e records device measurements taken 2026-08-02 with the `rn-lab/` Expo Go lab on a physical iPhone.*
