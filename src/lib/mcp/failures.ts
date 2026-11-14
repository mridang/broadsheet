/**
 * @packageDocumentation
 *
 * Turning a failure into words an assistant can act on.
 *
 * Some failures are worth explaining rather than throwing: a connection the
 * person has not made yet, a service that is briefly down. What those are is
 * the app's own business, so the library asks it through a
 * {@link FailureExplainer} and keeps one call path for every app.
 */

/** Which failures an app can explain to an assistant, and how. */
export interface FailureExplainer {
  /**
   * The words to tell an assistant about this failure.
   * @param error - What was thrown, which may be anything.
   * @returns The explanation, or undefined when the failure is not one this app
   *   explains and should be handled as a backend failure or thrown on.
   */
  explain(error: unknown): string | undefined;
}

/**
 * The explainer for an app with no recoverable failure of its own. Everything
 * reaches the backend-failure handling or is thrown.
 */
export class NoExplanations implements FailureExplainer {
  /**
   * Nothing is recognised.
   * @param _error - What was thrown, which is not looked at.
   */
  explain(_error: unknown): string | undefined {
    return undefined;
  }
}
