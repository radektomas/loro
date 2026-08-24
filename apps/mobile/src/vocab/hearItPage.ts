/**
 * The "hear it in a video" page — a self-contained IFrame API player that
 * plays a single stretch of one video and STOPS just after the word is said.
 *
 * WHY NOT A PLAIN EMBED URL, which is what this started as: an `?start=N`
 * embed can begin at a timestamp but cannot end at one. The whole point of
 * this screen is a short, bounded listen — a lead-in, the word, then a beat —
 * after which the app has something to say. That needs playback control, and
 * playback control means the IFrame API.
 *
 * WHY NOT player/page.ts, which is the app's real player: that page exists to
 * be driven for a whole session by the RN clock bridge (anchors, rate mirror,
 * play-timeout emulation, swap semantics). None of it applies to a modal that
 * plays one fixed span and closes, and importing it would mean keeping this
 * screen in step with every future change to the feed's clock. What IS copied
 * — deliberately, because each was learned the hard way — is the embed
 * contract: the nocookie HOST with the loader script still on www.youtube.com
 * (the nocookie loader 404s), and the `origin` playerVar matching the
 * document's baseUrl or the API handshake fails.
 *
 * SOUND IS ON BY DESIGN. The feed creates its player muted because it
 * autoplays as you scroll and sound is a preference; here the user tapped a
 * button whose only purpose is to hear a word, so muted playback would be a
 * broken feature rather than a polite default. WKWebView allows unmuted
 * autoplay when the host sets mediaPlaybackRequiresUserAction={false}, which
 * HearItModal does. `controls: 1` is the safety net: if a device ever refuses
 * the autoplay, the user still has a play button rather than a dead frame.
 */

export type HearItPageOptions = {
  videoId: string;
  /** Where playback begins — the word's start, minus a lead-in. */
  startSeconds: number;
  /** Where it stops — the word's end, plus a beat. */
  stopSeconds: number;
  /** The document origin (WebView source.baseUrl) AND the `origin` playerVar.
      The IFrame API compares them, so they are one value. */
  embedOrigin: string;
};

export function buildHearItPage({
  videoId,
  startSeconds,
  stopSeconds,
  embedOrigin,
}: HearItPageOptions): string {
  return PAGE_TEMPLATE.replace(/__VIDEO_ID__/g, videoId)
    .replace(/__START__/g, String(startSeconds))
    .replace(/__STOP__/g, String(stopSeconds))
    .replace(/__EMBED_ORIGIN__/g, embedOrigin);
}

const PAGE_TEMPLATE = `<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;padding:0;background:#000;height:100%;overflow:hidden}#p{width:100%;height:100%}</style>
</head><body><div id="p"></div>
<script>
(function () {
  var START = __START__;
  var STOP = __STOP__;
  var player = null;
  var watch = null;
  var stopped = false;

  function post(o) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch (e) {}
  }

  /**
   * The stop watcher. A 100ms poll rather than anything cleverer: the API
   * reports currentTime on its own schedule (~250ms), so a tighter loop would
   * only re-read the same value, and the target window is half a second wide.
   */
  function startWatching() {
    if (watch) clearInterval(watch);
    watch = setInterval(function () {
      if (!player || stopped) return;
      var t = player.getCurrentTime ? player.getCurrentTime() : 0;
      if (typeof t === 'number' && isFinite(t) && t >= STOP) {
        stopped = true;
        clearInterval(watch);
        watch = null;
        try { player.pauseVideo(); } catch (e) {}
        post({ type: 'heard' });
      }
    }, 100);
  }

  // Replay the same span from the top. Called by RN via injectJavaScript.
  window.__hearItAgain = function () {
    if (!player) return;
    stopped = false;
    try {
      player.seekTo(START, true);
      player.unMute();
      player.playVideo();
    } catch (e) {}
    post({ type: 'playing' });
    startWatching();
  };

  window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player('p', {
      videoId: '__VIDEO_ID__',
      // Privacy host for the embed; the LOADER below must stay on
      // www.youtube.com — the nocookie variant 404s (verified in-repo).
      host: 'https://www.youtube-nocookie.com',
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay: 1,
        start: Math.floor(START),
        controls: 1,
        playsinline: 1,
        mute: 0,
        rel: 0,
        fs: 0,
        iv_load_policy: 3,
        modestbranding: 1,
        origin: '__EMBED_ORIGIN__'
      },
      events: {
        onReady: function () {
          try {
            player.unMute();
            player.seekTo(START, true);
            player.playVideo();
          } catch (e) {}
          post({ type: 'ready' });
          startWatching();
        },
        onStateChange: function (e) {
          // 1 = PLAYING. Reported so RN can drop its loading state on the
          // first frame that actually moves rather than on onReady, which
          // fires before the video has necessarily started.
          if (e && e.data === 1 && !stopped) post({ type: 'playing' });
        },
        onError: function (e) {
          // 100/101/150 = removed or embed-disabled. RN shows the fallback.
          post({ type: 'error', code: e && e.data });
        }
      }
    });
  };

  var s = document.createElement('script');
  s.src = 'https://www.youtube.com/iframe_api';
  s.async = true;
  s.onerror = function () { post({ type: 'error', code: 'loader' }); };
  document.head.appendChild(s);
})();
</script>
</body></html>`;
