/**
 * @packageDocumentation
 *
 * Where browsers send reports about this site: what the Content Security Policy
 * blocked, and what a stricter policy (Trusted Types) would have blocked. The
 * names live here, apart from the policies and the headers that use them, so
 * that both can point at the same place without importing each other.
 */

/** The address reports are sent to (`app/api/csp-reports`). */
export const CSP_REPORT_PATH = '/api/csp-reports';

/**
 * The name of the reporting group the policies point at. It is declared in the
 * `Reporting-Endpoints` header ({@link REPORTING_ENDPOINTS}), which is how the
 * current Reporting API learns where a group's reports go.
 */
export const CSP_REPORT_GROUP = 'csp-endpoint';

/** The `Reporting-Endpoints` header value: one named group, our own report address. */
export const REPORTING_ENDPOINTS = `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`;

/**
 * The two policy directives that say where reports go: `report-to` (the
 * Reporting API) and `report-uri` (older, but the only one some browsers read).
 * A browser that knows both uses `report-to`.
 */
export const CSP_REPORT_DIRECTIVES: readonly string[] = [
  `report-to ${CSP_REPORT_GROUP}`,
  `report-uri ${CSP_REPORT_PATH}`,
];

/** The name of the header that carries a policy which only reports. */
export const REPORT_ONLY_HEADER = 'Content-Security-Policy-Report-Only';
