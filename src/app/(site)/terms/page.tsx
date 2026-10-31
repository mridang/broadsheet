import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactElement } from 'react';

import { pageMetadata } from '@/app/_metadata';
import { Eyebrow, Heading } from '@/components/ui/layout';
import { CONTACT_EMAIL, TERMS_LAST_UPDATED } from '@/utils/site';

import {
  LegalItem,
  LegalSection,
  longDate,
} from '@/app/(site)/privacy/_components/legal-section';

/**
 * A public page: it may be indexed, and it carries its own social card (the
 * image comes from the site-wide one).
 */
export const metadata: Metadata = pageMetadata({
  title: 'Terms',
  description:
    'The terms for using The Hacker Times: follow feeds you may read, and the articles stay their authors’.',
  path: '/terms',
  index: true,
});

/** How a link in the running text looks. */
const TEXT_LINK =
  'focus-ring rounded-control text-accent underline underline-offset-4 hover:text-ink';

/**
 * Terms of service, linked from the Google OAuth consent screen. Short and
 * plain, in the same layout as the privacy policy.
 */
export default function TermsPage(): ReactElement {
  return (
    <div className="py-10 sm:py-16">
      <div className="max-w-2xl">
        <Eyebrow>Terms</Eyebrow>
        <Heading as="h1" variant="h1" className="mt-2">
          Terms of Service
        </Heading>
        <p className="mt-3 text-sm text-muted">
          Last updated: {longDate(TERMS_LAST_UPDATED)}
        </p>

        <div className="mt-8 space-y-9 text-lg leading-relaxed text-muted">
          <p>
            The Hacker Times is a free service that turns the feeds you follow
            into a daily newspaper. By using it you agree to these terms. If you
            don’t, please don’t use it.
          </p>

          <LegalSection title="Using The Hacker Times">
            <ul className="space-y-2">
              <LegalItem>
                Add only feeds you are allowed to read. The paper fetches each
                feed, and the pages of its newest articles, once a day on your
                behalf.
              </LegalItem>
              <LegalItem>
                Don’t use the paper to attack, overload or get around the
                protections of any site, or to get around the paper’s own
                limits. The server limits how often anyone can call it.
              </LegalItem>
              <LegalItem>
                Keep your Google account secure: you are responsible for what is
                done with your account here.
              </LegalItem>
            </ul>
          </LegalSection>

          <LegalSection title="The articles">
            <p>
              The headlines, summaries and pictures in each edition come from
              the feeds and the sites they link to, and belong to their authors.
              The paper shows them to you as the feeds offer them, links every
              story to its source, and does not check what they say. Read the
              original for the whole story.
            </p>
          </LegalSection>

          <LegalSection title="The service">
            <p>
              The Hacker Times is provided as it is, without warranty of any
              kind. It may change, be unavailable or stop at any time, and as
              far as the law allows we are not liable for any loss from using
              it. We may remove an account that breaks these terms.
            </p>
          </LegalSection>

          <LegalSection title="Your data">
            <p>
              What the paper keeps, and how to delete it, is in the{' '}
              <Link href="/privacy" className={TEXT_LINK}>
                privacy policy
              </Link>
              .
            </p>
          </LegalSection>

          <LegalSection title="Contact">
            <p>{CONTACT_EMAIL}</p>
          </LegalSection>
        </div>

        <Link
          href="/"
          className="focus-ring mt-12 inline-flex h-10 items-center text-sm font-semibold text-muted hover:text-ink"
        >
          ← Back to the paper
        </Link>
      </div>
    </div>
  );
}
