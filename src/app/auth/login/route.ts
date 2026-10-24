/**
 * Start the Google sign-in flow. Signing in asks Google for identity only.
 * Generates a one-time `state`, stores it in a short-lived httpOnly cookie for
 * the callback to validate (CSRF protection), and redirects the browser to
 * Google's consent screen. Refuses, saying what is missing, when the server is
 * not set up for signing in: it never falls back to a made-up secret.
 *
 * The behaviour lives in the app's sign-in kit; this file only mounts it.
 */

import { authKit } from '@/domain/auth/kit';

export const GET = authKit.loginHandler();
