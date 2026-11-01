import type { Metadata } from 'next';

import { LegalLinks } from '@/app/(site)/_components/legal-links';
import { BrandMark } from '@/components/site/logo';
import { buttonClass } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

/** The tab title of the sign-in page. */
export const metadata: Metadata = { title: 'Sign in' };

/**
 * The sign-in page: one button that starts the Google sign-in
 * (`/auth/login`). When a sign-in did not go through, the callback sends
 * people back here with a fixed `?error=auth` flag, never anything Google said.
 */
export default async function LoginPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ error?: string }> }>) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto mt-6 max-w-md rounded-card border border-line bg-surface px-6 py-10 text-center shadow-sm sm:mt-16 sm:px-10">
      <BrandMark className="mx-auto size-10" />
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-2 text-sm text-muted">
        Sign in to add your own feeds and get a personalised daily paper.
      </p>
      {error === 'auth' ? (
        <p
          className="mt-4 rounded-control bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-300"
          role="alert"
        >
          Signing in did not go through. Please try again.
        </p>
      ) : null}
      <div className="mt-8">
        <a
          className={buttonClass({
            variant: 'outline',
            size: 'lg',
            className: 'w-full border-line',
          })}
          href="/auth/login"
        >
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path
              fill="#EA4335"
              d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.7 30.1 0 24 0 14.6 0 6.4 5.4 2.5 13.3l7.8 6c1.9-5.6 7.1-9.8 13.7-9.8z"
            />
            <path
              fill="#4285F4"
              d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.1 5.3-4.6 6.9l7.1 5.5c4.1-3.8 6.5-9.4 6.5-16.9z"
            />
            <path
              fill="#FBBC05"
              d="M10.3 28.3c-.5-1.4-.8-2.9-.8-4.3s.3-3 .8-4.3l-7.8-6C.9 16.9 0 20.3 0 24s.9 7.1 2.5 10.3l7.8-6z"
            />
            <path
              fill="#34A853"
              d="M24 48c6.1 0 11.3-2 15-5.5l-7.1-5.5c-2 1.4-4.6 2.2-7.9 2.2-6.6 0-12.2-4.5-14.2-10.5l-7.8 6C6.4 42.6 14.6 48 24 48z"
            />
          </svg>
          Sign in with Google
        </a>
      </div>
      <div className="mt-8 text-xs text-subtle">
        <LegalLinks />
      </div>
    </div>
  );
}
