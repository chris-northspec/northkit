// The shared retry helper (studio standard 06, D24): exponential back-off with full
// jitter, at most 4 attempts, and only for errors that are worth another go. Callers
// must make sure a retried write is idempotent (a unique key, ON CONFLICT, or a lock
// that makes the second attempt see the first). No Node or browser APIs, so the phone
// queue can use the same back-off: it keeps its own never-give-up loop on top, because
// what it holds exists nowhere else.

export interface RetryOptions {
  /** Attempts in all, the first included. Default 4. */
  attempts?: number;
  /** Delay cap for the first retry, in ms. Default 200. */
  baseMs?: number;
  /** Largest delay between attempts, in ms. Default 5,000. */
  maxMs?: number;
  /** Whether an error is worth retrying. Default: isTransientError. */
  isTransient?: (error: unknown) => boolean;
  /** Told before each wait, e.g. to log it. */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  /** For tests: the random source and the wait. */
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * The wait before retry `attempt` (0-based): a random time up to base x 2^attempt,
 * capped. "Full jitter", so many clients failing at once don't come back in step.
 */
export function backoffDelay(
  attempt: number,
  options: { baseMs?: number; maxMs?: number; random?: () => number } = {},
): number {
  const cap = Math.min(options.maxMs ?? 5_000, (options.baseMs ?? 200) * 2 ** attempt);
  return Math.round((options.random ?? Math.random)() * cap);
}

// PostgreSQL: connection lost or refused, the server shutting down or out of
// connections, and the conflicts a second try resolves (serialization, deadlock).
const TRANSIENT_SQLSTATE = /^(08...|40001|40P01|53300|55P03|57P01|57P02|57P03)$/;
// Node's network errors for a blip rather than a wrong address or a refusal by design.
const TRANSIENT_NODE = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ESOCKET',
  'ECONNECTION',
]);

/**
 * True for errors another attempt may get past: a dropped or refused connection, a
 * timeout, a database conflict, an SMTP "try again later" (4xx). False for everything
 * else, including validation errors, constraint violations and SMTP 5xx refusals.
 */
export function isTransientError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: unknown; responseCode?: unknown; cause?: unknown };
  if (typeof e.code === 'string') {
    if (TRANSIENT_SQLSTATE.test(e.code)) return true;
    if (TRANSIENT_NODE.has(e.code)) return true;
  }
  if (typeof e.responseCode === 'number') return e.responseCode >= 400 && e.responseCode < 500;
  return e.cause !== undefined && e.cause !== error ? isTransientError(e.cause) : false;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs `fn`, retrying transient failures with back-off; rethrows the last error. */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 4);
  const transient = options.isTransient ?? isTransientError;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt + 1 >= attempts || !transient(error)) throw error;
      const delay = backoffDelay(attempt, options);
      options.onRetry?.(error, attempt + 1, delay);
      await (options.sleep ?? wait)(delay);
    }
  }
}
