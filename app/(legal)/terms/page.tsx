import type { Metadata } from 'next';
import Link from 'next/link';
import { PageTitle, Section, UL } from '../ui';

export const metadata: Metadata = {
  title: 'Loro — Terms of Service',
  description:
    'The terms for using Loro: accounts, subscriptions, embedded YouTube content, the creator programme, and your rights.',
};

export default function TermsPage() {
  return (
    <article>
      <PageTitle title="Terms of Service" updated="17 August 2026" />

      <Section title="What Loro is">
        <p>
          Loro is an app for learning Spanish from real videos: you watch,
          tap words you don&apos;t know, and Loro schedules them so you
          remember. On the web, Loro is currently in beta and{' '}
          <strong className="text-text">free to use</strong>. The iOS app is
          paid: beyond the introduction it requires an auto-renewing
          subscription, described in{' '}
          <strong className="text-text">Subscriptions</strong> below.
        </p>
        <p>
          Because Loro is still young, features may change, break, or be
          removed as the product develops.
        </p>
      </Section>

      <Section title="Accounts">
        <p>
          You don&apos;t need an account — the app works anonymously on your
          device. An account (email magic-link, Google, or Apple) exists to
          back up and sync your progress. You are responsible for keeping
          access to the email address you sign in with. You must be at least
          16 to use Loro. One person, one account, used honestly.
        </p>
      </Section>

      <Section title="Subscriptions (iOS app)">
        <p>
          Using the iOS app beyond the introduction requires a subscription.
          Every plan&apos;s price and billing period is shown in the app, in
          your local currency, before you are asked to pay; some plans begin
          with a free trial whose exact length is shown on the purchase
          screen.
        </p>
        <UL>
          <li>
            Payment is charged to your Apple ID and handled entirely by
            Apple — we never see your payment details.
          </li>
          <li>
            Subscriptions renew automatically until cancelled at least 24
            hours before the end of the current period. Manage or cancel any
            time in your device&apos;s Settings → Subscriptions. Cancelling
            stops future renewals; it does not end the period you already
            paid for.
          </li>
          <li>
            A free trial converts to a paid subscription unless cancelled at
            least 24 hours before the trial ends.
          </li>
          <li>
            Refunds for App Store purchases are handled by Apple — you can
            request one at reportaproblem.apple.com. Nothing in these terms
            limits your statutory consumer rights.
          </li>
          <li>
            The subscription is tied to your Apple ID, not your Loro
            account. Use <strong className="text-text">Restore purchases</strong>{' '}
            in the app to bring it back on a new device — and note that
            deleting your Loro account does{' '}
            <strong className="text-text">not</strong> cancel the
            subscription; cancel it in Settings → Subscriptions.
          </li>
        </UL>
      </Section>

      <Section title="Acceptable use">
        <p>Don&apos;t use Loro to:</p>
        <UL>
          <li>break the law, or infringe anyone&apos;s rights,</li>
          <li>
            disrupt or overload the service, probe or bypass its security, or
            access other people&apos;s data,
          </li>
          <li>
            scrape, bulk-download or redistribute the app&apos;s content or
            data,
          </li>
          <li>impersonate others or misrepresent who you are.</li>
        </UL>
      </Section>

      <Section title="Video content and YouTube">
        <p>
          Many videos in the feed are embedded from YouTube using
          YouTube&apos;s own player. Those videos belong to their creators and
          remain hosted on YouTube; Loro does not copy them and claims no
          rights over them. Playback of embedded videos is also subject to
          YouTube&apos;s Terms of Service, and a video&apos;s owner can make
          it unavailable at any time. Subtitles, translations and dictionary
          entries shown over videos are generated automatically and may
          contain errors.
        </p>
      </Section>

      <Section title="The creator programme">
        <p>
          Anyone signed in can apply to publish their own videos. Applications
          (display name, handle, bio, native language, optional sample link)
          are reviewed by a human, and approval is at our discretion —
          rejection says nothing about the quality of your content.
        </p>
        <p>
          <strong className="text-text">Your licence to us.</strong> You keep
          full ownership of videos you upload. By uploading, you grant Loro a
          non-exclusive, worldwide, royalty-free licence to store, transcode,
          transcribe, subtitle and display your video within Loro, for as long
          as it stays published. Delete a video (or your account) and the
          licence ends; we remove the content from the app.
        </p>
        <p>
          <strong className="text-text">Your promises.</strong> You must own
          the rights to everything you upload — the footage, the audio, any
          music — and have the consent of people identifiable in it.
        </p>
        <p>
          <strong className="text-text">Prohibited content.</strong> No
          unlawful content, hate speech, harassment, sexual or graphically
          violent content, dangerous misinformation, other people&apos;s
          private information, or content that infringes copyright.
        </p>
        <p>
          <strong className="text-text">Takedown.</strong> If you believe
          content in Loro infringes your rights, email{' '}
          <a
            href="mailto:radektygrtomas@gmail.com"
            className="text-text underline decoration-white/25 underline-offset-2"
          >
            radektygrtomas@gmail.com
          </a>{' '}
          with the video and the basis of your claim; we review promptly and
          remove content that violates these terms or the law. We may remove
          any content or suspend uploading at our discretion. Repeated
          infringement ends creator access.
        </p>
      </Section>

      <Section title="No warranty">
        <p>
          Loro is provided <strong className="text-text">as is</strong>,
          without warranties of availability, error-free operation, or
          accuracy of automatically generated translations and glosses. It is
          a learning aid built by one person, not a certified language course.
        </p>
      </Section>

      <Section title="Limitation of liability">
        <p>
          To the extent Czech law allows, Loro&apos;s liability for damages
          arising from use of the service is limited to what is unavoidable
          under mandatory law. Nothing in these terms limits liability that
          cannot be limited under Czech law, and nothing takes away rights you
          have as a consumer under mandatory consumer protection rules —
          including your rights around purchases made through Apple&apos;s App
          Store.
        </p>
      </Section>

      <Section title="Termination">
        <p>
          You can stop using Loro at any time, and can delete your account in
          the app (on the web: Profile → Account; in the iOS app: the Progress
          tab). Deleting your account does not cancel an active App Store
          subscription — cancel that in your device&apos;s Settings →
          Subscriptions. We may suspend or terminate accounts
          that violate these terms, and may discontinue the service — with
          reasonable notice in the app where possible. The{' '}
          <Link
            href="/privacy"
            className="text-text underline decoration-white/25 underline-offset-2"
          >
            Privacy Policy
          </Link>{' '}
          describes what happens to data on deletion.
        </p>
      </Section>

      <Section title="Changes, law, contact">
        <p>
          When these terms change, the date at the top changes; significant
          changes will be highlighted in the app. These terms are governed by
          the law of the <strong className="text-text">Czech Republic</strong>;
          if you are a consumer elsewhere in the EU, mandatory protections of
          your country still apply. Questions:{' '}
          <a
            href="mailto:radektygrtomas@gmail.com"
            className="text-text underline decoration-white/25 underline-offset-2"
          >
            radektygrtomas@gmail.com
          </a>
          .
        </p>
      </Section>
    </article>
  );
}
