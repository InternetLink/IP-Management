import assert from 'node:assert/strict';

import { isRequestOriginAllowed, parseOriginAllowlist } from '../src/http/origin-allowlist';
import { test, type TestCase } from './test-utils';

export const originAllowlistTests: TestCase[] = [
  test('allows absent origins and exact configured origins', () => {
    const allowed = parseOriginAllowlist('http://localhost:3003,https://ipam.example.com');

    assert.equal(isRequestOriginAllowed(undefined, allowed), true);
    assert.equal(isRequestOriginAllowed('http://localhost:3003', allowed), true);
    assert.equal(isRequestOriginAllowed('https://ipam.example.com', allowed), true);
  }),

  test('rejects foreign, malformed, and non-canonical origin headers', () => {
    const allowed = parseOriginAllowlist('https://ipam.example.com');

    assert.equal(isRequestOriginAllowed('https://evil.example', allowed), false);
    assert.equal(isRequestOriginAllowed('not-a-url', allowed), false);
    assert.equal(isRequestOriginAllowed('https://ipam.example.com/', allowed), false);
    assert.equal(isRequestOriginAllowed(['https://ipam.example.com'], allowed), false);
  }),

  test('rejects malformed allowlist configuration', () => {
    assert.throws(() => parseOriginAllowlist('https://ipam.example.com/path'), /exact origins/i);
    assert.throws(() => parseOriginAllowlist(''), /at least one origin/i);
  }),
];
