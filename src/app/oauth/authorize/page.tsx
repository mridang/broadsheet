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
      <div className="panel center">
        <h2>Can&apos;t connect this app</h2>
        <p className="muted">{check.description}</p>
        <p className="muted">Error: {check.error}</p>
      </div>
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
    <div className="panel center">
      <h2>Connect {client.name}</h2>
      <p className="muted">
        {client.name} wants to reach your paper as {user.email}. It will be able
        to read your feeds, editions, saved stories and the archive
        {scope.includes(SCOPE_WRITE)
          ? ', and to follow and unfollow feeds, save stories and train the paper'
          : ''}
        .
      </p>
      <p className="muted">
        You will be sent back to <code>{returnAddress(redirectUri)}</code>.
      </p>
      <form method="post" action="/oauth/consent">
        {AUTHORIZE_FIELDS.flatMap((name) => {
          const value = params[name];
          return value === undefined
            ? []
            : [<input key={name} type="hidden" name={name} value={value} />];
        })}
        <button className="btn" type="submit" name="decision" value="approve">
          Approve
        </button>{' '}
        <button className="btn" type="submit" name="decision" value="cancel">
          Cancel
        </button>
      </form>
    </div>
  );
}
