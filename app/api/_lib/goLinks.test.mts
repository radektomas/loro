import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GO_SLUGS, appStoreUrl, uaKind } from '../../../lib/goLinks.ts';

test('each bio link forwards to the App Store with its own campaign', () => {
  assert.equal(
    appStoreUrl('loro-app'),
    'https://apps.apple.com/app/apple-store/id6799623319?pt=129194904&ct=ig-loro-app&mt=8'
  );
  assert.equal(
    appStoreUrl('radek-spanish'),
    'https://apps.apple.com/app/apple-store/id6799623319?pt=129194904&ct=ig-radek-spanish&mt=8'
  );
  assert.equal(GO_SLUGS['radek-explains'], 'radek.explains.spanish');
});

test('an unknown slug has no target', () => {
  assert.equal(appStoreUrl('nope'), null);
  assert.equal(appStoreUrl('constructor'), null);
});

test('link previews and crawlers are bots', () => {
  for (const ua of [
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'Mozilla/5.0 (compatible; Twitterbot/1.0)',
    'Slackbot-LinkExpanding 1.0',
    'WhatsApp/2.23.20.0',
    'curl/8.4.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/120.0',
    '',
    null,
  ]) {
    assert.equal(uaKind(ua), 'bot', String(ua));
  }
});

test('a person tapping in the Instagram app is human', () => {
  assert.equal(
    uaKind(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 356.0.0.24.106 (iPhone15,2; iOS 18_1; en_US)'
    ),
    'human'
  );
});
