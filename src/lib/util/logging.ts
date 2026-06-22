/**
 * @packageDocumentation
 *
 * Structured logging for Workers Logs. Each log call emits a single
 * JSON line (no multi-line stack traces) so the Cloudflare dashboard
 * indexes fields directly. Using these wrappers consistently means we
 * can query e.g. `event = "torrent.lookup" status:error` later.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Required + extra fields for a structured log entry. `event` and
 * `level` are always set; any other fields you pass land verbatim.
 *
 * @public
 */
export type LogFields = {
  /** Stable event identifier (e.g. `"torrent.lookup"`). */
  readonly event: string;
} & Record<string, unknown>;

function emit(level: LogLevel, fields: LogFields): void {
  const line = JSON.stringify({
    level,
    ...fields,
    ts: new Date().toISOString(),
  });
  if (level === 'error' || level === 'warn') {
    console.error(line);
  } else {
    console.log(line);
  }
}

/** Emit an info-level structured log. @public */
export function logInfo(fields: LogFields): void {
  emit('info', fields);
}

/** Emit a warn-level structured log. @public */
export function logWarn(fields: LogFields): void {
  emit('warn', fields);
}

/** Emit an error-level structured log. @public */
export function logError(fields: LogFields): void {
  emit('error', fields);
}
