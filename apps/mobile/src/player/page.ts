/**
 * The page that runs INSIDE the WebView: a YouTube IFrame player plus the
 * optimistic clock model.
 *
 * PORTED FROM rn-lab/App.js, not rewritten. The spike measured this exact
 * script on a physical iPhone (docs/rn-port-map.md §5e) — gesture-free
 * autoplay, grant survival across swap and pause, ±30ms clock drift, seek
 * read-after-write — so the parts that carry those results are kept verbatim:
 * the anchor model, the non-finite gate, play() timeout emulation, the 250ms
 * sampler, the swap-pause window, and every constant.
 *
 * WHY THE CLOCK LIVES HERE AND NOT IN RN. The IFrame API reports currentTime
 * roughly every 250ms; the karaoke highlight reads it every frame. Asking
 * across the bridge per frame would be 60 RPCs/second with a variable round
 * trip. Instead the model lives beside the player, and only ANCHORS cross the
 * bridge — on play, pause, seek-landed, re-anchor and ended. The RN side
 * extrapolates between them on its own UI thread.
 *
 * Plain ES5, no backticks and no ${} — it lives inside a template literal and
 * must survive being embedded untouched.
 */

export type PlayerPageOptions = {
  /** The video the player is created with. Swapped later via loadVideoById. */
  initialVideoId: string;
  /**
   * The document origin WKWebView is given (WebView `source.baseUrl`) AND the
   * `origin` playerVar. The IFrame API handshake checks the two match, so they
   * are passed as one value and must stay that way.
   */
  embedOrigin: string;
};

export function buildPlayerPage({ initialVideoId, embedOrigin }: PlayerPageOptions): string {
  return PAGE_TEMPLATE.replace(/__INITIAL_VIDEO_ID__/g, initialVideoId).replace(
    /__EMBED_ORIGIN__/g,
    embedOrigin
  );
}

const PAGE_TEMPLATE = `<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;padding:0;background:#000;height:100%;overflow:hidden}#p{width:100%;height:100%}</style>
</head><body><div id="p"></div>
<script>
(function () {
  'use strict';
  function post(o) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch (e) {}
  }
  function now() { return performance.now(); }
  function r3(x) { return Math.round(x * 1000) / 1000; }

  // Spike constants, unchanged. SEEK_CONV_S/SEEK_TIMEOUT_MS produced 10/10
  // seeks landing within 0.35s; PLAY_TIMEOUT_MS/BOOT_TIMEOUT_MS keep a slow
  // cold boot from reading as an autoplay block (which would wrongly flip the
  // feed's sound state off).
  var SEEK_CONV_S = 0.35, SEEK_TIMEOUT_MS = 1500;
  var PLAY_TIMEOUT_MS = 2500, BOOT_TIMEOUT_MS = 12000;
  var REANCHOR_EPS_S = 0.12, PERIODIC_MS = 5000;

  var player = null, playerReady = false;
  var playing = false;
  /**
   * THE SOUND STATE LIVES HERE, not in RN, and that is deliberate.
   *
   * The player is created muted (playerVars.mute = 1) because gesture-free
   * autoplay depends on it, and loadVideoById does NOT reset mute — so once the
   * user has unmuted, a swap should stay unmuted. Keeping the intent inside the
   * page means "stay unmuted across slide changes" is re-asserted next to the
   * player itself, on the PLAYING transition, rather than as an RN-side effect
   * racing the swap. It also keeps the re-assert inside the document that owns
   * the user activation the first tap granted.
   */
  var desiredMuted = true;
  /**
   * PLAYBACK RATE — TWO VARIABLES, AND THEY ARE NOT THE SAME THING.
   *
   *   rate         what the PLAYER is actually doing, mirrored from
   *                onPlaybackRateChange. The clock below multiplies by this,
   *                so it must never be a guess: YouTube silently ignores
   *                setPlaybackRate for a value the video does not offer, and a
   *                clock that believed the request would drift by exactly the
   *                amount the request was wrong by.
   *   desiredRate  the user's standing choice, re-asserted on PLAYING for the
   *                same reason desiredMuted is — loadVideoById may reset the
   *                rate, and re-asserting beside the player rather than from an
   *                RN effect keeps it out of a race with the swap.
   */
  var rate = 1;
  var desiredRate = 1;
  var anchorTime = 0, anchorAt = now(), lastRaw = -1;
  var pendingSeek = null;
  var pendingPlay = null;
  var pendingLoad = null;
  var desiredPlay = false;
  var nonFinite = 0;
  var lastPostedAnchorAt = 0;
  // §5e finding 2: a loadVideoById issued WHILE PLAYING may emit a PAUSED
  // state before the new video starts. Counted, not suppressed — the RN side
  // gates on ownership so a flash is impossible either way.
  var spuriousPause = 0;
  var swapPauseWindow = false;
  var swapWindowTimer = null;

  function openSwapWindow() {
    swapPauseWindow = true;
    if (swapWindowTimer) clearTimeout(swapWindowTimer);
    swapWindowTimer = setTimeout(function () { swapPauseWindow = false; }, 5000);
  }
  function closeSwapWindow() {
    swapPauseWindow = false;
    if (swapWindowTimer) { clearTimeout(swapWindowTimer); swapWindowTimer = null; }
  }

  function countNonFinite() {
    nonFinite++;
    post({ type: 'nonFinite', count: nonFinite });
  }
  // THE GATE: nothing non-finite ever enters the model. getCurrentTime()
  // transiently returns undefined right after loadVideoById, and one NaN in
  // the anchor freezes the clock for the rest of the session.
  function readFinite() {
    if (!playerReady) return null;
    var raw = player.getCurrentTime();
    if (typeof raw === 'number' && isFinite(raw)) return raw;
    countNonFinite();
    return null;
  }
  // THE RATE FACTOR IS THE WHOLE POINT OF THE SPEED FEATURE'S CLOCK WORK.
  // Wall-clock elapsed is not media elapsed at anything but 1x: at 0.5x the
  // media advances half as fast, so without this the model runs 2x fast and the
  // karaoke highlights words before they are spoken. At rate 1 this is a
  // multiply by one and the arithmetic is identical to what §5e measured.
  function localNow() {
    if (pendingSeek) return pendingSeek.target;  // a fresh write wins
    if (!playing) return anchorTime;
    return anchorTime + ((now() - anchorAt) / 1000) * rate;
  }
  // The anchor carries the rate it was taken at, so the RN side can never hold
  // a base from one rate and a multiplier from another — the two cross the
  // bridge in the same message rather than as two that could be reordered.
  function postAnchor(reason) {
    lastPostedAnchorAt = now();
    post({ type: 'anchor', time: r3(localNow()), playing: playing, rate: rate, reason: reason });
  }
  function postRate() {
    post({ type: 'rate', rate: rate, desired: desiredRate });
  }
  /**
   * What this video actually offers. READ, NEVER ASSUMED — the API's list is
   * per-video and the docs are explicit that it varies, so a hardcoded ladder
   * would eventually offer a rate that setPlaybackRate silently ignores, and
   * the chip would show a speed the player is not running at.
   */
  function postRates() {
    var list = null;
    try { list = player.getAvailablePlaybackRates(); } catch (e) { list = null; }
    post({ type: 'rates', rates: (list && list.length) ? list : null });
  }
  /**
   * Adopt a rate the PLAYER has reported, re-basing the clock at the switch.
   *
   * THE RE-BASE IS NOT OPTIONAL. localNow() multiplies the whole span since
   * anchorAt by the current rate, so changing the multiplier without first
   * banking the elapsed media time would retroactively re-price every second
   * since the last anchor at the new rate — a jump of (elapsed x rate delta)
   * the instant the user taps. Bank first, then switch.
   */
  function applyRate(next) {
    if (!(typeof next === 'number' && isFinite(next) && next > 0)) return;
    if (next === rate) return;
    var banked = localNow();
    anchorTime = banked;
    anchorAt = now();
    rate = next;
    postRate();
    postAnchor('rate');
  }
  // The PLAYER's real mute state, never RN's hope of it. The indicator reads
  // this, so a refused unmute shows as still-muted instead of lying.
  function postMuted() {
    var m = playerReady ? player.isMuted() : true;
    post({ type: 'muted', muted: m === true });
  }

  // play() emulation: the IFrame API has no rejection for blocked playback —
  // a blocked play simply never reaches PLAYING. Resolve on PLAYING, settle
  // with a synthetic error on silence.
  function settlePlay(errText) {
    if (!pendingPlay) return;
    var p = pendingPlay; pendingPlay = null;
    clearTimeout(p.timer);
    post({ type: 'playResult', id: p.id, ok: false,
           elapsedMs: Math.round(now() - p.started), error: errText });
  }
  function armPlay(id, ms) {
    settlePlay('AbortError (superseded by a new play)');
    var p = { id: id, started: now(), timer: null };
    p.timer = setTimeout(function () {
      if (pendingPlay !== p) return;
      pendingPlay = null;
      post({ type: 'playResult', id: p.id, ok: false,
             elapsedMs: Math.round(now() - p.started),
             error: 'NotAllowedError (no PLAYING within ' + ms + 'ms)' });
    }, ms);
    pendingPlay = p;
  }

  function onState(e) {
    var s = (e && typeof e.data === 'number') ? e.data : -2;
    post({ type: 'state', state: s });
    if (s === 1) {
      playing = true;
      closeSwapWindow();
      // STAY UNMUTED ACROSS SLIDE CHANGES. A swap should not silently return
      // the feed to muted; if the user has granted sound, re-assert it as each
      // new video reaches PLAYING. Idempotent — isMuted() gates the call — and
      // harmless when the player already carried the state across the swap.
      if (!desiredMuted && player.isMuted()) {
        player.unMute();
        postMuted();
      }
      // STAY AT THE CHOSEN SPEED ACROSS SLIDE CHANGES, same contract as mute
      // above and for the same reason: loadVideoById may reset the rate, and
      // re-asserting here — beside the player, on the transition — keeps it out
      // of a race with the swap that an RN-side effect would be in. Compared
      // against the PLAYER's value, not our mirror, so a reset we were never
      // told about is still caught. onPlaybackRateChange confirms.
      var live = player.getPlaybackRate();
      if (typeof live === 'number' && isFinite(live) && live !== desiredRate) {
        player.setPlaybackRate(desiredRate);
      }
      var raw = readFinite();
      if (raw !== null) { lastRaw = raw; anchorTime = raw; anchorAt = now(); }
      postAnchor('play');
      post({ type: 'event', name: 'play' });
      if (pendingPlay) {
        var p = pendingPlay; pendingPlay = null;
        clearTimeout(p.timer);
        post({ type: 'playResult', id: p.id, ok: true,
               elapsedMs: Math.round(now() - p.started) });
      }
    } else if (s === 2) {
      if (swapPauseWindow) {
        spuriousPause++;
        post({ type: 'spuriousPause', count: spuriousPause });
      }
      playing = false;
      if (!pendingSeek) {
        var raw2 = readFinite();
        if (raw2 !== null) { anchorTime = raw2; anchorAt = now(); }
      }
      postAnchor('pause');
      post({ type: 'event', name: 'pause' });
    } else if (s === 0) {
      playing = false;
      postAnchor('ended');
      post({ type: 'event', name: 'ended' });
    } else if (s === 5) {
      if (playing) { playing = false; postAnchor('cued'); }
    }
    // -1 UNSTARTED / 3 BUFFERING keep the current playing state on purpose.
  }

  // The 250ms sampler: seek convergence + silent re-anchor. Anchors are POSTED
  // only on a real correction (>0.12s) or as a 5s heartbeat — that is what
  // keeps the bridge quiet while the RN side extrapolates.
  setInterval(function () {
    if (!playerReady) return;
    if (pendingSeek) {
      var ps = pendingSeek;
      var raw = readFinite();
      var moved = raw !== null && isFinite(ps.sampleAtWrite) && raw !== ps.sampleAtWrite;
      var near = raw !== null && Math.abs(raw - ps.target) < SEEK_CONV_S;
      var expired = now() - ps.at > SEEK_TIMEOUT_MS;
      if ((moved && near) || expired) {
        pendingSeek = null;
        anchorTime = raw !== null ? raw : ps.target;
        anchorAt = now();
        postAnchor('seek-landed');
        post({ type: 'seekResult', id: ps.id, target: ps.target,
               landedMs: Math.round(now() - ps.at), landed: !expired });
      }
      return;
    }
    if (!playing) return;
    var raw2 = readFinite();
    if (raw2 === null || raw2 === lastRaw) return;
    var drift = Math.abs(raw2 - localNow());
    lastRaw = raw2;
    anchorTime = raw2;
    anchorAt = now();
    if (drift > REANCHOR_EPS_S) {
      postAnchor('reanchor(+' + Math.round(drift * 1000) + 'ms)');
    } else if (now() - lastPostedAnchorAt > PERIODIC_MS) {
      postAnchor('periodic');
    }
  }, 250);

  // Commands from RN (injectJavaScript calls window.__cmd(...)).
  window.__cmd = function (c) {
    if (c.cmd === 'play') {
      desiredPlay = true;
      // §5e finding 1: resolve IMMEDIATELY when already PLAYING. Waiting for a
      // state transition that never comes produced false NotAllowedError
      // timeouts in the lab — and on the feed that means spurious
      // autoplay-blocked recovery on a video that is in fact playing.
      if (playerReady && playing) {
        post({ type: 'playResult', id: c.id, ok: true, elapsedMs: 0 });
        return;
      }
      armPlay(c.id, playerReady ? PLAY_TIMEOUT_MS : BOOT_TIMEOUT_MS);
      if (playerReady) player.playVideo();
    } else if (c.cmd === 'pause') {
      desiredPlay = false;
      settlePlay('AbortError (interrupted by pause)');
      if (playerReady) player.pauseVideo();
    } else if (c.cmd === 'load') {
      if (playing) openSwapWindow();
      // Reset the model exactly as the web adapter does: the old video's
      // samples say nothing about the new one, and leaving them would let the
      // outgoing clock drive the incoming slide's highlighting.
      anchorTime = 0; anchorAt = now(); lastRaw = -1; pendingSeek = null;
      postAnchor('load');
      if (c.andPlay) {
        desiredPlay = true;
        armPlay(c.id, playerReady ? PLAY_TIMEOUT_MS : BOOT_TIMEOUT_MS);
        if (playerReady) player.loadVideoById(c.videoId);
        else pendingLoad = c;
      } else {
        if (playerReady) player.cueVideoById(c.videoId);
        else pendingLoad = c;
      }
    } else if (c.cmd === 'seek') {
      var sw = NaN;
      if (playerReady) {
        var s = player.getCurrentTime();
        if (typeof s === 'number' && isFinite(s)) sw = s;
        else countNonFinite();
      }
      pendingSeek = { target: c.time, at: now(), sampleAtWrite: sw, id: c.id };
      anchorTime = c.time; anchorAt = now();
      if (playerReady) player.seekTo(c.time, true);
      postAnchor('seek-write');
    } else if (c.cmd === 'mute') {
      // A DELIBERATE mute — the user tapping the sound pill off. Recorded as
      // intent so the PLAYING re-assert above does not undo it on the next swap.
      desiredMuted = true;
      if (playerReady) player.mute();
      postMuted();
    } else if (c.cmd === 'unmute') {
      // §5e card 6 measured this exact path — unMute() driven from a real RN
      // touch handler — as PASS by state: unmuted and still PLAYING. It is
      // issued from inside the Pressable's onPress for that reason; do not move
      // it to an effect or a timer.
      desiredMuted = false;
      if (playerReady) player.unMute();
      postMuted();
    } else if (c.cmd === 'rate') {
      // Intent is recorded whether or not the player honours it: an unsupported
      // value is IGNORED by setPlaybackRate with no error and no event, so
      // the rate mirror stays where it was and RN keeps displaying the truth.
      // The chip
      // showing 1x after a tap therefore means "this video will not go slower",
      // which is exactly what the user needs to know.
      if (typeof c.rate === 'number' && isFinite(c.rate) && c.rate > 0) {
        desiredRate = c.rate;
        if (playerReady) player.setPlaybackRate(c.rate);
      }
    } else if (c.cmd === 'rates') {
      if (playerReady) postRates();
    } else if (c.cmd === 'sample') {
      // Ground truth for the drift readout: the RAW player clock, deliberately
      // NOT the model, so the RN extrapolation can be checked against it.
      var raw3 = playerReady ? player.getCurrentTime() : NaN;
      var fin = typeof raw3 === 'number' && isFinite(raw3);
      if (playerReady && !fin) countNonFinite();
      post({ type: 'sample', id: c.id, raw: fin ? r3(raw3) : null,
             local: r3(localNow()), playing: playing, nonFinite: nonFinite });
    }
  };

  // Boot.
  post({ type: 'log', msg: 'page booted, origin=' + location.origin });
  window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player('p', {
      videoId: '__INITIAL_VIDEO_ID__',
      // Privacy host for the embed; the LOADER script below must stay on
      // www.youtube.com — the nocookie variant 404s (verified in-repo).
      host: 'https://www.youtube-nocookie.com',
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay: 0, controls: 0, playsinline: 1,
        // REQUIRED for gesture-free playback: the decision is made from the
        // player's state at CREATION. Muting later in onReady is too late.
        mute: 1,
        rel: 0, fs: 0, disablekb: 1, iv_load_policy: 3,
        origin: '__EMBED_ORIGIN__',
      },
      events: {
        onReady: function () {
          playerReady = true;
          player.mute();
          post({ type: 'ready' });
          postMuted();
          postRate();
          postRates();
          if (pendingLoad) {
            var c = pendingLoad; pendingLoad = null;
            if (c.andPlay) player.loadVideoById(c.videoId);
            else player.cueVideoById(c.videoId);
            if (pendingPlay) { clearTimeout(pendingPlay.timer); armPlay(pendingPlay.id, PLAY_TIMEOUT_MS); }
          } else if (desiredPlay) {
            player.playVideo();
            if (pendingPlay) { clearTimeout(pendingPlay.timer); armPlay(pendingPlay.id, PLAY_TIMEOUT_MS); }
          }
        },
        onStateChange: onState,
        // The ONLY writer of the rate mirror. Every path that wants a new speed goes
        // through setPlaybackRate and waits to be told — so the clock's
        // multiplier is always something the player confirmed, never something
        // RN asked for. The available list is re-read here too: it is per-video
        // and a swap can change it.
        onPlaybackRateChange: function (e) {
          applyRate(e && typeof e.data === 'number' ? e.data : 1);
          postRates();
        },
        onError: function (e) {
          // 100/101/150 = removed or embed-disabled. Settle the pending play
          // so the slide falls to its stall path instead of hanging.
          post({ type: 'error', code: e && e.data });
          settlePlay('NotAllowedError (player error ' + (e && e.data) + ')');
        },
      },
    });
  };
  var scriptEl = document.createElement('script');
  scriptEl.src = 'https://www.youtube.com/iframe_api';
  scriptEl.async = true;
  scriptEl.onerror = function () { post({ type: 'log', msg: 'FAILED to load iframe_api' }); };
  document.head.appendChild(scriptEl);
})();
</script>
</body></html>`;
