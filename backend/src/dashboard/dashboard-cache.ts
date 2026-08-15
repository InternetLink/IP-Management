import type { DashboardStats } from './dashboard.service';

export type CacheEntry<T> = {
  readonly value: T;
  readonly expires: number;
};

/**
 * Dashboard responses live in each application process. Another instance can
 * serve its local entry until expiry, so cross-instance staleness is bounded by
 * the cache TTL, which defaults to 60 seconds.
 */
export class DashboardCache<T> {
  private entry: CacheEntry<T> | null = null;
  // The revision prevents a read started before local invalidation from repopulating stale data.
  private revision = 0;

  constructor(
    private readonly ttlMs = 60_000,
    private readonly clock: () => number = Date.now,
  ) {}

  get(): CacheEntry<T> | null {
    return this.entry;
  }

  getFresh(): CacheEntry<T> | null {
    const entry = this.entry;
    return entry && entry.expires > this.clock() ? entry : null;
  }

  version(): number {
    return this.revision;
  }

  set(entry: CacheEntry<T>): void {
    this.entry = entry;
  }

  setValue(value: T, expectedVersion?: number): boolean {
    if (expectedVersion !== undefined && expectedVersion !== this.revision) return false;
    this.entry = { value, expires: this.clock() + this.ttlMs };
    return true;
  }

  invalidate(): void {
    this.entry = null;
    this.revision += 1;
  }
}

export const dashboardCache = new DashboardCache<DashboardStats>();
