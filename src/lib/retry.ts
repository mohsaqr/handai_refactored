/**
 * Retry with exponential backoff.
 * Doubles delay on each attempt: baseDelayMs → 2x → 4x …
 *
 * Non-retryable errors (auth failures, bad requests) are thrown immediately
 * without consuming remaining attempts.
 */

const NON_RETRYABLE = [
  "401", "403",
  "invalid_api_key", "invalid api key",
  "authentication", "authorization",
  "bad request", "400",
  "invalid request",
];

function isNonRetryable(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return NON_RETRYABLE.some((token) => msg.includes(token));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; baseDelayMs?: number } = {}
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 100;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (isNonRetryable(err)) throw err; // fail fast on auth / bad-request errors
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        await new Promise((res) => setTimeout(res, delay));
      }
    }
  }
  throw lastError;
}
