import assert from 'node:assert/strict';

import { countIPs, countIPsExact } from '../src/lib/cidr';
import { createHarness } from './prefixes-service.test';
import { test, type TestCase } from './test-utils';

const IPV6_64_CAPACITY = '18446744073709551616';

export const capacityExactTests: TestCase[] = [
  test('computes exact IPv4 and IPv6 capacities without changing legacy truncation', () => {
    const fixtures = [
      ['192.0.2.0/24', '256'],
      ['2001:db8::/64', IPV6_64_CAPACITY],
      ['2001:db8::/48', '1208925819614629174706176'],
      ['::/0', '340282366920938463463374607431768211456'],
    ] as const;

    for (const [cidr, expected] of fixtures) {
      assert.equal(countIPsExact(cidr).toString(), expected);
    }
    assert.equal(countIPs('2001:db8::/64'), Number.MAX_SAFE_INTEGER);
  }),

  test('dual-writes and serializes exact capacities when creating prefixes', async () => {
    const { prefixes, service } = createHarness();

    const ipv4 = await service.create({ cidr: '192.0.2.0/24', rir: 'APNIC' });
    const ipv6 = await service.create({ cidr: '2001:db8::/64', rir: 'APNIC' });

    assert.equal(ipv4.totalIPsExact, '256');
    assert.equal(ipv4.usedIPsExact, '0');
    assert.equal(ipv6.totalIPsExact, IPV6_64_CAPACITY);
    assert.equal(ipv6.usedIPsExact, '0');
    assert.equal(typeof ipv6.totalIPsExact, 'string');

    const storedIpv6 = prefixes.find((prefix) => prefix.cidr === '2001:db8::/64');
    assert.ok(storedIpv6);
    assert.equal(storedIpv6.totalIPsExact.toString(), IPV6_64_CAPACITY);
    assert.equal(storedIpv6.usedIPsExact.toString(), '0');
  }),

  test('dual-writes exact capacity for split children inside the topology transaction', async () => {
    const { prefixes, service } = createHarness();
    const root = await service.create({ cidr: '2001:db8:1::/63', rir: 'APNIC' });

    const result = await service.split(root.id, { newPrefixLength: 64 });

    assert.equal(result.created, 2);
    const children = prefixes.filter((prefix) => prefix.parentId === root.id);
    assert.equal(children.length, 2);
    assert.deepEqual(
      children.map((prefix) => prefix.totalIPsExact.toString()),
      [IPV6_64_CAPACITY, IPV6_64_CAPACITY],
    );
  }),

  test('reads exact-first and computes string fallbacks for E-stage legacy rows', async () => {
    const { prefixes, service } = createHarness();
    const created = await service.create({ cidr: '2001:db8:2::/64', rir: 'APNIC' });
    const stored = prefixes.find((prefix) => prefix.id === created.id);
    assert.ok(stored);
    stored.totalIPsExact = null;
    stored.usedIPsExact = null;
    stored.usedIPs = 7;

    const roots = await service.findRoots();
    const serialized = roots.items.find((prefix) => prefix.id === created.id);

    assert.ok(serialized);
    assert.equal(serialized.totalIPsExact, IPV6_64_CAPACITY);
    assert.equal(serialized.usedIPsExact, '7');
    assert.equal(typeof serialized.totalIPsExact, 'string');
  }),

  test('dual-writes exact used capacity when allocation usage changes', async () => {
    const { allocations, prefixes, service } = createHarness();
    const prefix = await service.create({ cidr: '198.51.100.0/30', rir: 'APNIC' });
    await service.generateIPs(prefix.id);
    const allocation = allocations.find((item) => item.ipAddress === '198.51.100.1');
    assert.ok(allocation);

    await service.updateAllocation(prefix.id, allocation.id, {
      status: 'Allocated',
      assignee: 'capacity-test',
      purpose: 'Server',
    });

    const stored = prefixes.find((item) => item.id === prefix.id);
    assert.ok(stored);
    assert.equal(stored.usedIPs, 1);
    assert.equal(stored.usedIPsExact.toString(), '1');
  }),
];
