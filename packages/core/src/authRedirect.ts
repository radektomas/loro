/**
 * Where to send someone after the /auth/callback exchange.
 *
 * Sign-in links can carry ?next=<path> to land the user back where they
 * started. That param is attacker-controllable — anyone can mint a Loro
 * sign-in URL — so it is treated as untrusted input and only ever allowed to
 * name a path on this origin. An absolute URL here would be an open redirect:
 * a crafted link would bounce a *freshly authenticated* user onto someone
 * else's page, arriving with the momentum and the referrer of a completed
 * Loro sign-in. That is a phishing primitive, so absolute forms are rejected
 * outright rather than coerced into something safe-looking.
 */

/**
 * Landing spot when there is no usable `next`.
 *
 * /progress, not /feed: signing in is pitched to the user as backing up their
 * progress, so the progress view is the payoff — they arrive and see the thing
 * they were promised.
 */
export const DEFAULT_AUTH_DESTINATION = '/progress';

/** The callback itself is never a valid destination — it would re-enter with
    no code and bounce straight back out. */
const CALLBACK_PATH = '/auth/callback';

/**
 * True when the value carries a control character or whitespace.
 *
 * Browsers strip tabs and newlines out of URLs before parsing them, so a value
 * containing them is not the string the checks in resolveNext would be
 * judging. No path this app generates holds one once decoded, so refuse rather
 * than reason about it. Written as a code-point scan rather than a regex
 * character class to keep literal control bytes out of this source file.
 * Characters above ASCII are deliberately left alone — a non-Latin path stays
 * valid.
 */
function hasUnsafeChars(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Resolve a trusted same-origin path from a raw `next` query param.
 *
 * Accepts only a single-slash-rooted path (optionally with query/hash).
 * Everything else — schemes, protocol-relative `//host`, its `/\host`
 * backslash disguise, bare hostnames, control characters — falls back to
 * DEFAULT_AUTH_DESTINATION. Pass the already-percent-decoded value, i.e.
 * what URLSearchParams.get() returns, so `%2f%2fevil.com` is judged as the
 * `//evil.com` it becomes.
 */
export function resolveNext(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_AUTH_DESTINATION;

  if (hasUnsafeChars(raw)) return DEFAULT_AUTH_DESTINATION;

  // Rooted path only. This one check is what rejects 'https://evil.com',
  // 'javascript:alert(1)' and 'evil.com' alike — none of them start with '/'.
  if (!raw.startsWith('/')) return DEFAULT_AUTH_DESTINATION;

  // '//evil.com' is a protocol-relative absolute URL, and '/\evil.com' is the
  // same thing after browser normalisation of the backslash. Both are rooted
  // paths by the test above, so they need their own rejection.
  if (raw.startsWith('//') || raw.startsWith('/\\')) {
    return DEFAULT_AUTH_DESTINATION;
  }

  // Self-loop: '/auth/callback', and any query/hash variant of it.
  const path = raw.split(/[?#]/)[0];
  if (path === CALLBACK_PATH || path === `${CALLBACK_PATH}/`) {
    return DEFAULT_AUTH_DESTINATION;
  }

  return raw;
}
