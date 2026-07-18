-- UGC upload v2: the browser extracts an audio-only file (mono 16 kHz AAC)
-- at upload time and the pipeline transcribes THAT, not the video. This is
-- the permanent fix for iPhone .mov/HEVC uploads that the Whisper API
-- rejects, and it removes the 25 MB transcription ceiling — 90 s of speech
-- audio is a few hundred KB.
--
-- The n8n import workflow should feed `audio_path` (not storage_path) to
-- whisper. `storage_path` remains the playable video.

alter table public.loro_videos
  add column if not exists audio_path text;

comment on column public.loro_videos.audio_path is
  'Storage path of the browser-extracted audio-only file (<user_id>/<video_id>.audio.m4a) — the transcription input.';
