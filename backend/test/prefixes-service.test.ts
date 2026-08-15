import assert from 'node:assert/strict';
import { PrefixesService } from '../src/prefixes/prefixes.service';
import { assertRejectsWith, test, type TestCase } from './test-utils';

type PrefixRecord = Record<string, any>;
type AllocationRecord = Record<string, any>;

function matchesWhere(record: Record<string, any>, where?: Record<string, any>): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR' && Array.isArray(value)) {
      return value.some(condition => matchesWhere(record, condition));
    }
    if (value && typeof value === 'object' && 'in' in value) {
      return value.in.includes(record[key]);
    }
    if (value && typeof value === 'object' && 'contains' in value) {
      return String(record[key] ?? '').toLowerCase().includes(String(value.contains).toLowerCase());
    }
    return record[key] === value;
  });
}

export function createHarness() {
  const prefixes: PrefixRecord[] = [];
  const allocations: AllocationRecord[] = [];
  const allocationGroupByQueries: Record<string, unknown>[] = [];
  const auditLogs: any[] = [];
  const addressSpaceLocks = new Set(['root:v4', 'root:v6']);
  let prefixSequence = 0;
  let allocationSequence = 0;

  const prisma: any = {
    $transaction: async (fn: any) => fn(prisma),
    $queryRaw: async (_strings: TemplateStringsArray, key: string) =>
      addressSpaceLocks.has(key) ? [{ key }] : [],
    addressSpaceLock: {
      upsert: async ({ create }: { create: { key: string } }) => {
        addressSpaceLocks.add(create.key);
        return create;
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        auditLogs.push(data);
        return data;
      },
    },
      prefix: {
        findUnique: async ({ where }: any) =>
          prefixes.find(prefix => (where.id && prefix.id === where.id) || (where.cidr && prefix.cidr === where.cidr)) ?? null,
        findMany: async ({ cursor, skip = 0, take, where }: any = {}) => {
          let result = prefixes
            .filter(prefix => matchesWhere(prefix, where))
            .sort((left, right) => left.cidr.localeCompare(right.cidr) || left.id.localeCompare(right.id));
          if (cursor?.id) {
            const cursorIndex = result.findIndex(prefix => prefix.id === cursor.id);
            result = cursorIndex < 0 ? [] : result.slice(cursorIndex + skip);
          }
          return take === undefined ? result : result.slice(0, take);
        },
        count: async ({ where }: any = {}) => prefixes.filter(prefix => matchesWhere(prefix, where)).length,
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
      createMany: async ({ data }: any) => {
        let count = 0;
        for (const row of data) {
          if (prefixes.some(prefix => prefix.cidr === row.cidr)) continue;
          await prisma.prefix.create({ data: row });
          count++;
        }
        return { count };
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
      findMany: async ({ cursor, skip = 0, take, where, select }: any = {}) => {
        let result = allocations
          .filter(allocation => matchesWhere(allocation, where))
          .sort((left, right) => left.ipAddress.localeCompare(right.ipAddress) || left.id.localeCompare(right.id));
        if (cursor?.id) {
          const cursorIndex = result.findIndex(allocation => allocation.id === cursor.id);
          result = cursorIndex < 0 ? [] : result.slice(cursorIndex + skip);
        }
        if (take !== undefined) result = result.slice(0, take);
        if (!select) return result;
        return result.map(allocation => Object.fromEntries(
          Object.entries(select)
            .filter(([, included]) => included)
            .map(([field]) => [field, allocation[field]]),
        ));
      },
      groupBy: async (query: any) => {
        allocationGroupByQueries.push(query);
        const counts = new Map<string, number>();
        for (const allocation of allocations.filter(item => matchesWhere(item, query.where))) {
          counts.set(allocation.status, (counts.get(allocation.status) ?? 0) + 1);
        }
        return [...counts].map(([status, count]) => ({ status, _count: { _all: count } }));
      },
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
    buildEntry: (action: string, resourceType: string, resourceId: string, resourceLabel: string, changes?: any) => ({
      action,
      resourceType,
      resourceId,
      resourceLabel,
      changes: changes ?? undefined,
      user: 'system',
      userId: null,
    }),
    log: async (...args: any[]) => {
      auditLogs.push(args);
    },
  };

  return {
    allocationGroupByQueries,
    allocations,
    auditLogs,
    prefixes,
    service: new PrefixesService(prisma as any, audit as any),
  };
}

export const prefixesServiceTests: TestCase[] = [
  test('returns bounded root-prefix cursor pages', async () => {
    const { service } = createHarness();
    await service.create({ cidr: '10.0.0.0/8', rir: 'APNIC' });
    await service.create({ cidr: '172.16.0.0/12', rir: 'ARIN' });

    const firstPage = await service.findRoots({ limit: 1 });
    assert.equal(firstPage.items.length, 1);
    assert.ok(firstPage.nextCursor);

    const secondPage = await service.findRoots({ limit: 1, cursor: firstPage.nextCursor! });
    assert.equal(secondPage.items.length, 1);
    assert.equal(secondPage.nextCursor, null);
    assert.notEqual(secondPage.items[0]?.id, firstPage.items[0]?.id);
  }),

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

  test('rejects creating a child beneath a pool prefix', async () => {
    const { service } = createHarness();

    const pool = await service.create({ cidr: '10.2.0.0/24', rir: 'APNIC', isPool: true });

    await assertRejectsWith(
      async () => service.create({ cidr: '10.2.0.0/25', parentId: pool.id, status: 'Available' }),
      /Cannot create a child beneath pool prefix/,
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

    const pool = await service.create({ cidr: '198.18.0.0/30', rir: 'APNIC', isPool: true });
    await assertRejectsWith(
      async () => service.split(pool.id, { newPrefixLength: 31 }),
      /Cannot split a pool prefix/,
    );
  }),

  test('generates IPv4 /31 pools without reserving network endpoints', async () => {
    const { allocations, service } = createHarness();

    const prefix = await service.create({ cidr: '192.0.2.0/31', rir: 'APNIC' });
    const result = await service.generateIPs(prefix.id);

    assert.equal(result.generated, 2);
    assert.deepEqual(allocations.map(item => item.status), ['Available', 'Available']);
  }),

  test('rejects pool generation when the prefix has children', async () => {
    const { service } = createHarness();

    const prefix = await service.create({ cidr: '198.51.100.0/30', rir: 'APNIC' });
    await service.create({ cidr: '198.51.100.0/31', parentId: prefix.id, status: 'Available' });

    await assertRejectsWith(
      async () => service.generateIPs(prefix.id),
      /Cannot generate IP allocations for a prefix with children/,
    );
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

  test('returns bounded allocation cursor pages and validates cursor ownership', async () => {
    const { allocations, service } = createHarness();
    const firstPrefix = await service.create({ cidr: '192.0.2.0/30', rir: 'APNIC' });
    const secondPrefix = await service.create({ cidr: '198.51.100.0/30', rir: 'APNIC' });
    await service.generateIPs(firstPrefix.id);
    await service.generateIPs(secondPrefix.id);

    const firstPage = await service.getAllocations(firstPrefix.id, { limit: 2 });
    assert.equal(firstPage.items.length, 2);
    assert.ok(firstPage.nextCursor);

    const secondPage = await service.getAllocations(firstPrefix.id, { limit: 2, cursor: firstPage.nextCursor! });
    assert.equal(secondPage.items.length, 2);
    assert.equal(secondPage.nextCursor, null);
    assert.notDeepEqual(secondPage.items.map(item => item.id), firstPage.items.map(item => item.id));

    const foreignCursor = allocations.find(item => item.prefixId === secondPrefix.id)?.id;
    assert.ok(foreignCursor);
    await assertRejectsWith(
      async () => service.getAllocations(firstPrefix.id, { cursor: foreignCursor }),
      /cursor/i,
    );
    await assertRejectsWith(
      async () => service.getAllocations(firstPrefix.id, { limit: 101 }),
      /between 1 and 100/,
    );
  }),

  test('aggregates allocation status counts through Prisma groupBy', async () => {
    const { allocationGroupByQueries, allocations, service } = createHarness();
    const prefix = await service.create({ cidr: '203.0.113.0/30', rir: 'APNIC' });
    await service.generateIPs(prefix.id);
    const available = allocations.find(item => item.status === 'Available');
    assert.ok(available);
    await service.updateAllocation(prefix.id, available.id, { status: 'Allocated' });

    const counts = await service.getAllocationStatusCounts(prefix.id);

    assert.deepEqual(counts, { Available: 1, Allocated: 1, Reserved: 2 });
    assert.equal(allocationGroupByQueries.length, 1);
    assert.deepEqual(allocationGroupByQueries[0], {
      by: ['status'],
      where: { prefixId: prefix.id },
      _count: { _all: true },
    });
  }),

  test('returns exactly 256 allocation heatmap buckets with exact capacities', async () => {
    const { service } = createHarness();
    const prefix = await service.create({ cidr: '198.18.0.0/30', rir: 'APNIC' });
    await service.generateIPs(prefix.id);

    const heatmap = await service.getAllocationHeatmap(prefix.id);

    assert.equal(heatmap.bucketCount, 256);
    assert.equal(heatmap.totalCapacity, '4');
    assert.equal(heatmap.buckets.length, 256);
    assert.equal(heatmap.buckets.reduce((sum, bucket) => (
      sum + bucket.counts.Available + bucket.counts.Allocated + bucket.counts.Reserved
    ), 0), 4);
    assert.equal(heatmap.buckets.reduce((sum, bucket) => sum + BigInt(bucket.capacity), 0n), 4n);
  }),
];
