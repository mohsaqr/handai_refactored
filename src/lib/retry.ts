/**
 * Retry with exponential backoff.
 * Doubles delay on each attempt: baseDelayMs → 2x → 4x …
 *
 * Non-retryable errors (auth failures, bad requests) are thrown immediately
 * without consuming remaining attempts.
 */

/** HTTP status codes that should not be retried. */
const NON_RETRYABLE_CODES = new Set([400, 401, 403, 404, 422]);

/** Fallback string tokens for providers that don't expose status codes. */
const NON_RETRYABLE_TOKENS = [
  "401", "403", "400",
  "invalid_api_key", "invalid api key",
  "authentication", "authorization",
  "bad request", "invalid request",
];

function isNonRetryable(err: unknown): boolean {
  // Prefer structured status code (Vercel AI SDK's APICallError, fetch errors, etc.)
  const status = (err as { statusCode?: number })?.statusCode
    ?? (err as { status?: number })?.status;
  if (typeof status === "number" && NON_RETRYABLE_CODES.has(status)) return true;

  // Fallback: string matching for providers that throw plain Error objects
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return NON_RETRYABLE_TOKENS.some((token) => msg.includes(token));
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
      if (isNonRetryable(err)) throw err;
      if (attempt < maxAttempts) {
        // Exponential backoff with jitter to avoid retry storms
        const base = baseDelayMs * Math.pow(2, attempt - 1);
        const jitter = Math.random() * base * 0.5;
        await new Promise((res) => setTimeout(res, base + jitter));
      }
    }
  }
  throw lastError;
}
