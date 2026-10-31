import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactElement } from 'react';

import { pageMetadata } from '@/app/_metadata';
import { Eyebrow, Heading } from '@/components/ui/layout';
import { CONTACT_EMAIL, PRIVACY_LAST_UPDATED } from '@/utils/site';

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
  title: 'Privacy',
  description:
    'What The Hacker Times keeps about you, what it asks Google for, and what it fetches on your behalf.',
  path: '/privacy',
  index: true,
});

/** How a link in the running text looks. */
const TEXT_LINK =
  'focus-ring rounded-control text-accent underline underline-offset-4 hover:text-ink';

/**
 * Privacy policy. Required for the Google OAuth consent screen / production
 * publishing, and a plain statement of exactly what the paper keeps and
 * fetches. Kept deliberately short and concrete.
 */
export default function PrivacyPage(): ReactElement {
  return (
    <div className="py-10 sm:py-16">
      <div className="max-w-2xl">
        <Eyebrow>Privacy</Eyebrow>
        <Heading as="h1" variant="h1" className="mt-2">
          Privacy Policy
        </Heading>
        <p className="mt-3 text-sm text-muted">
          Last updated: {longDate(PRIVACY_LAST_UPDATED)}
        </p>

        <div className="mt-8 space-y-9 text-lg leading-relaxed text-muted">
          <p>
            The Hacker Times is a daily newspaper made from the feeds you
            follow. Anyone can read the public Hacker News edition without
            signing in; signing in lets you choose your own feeds. This policy
            explains what it accesses and keeps.
          </p>

          <LegalSection title="What we access">
            <ul className="space-y-2">
              <LegalItem>
                Your Google account’s basic identity (name, email address and
                profile picture) — to sign you in. Signing in asks for the{' '}
                <code className="font-mono text-base">openid</code>,{' '}
                <code className="font-mono text-base">email</code> and{' '}
                <code className="font-mono text-base">profile</code> scopes
                only, and nothing else in your Google account.
              </LegalItem>
              <LegalItem>
                Google’s access token is used once, to read that identity, and
                is never stored.
              </LegalItem>
            </ul>
          </LegalSection>

          <LegalSection title="What we store">
            <ul className="space-y-2">
              <LegalItem>
                Your name, email address, the address of your profile picture,
                your Google account id, and when you first signed in.
              </LegalItem>
              <LegalItem>
                The feeds you follow: each feed’s address and title. A new
                account starts with a few default feeds, which you can remove.
              </LegalItem>
              <LegalItem>
                Each day’s edition of your paper: the title, link, summary,
                picture address, source name and (for Hacker News) points of the
                articles your feeds listed that day. Past editions are kept so
                you can page back through them.
              </LegalItem>
            </ul>
          </LegalSection>

          <LegalSection title="Fetching your feeds">
            <p>
              Once a day, and when you add or refresh a feed, the paper’s server
              fetches each feed, and the pages of its newest articles to find
              their pictures and summaries. Pictures, and the small icons of
              each source (from Google’s favicon service), are loaded through
              this site and resized by Cloudflare, so the sites they come from
              see a request from The Hacker Times rather than from your browser.
              Only addresses on the public internet are fetched.
            </p>
          </LegalSection>

          <LegalSection title="Artificial intelligence">
            <p>
              To name the publisher of each article (for example “Cornell
              University” for cs.cornell.edu), the article titles and web
              addresses’ domains from each day’s fetch are sent to Cloudflare
              Workers AI, which runs the model on Cloudflare’s network. Nothing
              about you is sent with them, and nothing is used to train any
              model.
            </p>
          </LegalSection>

          <LegalSection title="Cookies and logs">
            <ul className="space-y-2">
              <LegalItem>
                One cookie,{' '}
                <code className="font-mono text-base">broadsheet_session</code>,
                keeps you signed in. It is only readable by our server, is sent
                only to this site, and lasts up to 30 days or until you sign
                out. Two short-lived cookies (ten minutes) are used while you
                sign in, to check that the answer came from the sign-in you
                started, and to bring you back to the right page.
              </LegalItem>
              <LegalItem>
                The theme you pick is kept in your browser’s own storage and is
                never sent to us.
              </LegalItem>
              <LegalItem>
                No advertising or analytics cookies, and no trackers.
              </LegalItem>
              <LegalItem>
                Cloudflare, which hosts the paper, records each request (the
                address it came from, the page asked for, the time and the
                result) in logs that we use to keep the service running and
                secure. Search text and other query strings are removed from
                them. They are kept for a short time and are not used to profile
                you.
              </LegalItem>
            </ul>
          </LegalSection>

          <LegalSection title="What we don’t do">
            <p>
              We don’t sell or share your data, show ads, or read anything in
              your Google account beyond your basic identity. Your data is never
              used to train any model.
            </p>
          </LegalSection>

          <LegalSection title="Deleting your data">
            <p>
              You can remove any feed yourself on the Feeds page, which stops it
              being fetched for you. To delete your account, email us from the
              address you sign in with and we will remove your sign-in record,
              your feeds and their editions. To also withdraw Google’s
              permission, remove The Hacker Times at{' '}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noopener noreferrer"
                className={TEXT_LINK}
              >
                your Google account permissions
              </a>
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
