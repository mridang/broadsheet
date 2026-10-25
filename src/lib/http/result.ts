/**
 * @packageDocumentation
 *
 * The outcome of one API call: the decoded value, or a typed failure, always
 * with the raw body and (where there was a response) the HTTP status. Callers
 * branch on `ok`; a client never throws for an HTTP or decode error.
 */

/** A successful or failed API call. @public */
export type Result<T> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly raw: string;
      readonly status: number;
    }
  | {
      readonly ok: false;
      readonly error: string;
      readonly raw: string;
      readonly status?: number;
    };
