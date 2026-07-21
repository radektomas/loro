'use client';

import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { FeedMedia } from '@/types';
import { YouTubeMedia } from '@/lib/youtubePlayer';

/**
 * The playable area of a YouTube-embed slide: the official iframe player,
 * with the harvest thumbnail behind it until playback actually starts.
 *
 * Nothing may overlay this box — the embed terms prohibit visual elements in
 * front of the player, which is why the feed's subtitle band, rail, paused
 * indicator and unmute pill all live BELOW it on embed slides (see Feed.tsx).
 * The thumbnail is not an overlay: it sits UNDER the player and is covered by
 * it the moment the iframe paints.
 *
 * The player itself boots lazily on the slide's first activation (see
 * YouTubeMedia.ensurePlayer) — until then this is just an <img>, so a feed
 * with fifty embed slides mounts one iframe, not fifty.
 */
export function YouTubeSurface({
  videoId,
  poster,
  durationSeconds,
  mediaRef,
  onTap,
}: {
  videoId: string;
  poster: string;
  durationSeconds?: number;
  /** The slide's FeedMedia ref — this component owns its lifecycle. */
  mediaRef: MutableRefObject<FeedMedia | null>;
  /** Tap before the iframe exists (i.e. on the poster). */
  onTap?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // The IFrame API REPLACES the element it is handed, so give it a child
    // of our own rather than the styled container.
    const mount = document.createElement('div');
    mount.className = 'absolute inset-0 h-full w-full';
    host.appendChild(mount);
    const media = new YouTubeMedia(mount, videoId, durationSeconds);
    const onPlay = () => setStarted(true);
    media.addEventListener('play', onPlay);
    mediaRef.current = media;
    return () => {
      media.removeEventListener('play', onPlay);
      if (mediaRef.current === media) mediaRef.current = null;
      media.destroy();
      // The API may have swapped `mount` for an iframe; clear whatever is left.
      host.replaceChildren();
    };
  }, [videoId, durationSeconds, mediaRef]);

  return (
    <div
      ref={hostRef}
      onClick={onTap}
      className="relative h-full w-full overflow-hidden bg-black"
    >
      {/* Harvest thumbnail under the player: the slide is never a black hole
          while the iframe boots. Kept mounted (players can be destroyed when
          slides deactivate); faded out once real frames exist. */}
      {poster && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={poster}
          alt=""
          aria-hidden
          className={`pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
            started ? 'opacity-0' : 'opacity-100'
          }`}
        />
      )}
    </div>
  );
}
