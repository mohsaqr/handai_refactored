import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry } from '../retry';

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns result immediately on first success', async () => {
    const fn = vi.fn().mockResolvedValue('result');
    const promise = withRetry(fn);
    await vi.runAllTimersAsync();
    expect(await promise).toBe('result');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries after one failure and returns on second attempt', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');
    const promise = withRetry(fn, { maxAttempts: 3, baseDelayMs: 100 });
    await vi.runAllTimersAsync();
    expect(await promise).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws the last error after all attempts are exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    const promise = withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 });
    // Attach rejection handler before advancing timers to avoid unhandled rejection warnings
    const check = expect(promise).rejects.toThrow('always fails');
    await vi.runAllTimersAsync();
    await check;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('respects custom maxAttempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    const promise = withRetry(fn, { maxAttempts: 5, baseDelayMs: 10 });
    const check = expect(promise).rejects.toThrow('fail');
    await vi.runAllTimersAsync();
    await check;
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it('defaults to 3 attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    const promise = withRetry(fn);
    const check = expect(promise).rejects.toThrow('fail');
    await vi.runAllTimersAsync();
    await check;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('succeeds on the last allowed attempt', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('1'))
      .mockRejectedValueOnce(new Error('2'))
      .mockResolvedValue('third time lucky');
    const promise = withRetry(fn, { maxAttempts: 3, baseDelayMs: 50 });
    await vi.runAllTimersAsync();
    expect(await promise).toBe('third time lucky');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry on 401 auth errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('401 Unauthorized'));
    const promise = withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 });
    const check = expect(promise).rejects.toThrow('401 Unauthorized');
    await vi.runAllTimersAsync();
    await check;
    expect(fn).toHaveBeenCalledTimes(1); // no retry
  });

  it('does not retry on invalid_api_key errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('invalid_api_key: The API key provided is invalid'));
    const promise = withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 });
    const check = expect(promise).rejects.toThrow('invalid_api_key');
    await vi.runAllTimersAsync();
    await check;
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not retry on authentication errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('authentication failed'));
    const promise = withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 });
    const check = expect(promise).rejects.toThrow('authentication failed');
    await vi.runAllTimersAsync();
    await check;
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does retry on network errors (retryable)', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValue('ok');
    const promise = withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 });
    await vi.runAllTimersAsync();
    expect(await promise).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
