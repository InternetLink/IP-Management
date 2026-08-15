import { HttpException, HttpStatus } from '@nestjs/common';

export const LOGIN_THROTTLE_LIMIT = 5;
export const LOGIN_THROTTLE_WINDOW_MS = 60_000;
export const LOGIN_THROTTLE_MAX_ENTRIES = 10_000;

const DEFAULT_SWEEP_INTERVAL = 100;

type FailureWindow = {
  count: number;
  resetAt: number;
};

type LoginThrottleOptions = {
  limit?: number;
  maxEntries?: number;
  now?: () => number;
  sweepInterval?: number;
  windowMs?: number;
};

export class LoginThrottledException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super('Too many login attempts. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
  }
}

/**
 * Limits are per application instance. Multi-instance deployments multiply the
 * available attempts because this accepted design intentionally has no shared store.
 * Expired entries are swept lazily and a hard cap evicts the oldest live entry.
 */
export class LoginThrottle {
  private readonly failures = new Map<string, FailureWindow>();
  private readonly limit: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly sweepInterval: number;
  private readonly windowMs: number;
  private checksSinceSweep = 0;

  constructor(options: LoginThrottleOptions = {}) {
    this.limit = options.limit ?? LOGIN_THROTTLE_LIMIT;
    this.maxEntries = options.maxEntries ?? LOGIN_THROTTLE_MAX_ENTRIES;
    this.now = options.now ?? Date.now;
    this.sweepInterval = options.sweepInterval ?? DEFAULT_SWEEP_INTERVAL;
    this.windowMs = options.windowMs ?? LOGIN_THROTTLE_WINDOW_MS;
  }

  assertAllowed(clientIp: string, normalizedAccount: string): void {
    const now = this.now();
    this.checksSinceSweep += 1;
    if (this.checksSinceSweep >= this.sweepInterval) {
      this.sweepExpired(now);
      this.checksSinceSweep = 0;
    }

    const retryAfterSeconds = Math.max(
      this.retryAfter(this.ipKey(clientIp), now),
      this.retryAfter(this.accountKey(normalizedAccount), now),
    );
    if (retryAfterSeconds > 0) {
      throw new LoginThrottledException(retryAfterSeconds);
    }
  }

  recordFailure(clientIp: string, normalizedAccount: string): void {
    const now = this.now();
    this.record(this.ipKey(clientIp), now);
    this.record(this.accountKey(normalizedAccount), now);
  }

  clearAccount(normalizedAccount: string): void {
    this.failures.delete(this.accountKey(normalizedAccount));
  }

  entryCount(): number {
    return this.failures.size;
  }

  private record(key: string, now: number): void {
    const current = this.failures.get(key);
    const entry = current && current.resetAt > now
      ? { count: current.count + 1, resetAt: current.resetAt }
      : { count: 1, resetAt: now + this.windowMs };

    this.failures.delete(key);
    this.ensureCapacity(now);
    this.failures.set(key, entry);
  }

  private ensureCapacity(now: number): void {
    if (this.failures.size < this.maxEntries) return;
    this.sweepExpired(now);
    while (this.failures.size >= this.maxEntries) {
      const oldestKey = this.failures.keys().next().value;
      if (typeof oldestKey !== 'string') return;
      this.failures.delete(oldestKey);
    }
  }

  private retryAfter(key: string, now: number): number {
    const entry = this.failures.get(key);
    if (!entry || entry.resetAt <= now || entry.count < this.limit) return 0;
    return Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
  }

  private sweepExpired(now: number): void {
    for (const [key, entry] of this.failures) {
      if (entry.resetAt <= now) this.failures.delete(key);
    }
  }

  private ipKey(clientIp: string): string {
    return `ip:${clientIp || 'unknown'}`;
  }

  private accountKey(normalizedAccount: string): string {
    return `account:${normalizedAccount}`;
  }
}
