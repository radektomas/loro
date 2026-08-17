import type { Metadata } from 'next';
import Link from 'next/link';
import { PageTitle, Rows, Section } from '../ui';

export const metadata: Metadata = {
  title: 'Loro Support',
  description:
    'Get help with Loro — contact, frequently asked questions, and legal information.',
};

const CONTACT_EMAIL = 'radektygrtomas@gmail.com';

/**
 * Public support page (App Store requirement, among others). Static and
 * unauthenticated — the (legal) group's layout provides the chrome, and there
 * is no middleware or auth wrapper anywhere above it. Every answer below is
 * checked against what the app verifiably does; if the app changes, this page
 * must change with it.
 */
export default function SupportPage() {
  return (
    <article>
      <PageTitle title="Support" />
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Loro is a Spanish learning app that turns short videos into vocabulary
        you keep.
      </p>

      <Section title="Contact">
        <p>
          For any question, problem, or data request, email{' '}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="text-text underline decoration-white/25 underline-offset-2"
          >
            {CONTACT_EMAIL}
          </a>
          . Replies typically come within 2 business days.
        </p>
      </Section>

      <Section title="Frequently asked questions">
        <Rows
          rows={[
            {
              term: 'How do I save a word?',
              def: 'Tap any word in the subtitles while a video plays, then tap "Save word". The word is stored together with its translation and the sentence it came from.',
            },
            {
              term: 'How does review work?',
              def: 'Words you save reappear in your feed as blanks to type in, inside real sentences. Reviews are spaced out over time: the better you know a word, the less often it comes back.',
            },
            {
              term: 'How do I delete my account and data?',
              def: 'In the app, go to Profile → Account → Delete account. Deletion is permanent: it removes your saved words, your progress, and your profile. If you never signed in, your data lives only on your device — clearing your browser or app storage deletes it.',
            },
            {
              term: 'Where do the videos come from?',
              def: 'Most videos are YouTube clips their creators published under a Creative Commons licence; each one is credited in the app with a link to the original video.',
            },
            {
              term: 'Is Loro free?',
              def: 'Loro offers a 7-day free trial, and after that a paid subscription. The exact price is always shown in the app before any purchase.',
            },
          ]}
        />
      </Section>

      <Section title="Legal">
        <p>
          Read our{' '}
          <Link
            href="/privacy"
            className="text-text underline decoration-white/25 underline-offset-2"
          >
            Privacy Policy
          </Link>{' '}
          and{' '}
          <Link
            href="/terms"
            className="text-text underline decoration-white/25 underline-offset-2"
          >
            Terms of Service
          </Link>
          .
        </p>
      </Section>
    </article>
  );
}
