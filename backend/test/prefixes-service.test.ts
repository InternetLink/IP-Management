import assert from 'node:assert/strict';
import { PrefixesService } from '../src/prefixes/prefixes.service';
import { assertRejectsWith, test, type TestCase } from './test-utils';

type PrefixRecord = Record<string, any>;
type AllocationRecord = Record<string, any>;

function matchesWhere(record: Record<string, any>, where?: Record<string, any>): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && 'in' in value) {
      return value.in.includes(record[key]);
    }
    return record[key] === value;
  });
}

function createHarness() {
  const prefixes: PrefixRecord[] = [];
  const allocations: AllocationRecord[] = [];
  const auditLogs: any[] = [];
  let prefixSequence = 0;
  let allocationSequence = 0;

  const prisma = {
    prefix: {
      findUnique: async ({ where }: any) =>
        prefixes.find(prefix => (where.id && prefix.id === where.id) || (where.cidr && prefix.cidr === where.cidr)) ?? null,
      findMany: async ({ where }: any = {}) => prefixes.filter(prefix => matchesWhere(prefix, where)),
      create: async ({ data }: any) => {
        const now = new Date();
        const prefix = {
          id: data.id ?? `prefix-${++prefixSequence}`,
          status: 'Active',
          rir: null,
          vlan: null,
          gateway: null,
          assignedTo: null,
          usedIPs: 0,
          isPool: false,
          description: '',
          children: [],
          allocations: [],
          createdAt: now,
          updatedAt: now,
          ...data,
          parentId: data.parentId ?? null,
        };
        prefixes.push(prefix);
        return prefix;
      },
      update: async ({ where, data }: any) => {
        const prefix = prefixes.find(item => item.id === where.id);
        if (!prefix) throw new Error('Prefix not found');
        Object.assign(prefix, data, { updatedAt: new Date() });
        return prefix;
      },
      delete: async ({ where }: any) => {
        const index = prefixes.findIndex(item => item.id === where.id);
        if (index < 0) throw new Error('Prefix not found');
        const [deleted] = prefixes.splice(index, 1);
        return deleted;
      },
    },
    allocation: {
      findUnique: async ({ where }: any) => allocations.find(allocation => allocation.id === where.id) ?? null,
      findMany: async ({ where }: any = {}) => allocations.filter(allocation => matchesWhere(allocation, where)),
      createMany: async ({ data }: any) => {
        for (const row of data) {
          if (allocations.some(item => item.prefixId === row.prefixId && item.ipAddress === row.ipAddress)) continue;
          allocations.push({
            id: `allocation-${++allocationSequence}`,
            assignedDate: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
            expiryDate: null,
            ...row,
          });
        }
        return { count: data.length };
      },
      count: async ({ where }: any = {}) => allocations.filter(allocation => matchesWhere(allocation, where)).length,
      update: async ({ where, data }: any) => {
        const allocation = allocations.find(item => item.id === where.id);
        if (!allocation) throw new Error('Allocation not found');
        Object.assign(allocation, data, { updatedAt: new Date() });
        return allocation;
      },
      updateMany: async ({ where, data }: any) => {
        const matched = allocations.filter(allocation => matchesWhere(allocation, where));
        for (const allocation of matched) {
          Object.assign(allocation, data, { updatedAt: new Date() });
        }
        return { count: matched.length };
      },
    },
  };

  const audit = {
    log: async (...args: any[]) => {
      auditLogs.push(args);
    },
  };

  return {
    allocations,
    auditLogs,
    prefixes,
    service: new PrefixesService(prisma as any, audit as any),
  };
}

export const prefixesServiceTests: TestCase[] = [
  test('creates normalized root and rejects overlapping root prefixes', async () => {
    const { service } = createHarness();

    const root = await service.create({ cidr: '10.0.0.42/24', rir: 'APNIC' });
    assert.equal(root.cidr, '10.0.0.0/24');

    await assertRejectsWith(
      async () => service.create({ cidr: '10.0.0.128/25', rir: 'APNIC' }),
      /overlaps with root prefix/,
    );
  }),

  test('enforces parent containment and sibling overlap rules', async () => {
    const { service } = createHarness();

    const root = await service.create({ cidr: '10.0.0.0/16', rir: 'APNIC' });
    await service.create({ cidr: '10.0.1.0/24', parentId: root.id, status: 'Available' });

    await assertRejectsWith(
      async () => service.create({ cidr: '10.0.1.128/25', parentId: root.id, status: 'Available' }),
      /overlaps with sibling/,
    );
    await assertRejectsWith(
      async () => service.create({ cidr: '10.1.0.0/24', parentId: root.id, status: 'Available' }),
      /is not within parent/,
    );
  }),

  test('protects split size and rejects splits that overlap existing children', async () => {
    const { service } = createHarness();

    const root = await service.create({ cidr: '10.0.0.0/24', rir: 'APNIC' });
    await service.create({ cidr: '10.0.0.0/25', parentId: root.id, status: 'Available' });

    await assertRejectsWith(
      async () => service.split(root.id, { newPrefixLength: 26 }),
      /overlaps with existing child/,
    );

    const largeRoot = await service.create({ cidr: '172.16.0.0/12', rir: 'APNIC' });
    await assertRejectsWith(
      async () => service.split(largeRoot.id, { newPrefixLength: 24 }),
      /maximum is 1024/,
    );
  }),

  test('generates IPv4 /31 pools without reserving network endpoints', async () => {
    const { allocations, service } = createHarness();

    const prefix = await service.create({ cidr: '192.0.2.0/31', rir: 'APNIC' });
    const result = await service.generateIPs(prefix.id);

    assert.equal(result.generated, 2);
    assert.deepEqual(allocations.map(item => item.status), ['Available', 'Available']);
  }),

  test('updates allocation expiryDate and recalculates allocated usage', async () => {
    const { allocations, prefixes, service } = createHarness();

    const prefix = await service.create({ cidr: '198.51.100.0/30', rir: 'APNIC' });
    await service.generateIPs(prefix.id);

    const usableAllocation = allocations.find(item => item.ipAddress === '198.51.100.1');
    assert.ok(usableAllocation);

    const updated = await service.updateAllocation(prefix.id, usableAllocation.id, {
      status: 'Allocated',
      assignee: 'nginx-prod-01',
      purpose: 'Server',
      expiryDate: '2026-12-31T00:00:00.000Z',
    });

    assert.equal(updated.status, 'Allocated');
    assert.equal(updated.assignee, 'nginx-prod-01');
    assert.ok(updated.expiryDate instanceof Date);
    assert.equal(updated.expiryDate.toISOString(), '2026-12-31T00:00:00.000Z');
    assert.equal(prefixes.find(item => item.id === prefix.id)?.usedIPs, 1);
  }),

  test('bulk updates allocations and recalculates allocated usage', async () => {
    const { allocations, prefixes, service } = createHarness();

    const prefix = await service.create({ cidr: '203.0.113.0/30', rir: 'APNIC' });
    await service.generateIPs(prefix.id);
    const usableAllocations = allocations.filter(item => item.status === 'Available');

    const result = await service.bulkUpdateAllocations(prefix.id, {
      allocationIds: usableAllocations.map(item => item.id),
      status: 'Allocated',
      assignee: 'customer-a',
      purpose: 'Customer',
      expiryDate: '2027-01-01T00:00:00.000Z',
    });

    assert.equal(result.updated, 2);
    assert.equal(prefixes.find(item => item.id === prefix.id)?.usedIPs, 2);
    assert.deepEqual(usableAllocations.map(item => item.assignee), ['customer-a', 'customer-a']);
  }),
];
