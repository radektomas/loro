import logo from '../../assets/brand/loro-logo.png';
import parrot from '../../assets/brand/loro-parrot.png';
import parrotWaving from '../../assets/brand/loro-parrot-waving.png';

/**
 * Loro's brand art, bundled.
 *
 * WHERE THESE CAME FROM. The web serves the same three from public/brand/
 * (loro-logo.png, loro-mascot.png, loro-mascot-waving.png); these are those
 * files downscaled to roughly 3x their largest on-screen size, which is what
 * cut ~900KB down to ~390KB with no visible loss. The originals stay the
 * source of truth: re-export from public/brand rather than editing these.
 *
 * NOT components/LoroMascot.tsx. That is an inline SVG the web renders through
 * three states (idle / happy / sleeping), and its own comment calls it a
 * "geometric placeholder, to be art-directed later" — the finished art is the
 * PNG. Porting the SVG would have meant react-native-svg, a native module, so
 * a rebuild for a drawing that is already superseded.
 *
 * PNG RATHER THAN WEBP, deliberately. WebP is smaller, and RN's iOS image
 * pipeline does not decode it without extra native configuration, while
 * Android does. One format that works on both beats a smaller one that works
 * on one. All three keep their alpha channel (colour type 6), so they sit on
 * the dark ground with no matte.
 *
 * Sizing lives at the call site, always as explicit width/height. These are
 * unsuffixed files rather than an @2x/@3x set, so RN treats each as 1x and
 * scales it down from the bundled resolution.
 */
export const BRAND = {
  /** Wordmark plus parrot, 660x327. The logo lockup, for the opening screen. */
  logo,
  /** The parrot alone, 282x420. */
  parrot,
  /** The parrot mid-wave, 375x420. Reads as hello or goodbye, so it is used
      on the handoff into the feed. */
  parrotWaving,
};
