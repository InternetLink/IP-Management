import assert from 'node:assert/strict';
import { cidrContains, cidrOverlaps, ipSortValue, parseCIDR } from '../src/lib/cidr';
import { assertRejectsWith, test, type TestCase } from './test-utils';

export const cidrTests: TestCase[] = [
  test('normalizes IPv4 CIDR to network address', () => {
    const parsed = parseCIDR('192.168.1.42/24');
    assert.equal(parsed.cidr, '192.168.1.0/24');
    assert.equal(parsed.version, 4);
    assert.equal(parsed.prefixLen, 24);
  }),

  test('normalizes IPv6 CIDR with zero compression', () => {
    const parsed = parseCIDR('2001:db8::1/64');
    assert.equal(parsed.cidr, '2001:db8::/64');
    assert.equal(parsed.version, 6);
    assert.equal(parsed.prefixLen, 64);
  }),

  test('rejects invalid IPv4 and prefix syntax', async () => {
    await assertRejectsWith(async () => parseCIDR('10.0.0.256/24'), /Invalid IPv4 address/);
    await assertRejectsWith(async () => parseCIDR('10.0.01.1/24'), /Invalid IPv4 address/);
    await assertRejectsWith(async () => parseCIDR('10.0.0.1/33'), /IPv4 prefix length/);
    await assertRejectsWith(async () => parseCIDR('10.0.0.1/24/extra'), /Invalid CIDR notation/);
    await assertRejectsWith(async () => parseCIDR('10.0.0.1/not-a-number'), /Invalid prefix length/);
  }),

  test('rejects invalid IPv6 syntax', async () => {
    await assertRejectsWith(async () => parseCIDR('2001:db8:::1/64'), /Invalid IPv6 address/);
    await assertRejectsWith(async () => parseCIDR('2001:db8::zzzz/64'), /Invalid IPv6 address/);
    await assertRejectsWith(async () => parseCIDR('2001:db8::1/129'), /IPv6 prefix length/);
  }),

  test('detects containment and overlap by numeric range', () => {
    assert.equal(cidrContains('10.0.0.0/16', '10.0.1.0/24'), true);
    assert.equal(cidrContains('10.0.1.0/24', '10.0.0.0/16'), false);
    assert.equal(cidrOverlaps('10.0.0.0/24', '10.0.0.128/25'), true);
    assert.equal(cidrOverlaps('10.0.0.0/24', '10.0.1.0/24'), false);
    assert.equal(cidrOverlaps('10.0.0.0/24', '2001:db8::/64'), false);
  }),

  test('sorts IPv4 addresses numerically', () => {
    const sorted = ['10.0.0.100', '10.0.0.2', '10.0.0.10'].sort((a, b) => {
      const av = ipSortValue(a);
      const bv = ipSortValue(b);
      return av < bv ? -1 : av > bv ? 1 : 0;
    });
    assert.deepEqual(sorted, ['10.0.0.2', '10.0.0.10', '10.0.0.100']);
  }),
];

