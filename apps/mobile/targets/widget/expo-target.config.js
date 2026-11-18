/**
 * THE LOCK SCREEN WIDGET (Radek, 2026-11-05: "the last saved word ... would
 * show decently on the lock screen"). One small SwiftUI target: the word you
 * saved last and its meaning, on the lock screen and the home screen.
 *
 * The app writes the word into the shared App Group (platform/lockWidget.ts)
 * and asks WidgetKit to redraw; the widget only reads. Same group as the app,
 * mirrored from app.json so the two can never disagree.
 */
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'widget',
  name: 'LoroWidget',
  displayName: 'Loro',
  bundleIdentifier: '.widget',
  // Lock screen widgets (accessory families) start at iOS 16.
  deploymentTarget: '16.0',
  icon: '../../assets/icon.png',
  colors: {
    $accent: '#5ee6a8',
    loroInk: '#0a0d0b',
    loroMint: '#5ee6a8',
  },
  images: {
    loroParrot: '../../assets/brand/loro-parrot.png',
  },
  entitlements: {
    'com.apple.security.application-groups': config.ios.entitlements['com.apple.security.application-groups'],
  },
});
