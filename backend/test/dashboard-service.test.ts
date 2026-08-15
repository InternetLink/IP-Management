import assert from 'node:assert/strict';

import { DashboardCache } from '../src/dashboard/dashboard-cache';
import { calculateUtilizationBasisPoints } from '../src/dashboard/dashboard.service';
import { test, type TestCase } from './test-utils';

export const dashboardServiceTests: TestCase[] = [
  test('calculates round-half-up basis points with exact integers and clamps the range', () => {
    assert.equal(calculateUtilizationBasisPoints(0n, 0n), 0);
    assert.equal(calculateUtilizationBasisPoints(1n, 32n), 313);
    assert.equal(calculateUtilizationBasisPoints(1n, 64n), 156);
    assert.equal(calculateUtilizationBasisPoints(3n, 8n), 3750);
    assert.equal(calculateUtilizationBasisPoints(33n, 32n), 10_000);
  }),

  test('prevents a read invalidated in flight from repopulating stale cache data', () => {
    let now = 1_000;
    const cache = new DashboardCache<string>(60_000, () => now);
    const readVersion = cache.version();

    cache.invalidate();

    assert.equal(cache.setValue('stale', readVersion), false);
    assert.equal(cache.getFresh(), null);

    assert.equal(cache.setValue('fresh'), true);
    assert.equal(cache.getFresh()?.value, 'fresh');
    now += 60_000;
    assert.equal(cache.getFresh(), null);
  }),
];
