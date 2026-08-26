import type { Metadata } from 'next';
import Link from 'next/link';
import { PageTitle, Rows, Section, UL } from '../ui';

export const metadata: Metadata = {
  title: 'Loro — Privacy Policy',
  description:
    'What data Loro processes, why, where it is stored, and your rights under the GDPR.',
};

/**
 * Written from a code-level data inventory (2026-07-28; re-verified and
 * extended 2026-08-03; iOS app — subscriptions, Apple sign-in, local
 * notifications — added 2026-08-17), not from a template.
 * Every claim below maps to something the app verifiably does. If the app
 * changes, this page must change with it.
 */
export default function PrivacyPage() {
  return (
    <article>
      <PageTitle title="Privacy Policy" updated="26 August 2026" />

      <Section title="The short version">
        <p>
          Loro is built anonymous-first. You can use the whole app without an
          account, and in that mode your learning data lives only on your
          device — we never see it. Your learning data reaches our servers only
          when you choose something that needs them: signing in to sync,
          joining the launch waitlist, or applying as a creator. There are no
          ads, no third-party analytics and no trackers; the only usage
          measurement is our own product telemetry, described below.
        </p>
        <p>
          One exception, stated plainly because it is the only thing we send
          without you asking: the{' '}
          <strong className="text-text">iOS app</strong> records which screens
          you reach — onboarding, the subscription screen, videos opened — and
          sends those events to us, including before you sign in and even if
          you never do. They are tied to a random identifier the app generates
          for itself on first launch, not to your name, your email or any
          identifier Apple gives us; we do not read the advertising identifier
          and we do not track you across other apps or websites. It exists so
          we can see where the app loses people. Details below under{' '}
          <em>Product telemetry</em>.
        </p>
        <p>
          The iOS app adds exactly one category: subscriptions. Payment
          happens inside Apple&apos;s systems, and a subscription-management
          service (RevenueCat) processes your subscription state so the app
          knows what you bought. We never see your payment details.
        </p>
      </Section>

      <Section title="Who is responsible">
        <p>
          The data controller is <strong className="text-text">Radek Tomas</strong>,
          a sole trader (OSVČ) registered in the Czech Republic, business
          registration number (IČO) 22052372, registered address Holečkova
          711/42, Smíchov, 150 00 Praha 5, Czechia. Contact:{' '}
          <a
            href="mailto:radektygrtomas@gmail.com"
            className="text-text underline decoration-white/25 underline-offset-2"
          >
            radektygrtomas@gmail.com
          </a>
          .
        </p>
      </Section>

      <Section title="Before you sign in: everything stays on your device">
        <p>
          Without an account, your saved words, review schedule, practice days,
          watched videos, level and calibration answers are stored in your
          browser&apos;s localStorage — or, in the iOS app, in the app&apos;s
          own on-device storage. They are not sent to us. Clearing your browser
          data (or deleting the app) deletes them.
        </p>
        <p>
          If you later sign in, this local data is merged upward into your
          account so nothing you learned is lost. From then on it syncs between
          your device and our database.
        </p>
      </Section>

      <Section title="What we process, why, and on what legal basis">
        <Rows
          rows={[
            {
              term: 'Account data — GDPR Art. 6(1)(b), contract',
              def: 'If you sign in: your email address (magic-link sign-in), your Google account basics (email, name, profile picture — Google sign-in), or your Apple ID basics (your email — which may be Apple’s private relay address if you chose Hide My Email — and your name, if you shared it; Apple sign-in), plus sign-in timestamps and a profile row (level, onboarding date, statistics about whether our "save your progress" prompt was shown and what you chose, and your plan tier — free or plus, when it began, and whether you keep unlimited saves from before a saved-word limit existed). Used to operate your account and sync.',
            },
            {
              term: 'Subscription state (iOS app) — GDPR Art. 6(1)(b), contract',
              def: 'If you use the iOS app: a random purchase identifier, your subscription and trial state, and — once you sign in — your account user ID, so your subscription can follow your account. If you installed Loro through a campaign link, that campaign’s name is attached to the purchase identifier so we can see which campaigns work. Payment itself is processed by Apple; we never receive your payment details.',
            },
            {
              term: 'Learning data — GDPR Art. 6(1)(b), contract',
              def: 'Saved words (word, translation, which video and sentence it came from, review schedule and results), practice-day dates, watched-video list, level state, and creators you follow. This is the product; syncing it is why accounts exist.',
            },
            {
              term: 'Product telemetry (web) — GDPR Art. 6(1)(f), legitimate interest',
              def: 'First-party event logs we write ourselves — there are no third-party analytics or trackers. The starter-deck log records progress through the onboarding deck: each card shown and answered (round, card number, the word and whether you said you knew it), each clip started or completed, and where you left if you quit early, all timestamped. The paywall log records when your saved-word count first reaches a milestone (10, 25, 40 or 50) and — only if a free-tier saved-word limit is active, which it currently is not — when a save is blocked and how the upgrade screen was answered, including the plan chosen. Collected to see where people drop off and whether the limits are set right. Stored in your browser like everything else; mirrored to your profile row while signed in. Anonymous sessions never send them.',
            },
            {
              term: 'Product telemetry (iOS app) — GDPR Art. 6(1)(f), legitimate interest',
              def: 'The iOS app sends a first-party event log to our own database — no third-party analytics service is involved and nothing is shared with advertisers. What is recorded: that the app was installed and each time it was opened; which onboarding screen you reached and whether you finished or skipped; that the subscription screen was shown; that you tapped subscribe and what happened next (bought, cancelled the Apple sheet, or an error, with the plan and its price); restores; and each video that took the screen, by video id. Each event carries a timestamp, the app version, and — this is the important part — a random identifier the app generates for itself the first time it runs, kept on your device. That identifier is not your name, your email, your Apple ID, your device id or the advertising identifier, and it is not shared with anyone or used to track you across other apps or websites. Reinstalling the app generates a new one, and we cannot connect the two. If you are signed in, your account id is attached as well, so that we can remove it if you delete your account. UNLIKE THE WEB LOG, THIS IS SENT WHETHER OR NOT YOU HAVE AN ACCOUNT: the app is a paid app whose subscription screen appears before sign-in, so measuring it at all means measuring people who have not signed in. Why we collect it: to see how far people get before the subscription screen, and whether the people who subscribe actually use the app. You can object to this processing at any time by emailing us (see below).',
            },
            {
              term: 'Waitlist — GDPR Art. 6(1)(a), consent',
              def: 'If you join the launch waitlist: your email address, the fact that you consented, and which form you used. Collected solely to contact you about Loro’s launch. You can withdraw consent any time by emailing us and we will remove your address.',
            },
            {
              term: 'Creator applications — GDPR Art. 6(1)(b), pre-contract steps',
              def: 'If you apply to the creator programme: display name, handle, bio, native language, and an optional sample link. Applications are reviewed by a human (the developer).',
            },
            {
              term: 'Creator uploads — GDPR Art. 6(1)(b), contract',
              def: 'If you are an approved creator and upload a video: the video file, an extracted audio track (used for transcription), a poster image, and optionally an avatar. Published videos, including your display name, handle and avatar, are publicly visible in the app.',
            },
            {
              term: 'Server logs — GDPR Art. 6(1)(f), legitimate interest',
              def: 'Our hosting provider records standard request logs (IP address, browser user agent, requested URL, time) to keep the service running and secure. Our authentication provider keeps its own sign-in logs for the same reason.',
            },
          ]}
        />
      </Section>

      <Section title="Who processes data for us">
        <Rows
          rows={[
            {
              term: 'Supabase — EU (Paris, France)',
              def: 'Authentication, database and file storage. All stored account data, learning data, the waitlist and uploaded creator files live here, in the EU. Magic-link sign-in emails are sent by Supabase itself.',
            },
            {
              term: 'Vercel — US (Washington, D.C.)',
              def: 'Hosting and serverless functions. Sees the traffic needed to serve the app, including request logs with IP addresses.',
            },
            {
              term: 'RevenueCat — US',
              def: 'Subscription management for the iOS app. Receives the purchase identifier, subscription and trial state, the campaign name where one applies, and — once you sign in — your account user ID. Never your payment details.',
            },
            {
              term: 'Apple — App Store',
              def: 'Processes iOS app payments, billing and refunds entirely inside Apple’s own systems, under Apple’s own privacy policy.',
            },
            {
              term: 'n8n cloud — EU',
              def: 'Runs the creator-video import workflow. Receives references to an uploaded video (its ID, storage paths, duration, and the creator’s user ID).',
            },
            {
              term: 'OpenAI — US',
              def: 'Transcribes creator videos: the extracted audio track (which contains the creator’s voice) is sent to the Whisper transcription service. This applies only to approved creators’ uploads — never to learner data.',
            },
            {
              term: 'YouTube / Google',
              def: 'Plays embedded videos — see the cookies section below.',
            },
            {
              term: 'unpkg.com (CDN)',
              def: 'Serves the in-browser video-processing library on the creator upload page. Your browser fetches a file from it, so it sees your IP address; no personal data is sent to it.',
            },
          ]}
        />
      </Section>

      <Section title="Does data leave the EU?">
        <p>
          Your stored data — account, learning data, waitlist, uploaded files —
          stays in the EU (Supabase, Paris). Three specific things reach US
          providers:
        </p>
        <UL>
          <li>
            server request logs, processed by Vercel in the United States,
          </li>
          <li>
            for iOS app users, subscription state, processed by RevenueCat in
            the United States, and
          </li>
          <li>
            for approved creators only, the extracted audio track of an
            uploaded video, sent to OpenAI in the United States for
            transcription.
          </li>
        </UL>
        <p>
          These transfers rely on the EU-approved safeguards the provider
          offers — standard contractual clauses, or the EU–US Data Privacy
          Framework where the provider is certified under it.
        </p>
      </Section>

      <Section title="Cookies, localStorage, and the YouTube situation">
        <p>
          Loro itself sets <strong className="text-text">no cookies</strong>.
          Everything we store in your browser is functional localStorage under
          the <code className="text-text">loro.</code> prefix:
        </p>
        <Rows
          rows={[
            {
              term: 'Learning data',
              def: 'loro.savedWords, loro.recallDays, loro.watchedVideos, loro.levelState, loro.startLevel, loro.calibrationKnown — your words, schedule and progress.',
            },
            {
              term: 'Preferences and app state',
              def: 'loro.language, loro.onboarded, loro.level, loro.starterDone, loro.savePrompt, loro.joinPromoDismissed, loro.soundOn (your standing sound choice), and loro.session.unmuted (this session’s sound state, kept only for the session).',
            },
            {
              term: 'Sync machinery',
              def: 'loro.syncQueue, loro.syncedUser, loro.follows, loro.followsQueue — pending writes and follow state — and loro.tier, a cached copy of your account’s plan tier, cleared on sign-out.',
            },
            {
              term: 'Telemetry',
              def: 'loro.starterEvents and loro.paywallEvents — the on-device half of the web product telemetry described above. Without an account it never leaves your browser. In the iOS app only, two more: loro.analytics.installId, the random per-install identifier described above, and loro.analytics.queue, events waiting to be sent (they are held on the device while it is offline and cleared once delivered). Both are destroyed when you delete your account or reset the app.',
            },
            {
              term: 'Session',
              def: 'loro.auth — your sign-in session token, if you signed in. We use no authentication cookies.',
            },
          ]}
        />
        <p>
          <strong className="text-text">YouTube embeds:</strong> many videos in
          the feed are embedded from YouTube. Players use YouTube&apos;s
          privacy-enhanced mode (youtube-nocookie.com), so rendering a player
          does not set watch-history cookies. However, the player software
          itself must be loaded from www.youtube.com, and that request can set
          Google cookies where your browser permits third-party cookies — this
          can happen once the feed reaches a video slide, before you play
          anything. It never happens on the landing page. Once you watch an
          embedded video, YouTube receives the data any video view gives it
          (such as your IP address). See{' '}
          <a
            href="https://policies.google.com/privacy"
            className="text-text underline decoration-white/25 underline-offset-2"
          >
            Google&apos;s privacy policy
          </a>
          .
        </p>
      </Section>

      <Section title="The iOS app">
        <p>
          Everything above applies to the iOS app too. The mechanical
          differences:
        </p>
        <UL>
          <li>
            Local data lives in the app&apos;s own on-device storage rather
            than browser localStorage — same keys, same content. Deleting the
            app deletes it.
          </li>
          <li>
            Practice reminders are local notifications, scheduled and
            delivered on your device. Turning them on sends nothing to us —
            there is no push server involved.
          </li>
          <li>
            Subscriptions, as described above: Apple processes payment,
            RevenueCat processes subscription state.
          </li>
        </UL>
      </Section>

      <Section title="How long we keep things">
        <UL>
          <li>
            Account data, learning data and the web product telemetry stored on
            your profile: until you delete your account (below).
          </li>
          <li>
            iOS product-telemetry events: the events themselves are kept
            indefinitely as counts, because they describe how the app behaved
            rather than who you are. Your account id is removed from them the
            moment you delete your account, and the random install identifier
            they carry is destroyed on your device at the same time — after
            which nothing links them to you or to each other.
          </li>
          <li>
            On-device data: until you clear your browser storage — it is yours,
            we cannot reach it.
          </li>
          <li>
            Waitlist: until you withdraw consent, or until the pre-launch list
            has served its purpose and is deleted.
          </li>
          <li>
            Creator applications and uploads: for as long as you are in the
            programme; deleted with your account.
          </li>
          <li>
            Backups and logs: Supabase keeps its own backups and authentication
            logs, so deleted data can persist there briefly before those
            cycles complete. Hosting request logs are short-lived operational
            records.
          </li>
          <li>
            Subscription records: Apple and RevenueCat keep purchase records
            under their own retention rules — deleting your Loro account does
            not delete Apple&apos;s record of your purchases.
          </li>
        </UL>
      </Section>

      <Section title="Deleting your account">
        <p>
          On the web: <strong className="text-text">Profile → Account → Delete
          account</strong> (<Link href="/profile" className="text-text underline decoration-white/25 underline-offset-2">open your profile</Link>).
          In the iOS app: <strong className="text-text">Progress → Danger zone
          → Delete account</strong>, reachable even without an active
          subscription via <strong className="text-text">Sign in &amp;
          account</strong> on the subscription screen.
          This permanently deletes your saved words, progress, follows,
          profile — including the onboarding and paywall telemetry and the
          plan tier stored on it — creator application, uploaded videos and
          files, and the sign-in itself. The iOS app&apos;s telemetry events
          are handled differently and deliberately so: rather than being
          deleted they are stripped of your account id, and the random install
          identifier held on your device is destroyed, so what remains is an
          anonymous count that can no longer be connected to you. One honest caveat: if your sign-in is also used by
          another service run by the same developer on the same
          infrastructure, all Loro data is deleted but the shared sign-in
          identity is kept — the app tells you when that is the case. And
          deleting your account does not cancel an App Store subscription:
          cancel that in your device&apos;s Settings → Subscriptions.
        </p>
        <p>
          The waitlist is deliberately not linked to accounts, so deleting an
          account does not remove a waitlist entry — email us for that. You can
          also request deletion of anything by email at any time.
        </p>
      </Section>

      <Section title="Your rights">
        <p>Under the GDPR you can ask us at any time to:</p>
        <UL>
          <li>access the data we hold about you (Art. 15),</li>
          <li>correct it (Art. 16),</li>
          <li>delete it (Art. 17),</li>
          <li>receive it in a portable format (Art. 20),</li>
          <li>restrict or object to processing (Art. 18, 21),</li>
          <li>withdraw any consent, without affecting past processing (Art. 7).</li>
        </UL>
        <p>
          Write to{' '}
          <a
            href="mailto:radektygrtomas@gmail.com"
            className="text-text underline decoration-white/25 underline-offset-2"
          >
            radektygrtomas@gmail.com
          </a>
          . You also have the right to complain to the Czech data protection
          authority: Úřad pro ochranu osobních údajů (
          <a
            href="https://uoou.cz"
            className="text-text underline decoration-white/25 underline-offset-2"
          >
            uoou.cz
          </a>
          ).
        </p>
      </Section>

      <Section title="Age">
        <p>Loro is intended for users aged 16 and over.</p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          When this policy changes, the date at the top changes with it.
          Significant changes will be highlighted in the app. Continued use
          after a change means the new version applies.
        </p>
      </Section>
    </article>
  );
}
