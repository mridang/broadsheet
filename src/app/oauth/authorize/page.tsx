import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';

import { D1OAuthStore } from '@/domain/db/oauth';
import { getDatabase } from '@/domain/db/database';
import { getCurrentUser } from '@/lib/core/auth';
import { appOriginFromHeaders } from '@/lib/core/origin';
import {
  AUTHORIZE_FIELDS,
  SCOPE_WRITE,
  validateAuthorizeRequest,
  type AuthorizeParams,
} from '@/lib/oauth';
import { BrandMark } from '@/components/site/logo';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

/** The tab title of the approval screen. */
export const metadata: Metadata = { title: 'Connect an app' };

/** First value of each query parameter. */
function flatten(
  raw: Readonly<Record<string, string | readonly string[] | undefined>>,
): AuthorizeParams {
  return Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );
}

/** Where the app will be sent back to: its site, or its app scheme. */
function returnAddress(uri: string): string {
  const url = new URL(uri);
  return url.host ? url.origin : url.protocol;
}

/**
 * The screen an assistant sends people to when they connect it: who is
 * asking, what it may do, and Approve or Cancel. Signing in with Google, as
 * for the rest of the paper, happens first if needed and returns here. The
 * decision is posted to `/oauth/consent`, which checks everything again.
 * A problem with the client or its redirect URI is shown here and never sent
 * on to the app.
 */
export default async function AuthorizePage({
  searchParams,
}: Readonly<{
  searchParams: Promise<
    Readonly<Record<string, string | readonly string[] | undefined>>
  >;
}>): Promise<ReactElement> {
  const params = flatten(await searchParams);
  const origin = appOriginFromHeaders(await headers());
  const store = new D1OAuthStore(getDatabase());
  const check = await validateAuthorizeRequest(params, origin, (id) =>
    store.findClient(id),
  );
  if (!check.ok) {
    return (
      <main id="main" className="px-4">
        <Card
          padding="none"
          className="mx-auto my-10 max-w-md px-6 py-10 shadow-raised sm:my-20 sm:px-10"
        >
          <h1 className="text-2xl font-semibold tracking-tight">
            Can&apos;t connect this app
          </h1>
          <p className="mt-3 text-sm text-muted">{check.description}</p>
          <p className="mt-2 text-sm text-muted">Error: {check.error}</p>
        </Card>
      </main>
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    const query = new URLSearchParams(
      Object.entries(params).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ).toString();
    redirect(
      `/auth/login?returnTo=${encodeURIComponent(`/oauth/authorize?${query}`)}`,
    );
  }

  const { client, redirectUri, scope } = check.request;
  return (
    <main id="main" className="px-4">
      <Card
        padding="none"
        className="mx-auto my-10 max-w-md px-6 py-10 shadow-raised sm:my-20 sm:px-10"
      >
        <BrandMark className="size-10" />
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">
          Connect {client.name}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          {client.name} wants to reach your paper as {user.email}. It will be
          able to read your feeds, editions, saved stories and the archive
          {scope.includes(SCOPE_WRITE)
            ? ', and to follow and unfollow feeds, save stories and train the paper'
            : ''}
          .
        </p>
        <p className="mt-3 text-sm text-muted">
          You will be sent back to{' '}
          <code className="font-mono text-xs text-ink">
            {returnAddress(redirectUri)}
          </code>
          .
        </p>
        <form method="post" action="/oauth/consent" className="mt-8 flex gap-3">
          {AUTHORIZE_FIELDS.flatMap((name) => {
            const value = params[name];
            return value === undefined
              ? []
              : [<input key={name} type="hidden" name={name} value={value} />];
          })}
          <Button type="submit" name="decision" value="approve">
            Approve
          </Button>{' '}
          <Button
            variant="outline"
            type="submit"
            name="decision"
            value="cancel"
          >
            Cancel
          </Button>
        </form>
      </Card>
    </main>
  );
}
