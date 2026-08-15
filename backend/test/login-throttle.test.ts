import assert from 'node:assert/strict';
import {
  LOGIN_THROTTLE_LIMIT,
  LOGIN_THROTTLE_WINDOW_MS,
  LoginThrottle,
  LoginThrottledException,
} from '../src/auth/login-throttle';
import { test, type TestCase } from './test-utils';

function throttleError(run: () => void): LoginThrottledException {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown instanceof LoginThrottledException, 'Expected login throttling');
  return thrown;
}

export const loginThrottleTests: TestCase[] = [
  test('blocks the sixth attempt for either an IP or normalized account', () => {
    let now = 1_000;
    const throttle = new LoginThrottle({ now: () => now });

    for (let attempt = 0; attempt < LOGIN_THROTTLE_LIMIT; attempt += 1) {
      throttle.assertAllowed(`ip-${attempt}`, 'admin');
      throttle.recordFailure(`ip-${attempt}`, 'admin');
    }

    const error = throttleError(() => throttle.assertAllowed('new-ip', 'admin'));
    assert.equal(error.getStatus(), 429);
    assert.equal(error.retryAfterSeconds, LOGIN_THROTTLE_WINDOW_MS / 1000);

    now += LOGIN_THROTTLE_WINDOW_MS;
    assert.doesNotThrow(() => throttle.assertAllowed('new-ip', 'admin'));
  }),

  test('clears only the successful account penalty and preserves shared IP pressure', () => {
    const throttle = new LoginThrottle();

    for (let attempt = 0; attempt < LOGIN_THROTTLE_LIMIT; attempt += 1) {
      throttle.recordFailure('shared-ip', `account-${attempt}`);
    }
    throttle.recordFailure('other-ip', 'successful-account');
    throttle.clearAccount('successful-account');

    assert.doesNotThrow(() => throttle.assertAllowed('fresh-ip', 'successful-account'));
    assert.throws(
      () => throttle.assertAllowed('shared-ip', 'fresh-account'),
      LoginThrottledException,
    );
  }),

  test('sweeps expired entries and enforces the configured hard memory cap', () => {
    let now = 1_000;
    const throttle = new LoginThrottle({
      maxEntries: 4,
      now: () => now,
      sweepInterval: 2,
    });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      throttle.recordFailure(`ip-${attempt}`, `account-${attempt}`);
      assert.ok(throttle.entryCount() <= 4);
    }

    now += LOGIN_THROTTLE_WINDOW_MS;
    throttle.assertAllowed('cleanup-one', 'cleanup-one');
    throttle.assertAllowed('cleanup-two', 'cleanup-two');
    assert.equal(throttle.entryCount(), 0);
  }),
];
