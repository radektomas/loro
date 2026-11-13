---
name: scaler
description: Plan Radek's next batch of Instagram reels from what is actually winning on his three accounts (@radek.spanish, @radek.explains.spanish, @loro.app), then cut only what he approves. Use when Radek says "plan the next batch", "/scaler", "what should I post", "scale what works", or "cut the reels" (the scaler plans before anything is cut).
---

# The scaler

Radek films; Claude cuts. The scaler sits in between: before a batch is cut, it reads which hooks, hook
styles, line-1 variants, voices, demos and channels are **winning**, assigns every clip pair waiting in the
REELS inbox a channel, hook and lines that act on the winners, **keeps the batch diverse**, and proposes
that as a plan. Radek approves it on getloro.app/marketing#plan. Nothing is cut until he has.

Radek's words (2026-11-11): "before cutting the videos check which formats / hooks are winning, then act on
it but still mix the hooks so the videos are diverse". He approves every plan; "after some time I will
see if he is good and I can let him do more work on his own". **Autonomy grows only when Radek says so**,
and the evidence is the track record on the Plan tab (repeat-a-winner median vs test median, hit rate).

## The one idea

Raw views are not evidence. Every reel is scored as a **multiple of its own channel's usual reel when it
was posted** (median of the 12 latest reels that were 48 h+ old). 1× = ordinary. A pattern is
**winning** only with 3+ reels at 1.5× or better **and** recent form holding (last 3 ≥ 1×). With fewer it's
**promising**: worth testing again, not worth betting the batch on. Won before but flopping lately is
**fading**: don't push it. Reels under 48 h old are never judged.

## Steps

1. **Report.** `node scripts/scale/report.mts`. It runs `enrich.mts` first, which:
   - auto-links posted /cut reels to their Instagram posts
   - tags them from their jobs
   - reads the hooks off the covers of older reels

   It then prints the channels, the winners per dimension (all channels and per channel), the last
   14 days' top and bottom reels, the hook-bank hooks never posted on each account, the inbox pairs, and
   the track record. Read all of it.
2. **Look at every clip** the way cut-reels step 2 and 3 say (contact sheets). The plan must fit the
   footage: a Peppa demo gets a Peppa line 1, a demo with no word tap gets a line 3 that says what's on
   screen.
3. **Assign each inbox pair one reel. WINNERS FIRST** (Radek, 2026-11-13, after the first plan flopped at
   ~0.2×: "push mainly the winning hooks, these hooks he gave me were shit"). Keep the account it was dropped
   under unless Radek says otherwise.
   - **Exploit slots (at least 3 in 4): post a proven winning hook in its proven wording.** Proven means:
     - verdict WINNING on that channel, or on all channels
     - n ≥ 3
     - **and its last 3 reels are still ≥ 1.0×** (the report prints "last 3")

     Copy the best-performing wording from the Reels tab. Only small tweaks are allowed (a number, an emoji,
     caps). Never swap in an "untested wording of a winning pattern": that's what flopped on 2026-11-12.
   - **Never exploit a FADING hook.** It used to win, but its last 3 reels are under 0.8×. The
     "3+ years… just found this" family went from 4.0× to ~0.2× (three reels at ~250 views, 2026-11-11/12).
   - **Tests are optional: at most 1 per 4 reels**, and only when there are fewer proven winners than slots.
     A test is a PROMISING hook (≥1.5×, under 3 reels) in its original wording, never a brand-new untested
     line from the bank.
   - **Diversity (`plan.mts` enforces it):** no hook twice in one batch (on any account), and not every reel in
     the same hook style. A proven winner may come back batch after batch while its recent form holds.
   - **Early read:** a reel at ≥ 55% skip rate within its first day is flopping. Say so to Radek before
     48 hours, and don't plan more of it.
   - `expected_multiple`: the hook's recent median ("last 3") on that channel, not its all-time median.
   - `reason`: one plain line Radek can judge in two seconds, e.g. "Duolingo question still wins on radek.spanish:
     1.7× over 7 reels, last 3 at 1.6×".
4. **Write the plan** to the batch folder, e.g. `~/Desktop/REELS loro app/plan-2026-11-12.json`:
   ```json
   {"batch": "2026-11-12", "summary": "Lean into question hooks on radek.spanish, test Peppa on loro.app",
    "items": [{"slot": 1, "account": "radek.spanish", "me_file": "/abs/me/IMG_1.MOV", "demo_file": "/abs/demo/IMG_2.MOV",
               "hook": "Why is your Spanish so much better than last month???", "hook_kind": "question",
               "line1_variant": "reels", "voice": "i", "demo_kind": "reels", "role": "exploit",
               "reason": "…", "expected_multiple": 2.1}]}
   ```
   Then run `node scripts/scale/plan.mts <file>`. It refuses a plan that breaks the rules and names each
   problem. Fix them and run it again.
5. **Tell Radek in chat:** one line per reel (channel, exploit or test, hook, why), then the link
   getloro.app/marketing#plan. He approves or rejects per reel there, or tells you in chat.
6. **After approval, cut** with the cut-reels skill, using the approved items as the hooks:
   - each item's hook
   - its line-1 variant and voice, with the wording adapted to the footage
   - `"plan_item_id": "<item id>"` in each job, so `publish.mts` marks the item cut and the track
     record can follow it

   A rejected item gets re-planned right here in the chat. Never fall back silently to the hook bank's
   default order. `plan.mts` prints each slot's `plan_item_id`. Check approvals with
   `node scripts/scale/report.mts --no-enrich` (open plans are listed at the end), or ask Radek.

## Facts

- All three accounts are connected through the Instagram API (tokens renew themselves). Insights lag up
  to 48 h. Instagram gives **no per-reel link taps**. Conversion is measured on our side: bio links
  `getloro.app/go/radek-spanish|radek-explains|loro-app` count taps, and App Store campaign
  `ct=ig-<slug>` (pt 129194904) counts installs. Per reel, the proxy is comments per 1k views (the
  "comment Spanish" CTA), plus shares and saves.
- Old reels' hooks were read off their covers. They can be wrong, and Radek fixes them on the Reels tab
  (marked "edited"; enrich never overwrites those).
- Only the `cut` format (hook clip, demo, 3 lines) is planned, because that's what cut-reels can make.
