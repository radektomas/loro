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
 * extended 2026-08-03), not from a template.
 * Every claim below maps to something the app verifiably does. If the app
 * changes, this page must change with it.
 */
export default function PrivacyPage() {
  return (
    <article>
      <PageTitle title="Privacy Policy" updated="3 August 2026" />

      <Section title="The short version">
        <p>
          Loro is built anonymous-first. You can use the whole app without an
          account, and in that mode your learning data lives only in your
          browser — we never see it. Data reaches our servers only when you
          choose something that needs them: signing in to sync, joining the
          launch waitlist, or applying as a creator. There are no ads, no
          third-party analytics and no trackers; the only usage measurement is
          our own product telemetry, described below.
        </p>
      </Section>

      <Section title="Who is responsible">
        <p>
          The data controller is <strong className="text-text">Radek Tomas</strong>,
          a private individual (not a registered company), reachable at{' '}
          <a
            href="mailto:radektygrtomas@gmail.com"
            className="text-text underline decoration-white/25 underline-offset-2"
          >
            radektygrtomas@gmail.com
          </a>
          . Contact is by email only; no postal address is published.
        </p>
      </Section>

      <Section title="Before you sign in: everything stays on your device">
        <p>
          Without an account, your saved words, review schedule, practice days,
          watched videos, level and calibration answers are stored in your
          browser&apos;s localStorage. They are not sent to us. Clearing your
          browser data deletes them.
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
              def: 'If you sign in: your email address (magic-link sign-in) or your Google account basics (email, name, profile picture — Google sign-in), plus sign-in timestamps and a profile row (level, onboarding date, statistics about whether our "save your progress" prompt was shown and what you chose, and your plan tier — free or plus, when it began, and whether you keep unlimited saves from before a saved-word limit existed). Used to operate your account and sync.',
            },
            {
              term: 'Learning data — GDPR Art. 6(1)(b), contract',
              def: 'Saved words (word, translation, which video and sentence it came from, review schedule and results), practice-day dates, watched-video list, level state, and creators you follow. This is the product; syncing it is why accounts exist.',
            },
            {
              term: 'Product telemetry — GDPR Art. 6(1)(f), legitimate interest',
              def: 'First-party event logs we write ourselves — there are no third-party analytics or trackers. The starter-deck log records progress through the onboarding deck: each card shown and answered (round, card number, the word and whether you said you knew it), each clip started or completed, and where you left if you quit early, all timestamped. The paywall log records when your saved-word count first reaches a milestone (10, 25, 40 or 50) and — only if a free-tier saved-word limit is active, which it currently is not — when a save is blocked and how the upgrade screen was answered, including the plan chosen. Collected to see where people drop off and whether the limits are set right. Stored in your browser like everything else; mirrored to your profile row while signed in. Anonymous sessions never send them.',
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
          stays in the EU (Supabase, Paris). Two specific things reach US
          providers:
        </p>
        <UL>
          <li>
            server request logs, processed by Vercel in the United States, and
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
              def: 'loro.starterEvents and loro.paywallEvents — the on-device half of the product telemetry described above. Without an account it never leaves your browser.',
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

      <Section title="How long we keep things">
        <UL>
          <li>
            Account data, learning data and product telemetry: until you
            delete your account (below).
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
        </UL>
      </Section>

      <Section title="Deleting your account">
        <p>
          In the app: <strong className="text-text">Profile → Account → Delete
          account</strong> (<Link href="/profile" className="text-text underline decoration-white/25 underline-offset-2">open your profile</Link>).
          This permanently deletes your saved words, progress, follows,
          profile — including the onboarding and paywall telemetry and the
          plan tier stored on it — creator application, uploaded videos and
          files, and the sign-in itself. One honest caveat: if your sign-in is also used by
          another service run by the same developer on the same
          infrastructure, all Loro data is deleted but the shared sign-in
          identity is kept — the app tells you when that is the case.
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
