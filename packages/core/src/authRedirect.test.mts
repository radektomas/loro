import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_AUTH_DESTINATION, resolveNext } from './authRedirect.ts';

const rejected = (raw: string | null | undefined) =>
  assert.equal(resolveNext(raw), DEFAULT_AUTH_DESTINATION);

// Built from char codes rather than written as escapes: a literal control byte
// in a source file makes grep treat the whole file as binary, and these are
// exactly the characters under test.
const TAB = String.fromCharCode(0x09);
const NEWLINE = String.fromCharCode(0x0a);
const NUL = String.fromCharCode(0x00);
const DEL = String.fromCharCode(0x7f);

describe('resolveNext', () => {
  it('falls back to the default destination when there is no next', () => {
    rejected(null);
    rejected(undefined);
    rejected('');
  });

  it('keeps a relative path', () => {
    assert.equal(resolveNext('/vocab'), '/vocab');
    assert.equal(resolveNext('/creator/abc'), '/creator/abc');
    assert.equal(resolveNext('/onboarding'), '/onboarding');
  });

  it('keeps query and hash on a relative path', () => {
    assert.equal(resolveNext('/vocab?tab=saved'), '/vocab?tab=saved');
    assert.equal(resolveNext('/feed#top'), '/feed#top');
  });

  it('rejects absolute URLs', () => {
    rejected('https://evil.com/steal');
    rejected('http://evil.com');
    rejected('HTTPS://evil.com');
  });

  it('rejects protocol-relative URLs', () => {
    rejected('//evil.com');
    rejected('//evil.com/path');
  });

  it('rejects the backslash disguise browsers normalise to //', () => {
    rejected('/\\evil.com');
    rejected('/\\/evil.com');
  });

  it('rejects non-http schemes', () => {
    rejected('javascript:alert(1)');
    rejected('data:text/html,<script>alert(1)</script>');
    rejected('mailto:someone@example.com');
  });

  it('rejects a bare hostname', () => {
    rejected('evil.com');
    rejected('evil.com/path');
  });

  it('rejects control characters and whitespace', () => {
    rejected('/vo' + TAB + 'cab');
    rejected('/' + NEWLINE + 'evil.com');
    rejected('/vocab' + NUL);
    rejected('/vocab' + DEL);
    rejected('/vocab ');
    rejected(' /vocab');
  });

  it('rejects a decoded protocol-relative URL', () => {
    // URLSearchParams.get() decodes once, so '%2F%2Fevil.com' arrives here
    // already as '//evil.com'. Guard the post-decode form.
    rejected(decodeURIComponent('%2F%2Fevil.com'));
  });

  it('refuses to loop back into the callback', () => {
    rejected('/auth/callback');
    rejected('/auth/callback/');
    rejected('/auth/callback?code=abc');
  });

  it('does not confuse a sibling path with the callback', () => {
    assert.equal(resolveNext('/auth/callback-help'), '/auth/callback-help');
  });

  it('allows a non-Latin path through', () => {
    assert.equal(resolveNext('/creator/яна'), '/creator/яна');
  });
});
