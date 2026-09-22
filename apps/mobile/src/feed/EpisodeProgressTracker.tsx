import { useEffect, useRef } from 'react';
import { onFlushSignal } from '@loro/core/platform';
import { usePlayerClock, usePlayerStatus } from '../player/PlayerHost';
import { SAVE_EVERY_MS, noteEpisodePosition, type EpisodeRef } from './episodeProgress';

/**
 * NOTES THE CLOCK WHILE AN EPISODE PLAYS. Renders nothing; sits beside
 * PlayerDriver in the feed and is mounted only on an episode shelf.
 *
 * The position is read from the RN clock model rather than asked of the
 * player: anchor + elapsed × rate while playing, the anchor alone while
 * paused — the same arithmetic the karaoke runs every frame. Saved every
 * SAVE_EVERY_MS, and once more on every way out: another episode (the
 * effect's cleanup runs before the new load re-seeds the clock), another
 * tab (`active` flips), the shelf menu opening (the player yields, `active`
 * stays — the interval covers it), and the app going to the background
 * (the flush signal, the last guaranteed moment on iOS).
 *
 * Guarded on loadedVideoId: after a switch the clock still belongs to the
 * outgoing video until loadAndPlay re-seeds it, and a tick in that gap
 * would file the old episode's minute under the new one's id.
 */
export function EpisodeProgressTracker({
  shelf,
  video,
  active,
}: {
  shelf: string;
  video: (EpisodeRef & { youtubeId: string }) | null;
  active: boolean;
}) {
  const status = usePlayerStatus();
  const { anchorTime, anchorAt, isPlaying, rate } = usePlayerClock();
  const loadedRef = useRef(status.loadedVideoId);
  loadedRef.current = status.loadedVideoId;

  useEffect(() => {
    if (!video || !active) return;
    const read = (): number | null => {
      if (loadedRef.current !== video.youtubeId) return null;
      const elapsed = isPlaying.value ? ((Date.now() - anchorAt.value) / 1000) * rate.value : 0;
      return anchorTime.value + elapsed;
    };
    const note = () => {
      const seconds = read();
      if (seconds != null) noteEpisodePosition(shelf, video, seconds);
    };
    const timer = setInterval(note, SAVE_EVERY_MS);
    const offFlush = onFlushSignal(note);
    return () => {
      clearInterval(timer);
      offFlush();
      note();
    };
  }, [shelf, video, active, anchorTime, anchorAt, isPlaying, rate]);

  return null;
}
