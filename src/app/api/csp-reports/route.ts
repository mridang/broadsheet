/**
 * Where browsers report what the Content Security Policy blocked.
 * Without this a policy that breaks something for a real visitor is invisible:
 * the page just does not work, and nobody is told. Each report becomes one
 * structured log line, which the Worker's observability keeps.
 *
 *   POST /api/csp-reports   (application/reports+json or application/csp-report)
 */

import { NextResponse } from 'next/server';

import { readJsonBody } from '@/lib/http/body';
import { summariseReports } from '@/lib/http/csp-reports';

/** The largest report body read: a few reports are a few hundred bytes each. */
const MAX_REPORT_BYTES = 16_384;

/**
 * `POST /api/csp-reports`: take in a batch of reports from a browser. Answers
 * 204 whether or not anything was worth logging (a browser cannot do anything
 * with an answer), 400 for a body that is not JSON, and 413 for one over 16 KiB.
 * Needs no sign-in: browsers send these anonymously, and the edge limits how
 * many one address may send.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = await readJsonBody(request, MAX_REPORT_BYTES);
  if (body.kind === 'too-large') {
    return new NextResponse(null, { status: 413 });
  }
  if (body.kind !== 'ok') {
    return new NextResponse(null, { status: 400 });
  }
  summariseReports(body.value).forEach((report) => {
    console.log('[csp-report]', JSON.stringify(report));
  });
  return new NextResponse(null, {
    status: 204,
    headers: { 'Cache-Control': 'no-store' },
  });
}
