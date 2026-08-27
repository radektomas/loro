/**
 * The landing page's one call to action, now that Loro is shipped.
 *
 * REPLACED THE WAITLIST FORM. Until launch this slot held WaitlistForm — an
 * email capture for the founding-member offer. The app is on the App Store, so
 * asking for an email to notify someone about a thing they can install right
 * now is a step that only loses people.
 *
 * A SERVER COMPONENT, DELIBERATELY. WaitlistForm was the only client component
 * on this page; a link needs no JavaScript, so the landing page now ships none
 * at all. Keep it that way — a CTA is the last place that should wait on
 * hydration.
 *
 * NO APPLE BADGE ARTWORK. Apple's marketing guidelines require the official
 * "Download on the App Store" lockup to be used as supplied, unaltered, and
 * this page's buttons are crest-red and rounded to match everything else on
 * it. A recreated badge would breach the guidelines and a black-and-white
 * badge would look pasted on, so this is a plain button using the page's own
 * language. If you ever want the real badge, download it from Apple's
 * marketing tools rather than drawing one.
 */

/**
 * The store listing. The id is `ascAppId` in apps/mobile/eas.json — the same
 * number EAS submits to — so the two can never drift apart silently. The
 * locale-free /app/ form lets Apple geo-redirect; hardcoding /us/ would send
 * everyone outside the US to a storefront they cannot buy from.
 */
export const APP_STORE_URL = 'https://apps.apple.com/app/id6799623319';

/** Also App Store Connect's id — see above. Powers the iOS Smart App Banner. */
export const APP_STORE_ID = '6799623319';

export function AppStoreButton({
  align = 'start',
}: {
  /** The final CTA centres itself; the hero button is left-aligned. */
  align?: 'start' | 'center';
}) {
  const centered = align === 'center';
  return (
    <div className={centered ? 'text-center' : ''}>
      <a
        href={APP_STORE_URL}
        className="inline-flex h-[52px] items-center rounded-2xl bg-[var(--loro-crest)] px-7 text-base font-semibold text-white transition-[filter,transform] duration-150 hover:-translate-y-px hover:brightness-110"
      >
        Download on the App Store
      </a>
      {/* iPhone-only, and said out loud: the page never mentions a platform
          otherwise, and an Android user deserves to learn that here rather
          than at the end of a tap. */}
      <p
        className={`mt-3 text-xs text-muted ${centered ? '' : 'max-w-lg'}`}
      >
        For iPhone. Android isn’t here yet.
      </p>
    </div>
  );
}
