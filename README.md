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
