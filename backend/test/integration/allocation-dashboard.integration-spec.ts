import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';

import { AppModule } from '../../src/app.module';
import { AuditService } from '../../src/audit/audit.service';
import { DashboardCache } from '../../src/dashboard/dashboard-cache';
import { DashboardService, type DashboardStats } from '../../src/dashboard/dashboard.service';
import { countIPs } from '../../src/lib/cidr';
import { PrefixesService } from '../../src/prefixes/prefixes.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  createDeferred,
  detectLockWaitDialect,
  LockTestInvariantError,
  type LockWaitDialect,
  waitForDatabaseLockWait,
  waitWithHangGuard,
} from './address-space-lock-test-utils';

type ConnectionIdRow = {
  readonly connectionId: bigint;
};

type AllocationLockHooks = {
  readonly beforeLock?: (tx: Prisma.TransactionClient) => Promise<void>;
  readonly afterLock?: (tx: Prisma.TransactionClient) => Promise<void>;
};

async function connectionId(tx: Prisma.TransactionClient): Promise<bigint> {
  const result = await tx.$queryRaw`SELECT CONNECTION_ID() AS connectionId`;
  const rows = result as ConnectionIdRow[];
  const id = rows[0]?.connectionId;
  if (id === undefined) throw new LockTestInvariantError('Database did not return a connection ID');
  return id;
}

function withAllocationLockHooks(client: PrismaService, hooks: AllocationLockHooks): PrismaService {
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property !== '$transaction') {
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      }

      return async (operation: (tx: Prisma.TransactionClient) => Promise<unknown>): Promise<unknown> =>
        target.$transaction(async (tx) => {
          const controlledTx = new Proxy(tx, {
            get(txTarget, txProperty, txReceiver) {
              if (txProperty !== '$queryRaw') {
                const value = Reflect.get(txTarget, txProperty, txReceiver);
                return typeof value === 'function' ? value.bind(txTarget) : value;
              }

              return async (...args: unknown[]): Promise<unknown> => {
                await hooks.beforeLock?.(tx);
                const queryRaw = Reflect.get(txTarget, txProperty, txReceiver);
                if (typeof queryRaw !== 'function') {
                  throw new LockTestInvariantError('Transaction queryRaw is unavailable');
                }
                const result = await Reflect.apply(queryRaw, txTarget, args);
                await hooks.afterLock?.(tx);
                return result;
              };
            },
          }) as Prisma.TransactionClient;
          return operation(controlledTx);
        });
    },
  });
}

describe('allocation-backed dashboard aggregation', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let dashboard: DashboardService;
  let instanceA: PrismaService;
  let instanceB: PrismaService;
  let lockWaitDialect: LockWaitDialect;

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= 'integration-test-secret-012345678901234567890123';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    dashboard = app.get(DashboardService);
    instanceA = new PrismaService();
    instanceB = new PrismaService();
    await Promise.all([instanceA.$connect(), instanceB.$connect()]);
    lockWaitDialect = await detectLockWaitDialect(prisma);
  });

  beforeEach(async () => {
    dashboard.invalidate();
    await prisma.auditLog.deleteMany();
    await prisma.geofeedEntry.deleteMany();
    await prisma.allocation.deleteMany();
    await prisma.prefix.deleteMany();
  });

  afterAll(async () => {
    await Promise.all([instanceA.$disconnect(), instanceB.$disconnect()]);
    await app.close();
  });

  it('aggregates allocated descendants with exact decimal capacity and rounded basis points', async () => {
    const root = await prisma.prefix.create({
      data: {
        cidr: '198.18.0.0/27',
        version: 4,
        totalIPs: countIPs('198.18.0.0/27'),
        usedIPs: 31,
        totalIPsExact: new Prisma.Decimal('32'),
        usedIPsExact: new Prisma.Decimal('31'),
      },
    });
    const child = await prisma.prefix.create({
      data: {
        cidr: '198.18.0.0/28',
        version: 4,
        parentId: root.id,
        depth: 1,
        totalIPs: countIPs('198.18.0.0/28'),
        usedIPs: 14,
        totalIPsExact: new Prisma.Decimal('16'),
        usedIPsExact: new Prisma.Decimal('14'),
      },
    });
    const grandchild = await prisma.prefix.create({
      data: {
        cidr: '198.18.0.0/29',
        version: 4,
        parentId: child.id,
        depth: 2,
        totalIPs: countIPs('198.18.0.0/29'),
        usedIPs: 7,
        totalIPsExact: new Prisma.Decimal('8'),
        usedIPsExact: new Prisma.Decimal('7'),
      },
    });
    await prisma.allocation.createMany({
      data: [
        { prefixId: child.id, ipAddress: '198.18.0.1', status: 'Available' },
        { prefixId: child.id, ipAddress: '198.18.0.2', status: 'Available' },
        { prefixId: grandchild.id, ipAddress: '198.18.0.3', status: 'Allocated' },
      ],
    });

    const stats = await dashboard.getStats();

    expect(stats).toMatchObject({
      totalCapacity: '32',
      usedCapacity: '1',
      utilizationBasisPoints: 313,
      totalIPv4: 32,
      usedIPv4: 1,
    });
  });

  it('falls back to CIDR-derived total capacity when an exact legacy value is absent', async () => {
    const root = await prisma.prefix.create({
      data: {
        cidr: '203.0.113.0/31',
        version: 4,
        totalIPs: countIPs('203.0.113.0/31'),
        usedIPs: 0,
        totalIPsExact: null,
        usedIPsExact: null,
      },
    });
    await prisma.allocation.create({
      data: { prefixId: root.id, ipAddress: '203.0.113.1', status: 'Allocated' },
    });

    const stats = await dashboard.getStats();

    expect(stats).toMatchObject({
      totalCapacity: '2',
      usedCapacity: '1',
      utilizationBasisPoints: 5000,
    });
  });

  it('counts only structured Prefix creation events in the trend', async () => {
    const now = new Date();
    await prisma.auditLog.createMany({
      data: [
        {
          timestamp: now,
          action: 'Created',
          resourceType: 'Prefix',
          resourceId: 'prefix-v4',
          resourceLabel: '198.18.0.0/27',
        },
        {
          timestamp: now,
          action: 'Created',
          resourceType: 'Prefix',
          resourceId: 'prefix-v6',
          resourceLabel: '2001:db8::/64',
        },
        {
          timestamp: now,
          action: 'Created',
          resourceType: 'Allocation',
          resourceId: 'allocation-v6',
          resourceLabel: '2001:db8::1',
        },
        {
          timestamp: now,
          action: 'Imported',
          resourceType: 'Geofeed',
          resourceId: 'geofeed-1',
          resourceLabel: '198.18.0.0/27',
        },
        {
          timestamp: now,
          action: 'Updated',
          resourceType: 'Settings',
          resourceId: 'settings-1',
          resourceLabel: 'default',
        },
        {
          timestamp: now,
          action: 'Updated',
          resourceType: 'Prefix',
          resourceId: 'prefix-update',
          resourceLabel: '198.18.0.0/27',
        },
        {
          timestamp: now,
          action: 'Generated',
          resourceType: 'Prefix',
          resourceId: 'prefix-generated',
          resourceLabel: '198.18.0.0/27',
        },
      ],
    });

    const stats = await dashboard.getStats();
    const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const currentMonth = stats.allocationTrend.find((entry) => entry.month === monthLabels[now.getMonth()]);

    expect(currentMonth).toEqual({ month: monthLabels[now.getMonth()], ipv4: 1, ipv6: 1 });
  });

  it('keeps another instance stale until its local TTL expires', async () => {
    let now = 10_000;
    const cacheA = new DashboardCache<DashboardStats>(60_000, () => now);
    const cacheB = new DashboardCache<DashboardStats>(60_000, () => now);
    const dashboardA = new DashboardService(instanceA, cacheA);
    const dashboardB = new DashboardService(instanceB, cacheB);
    const prefixesA = new PrefixesService(instanceA, new AuditService(instanceA), cacheA);

    const root = await instanceA.prefix.create({
      data: {
        cidr: '192.0.2.0/30',
        version: 4,
        totalIPs: 4,
        totalIPsExact: new Prisma.Decimal('4'),
      },
    });
    const allocation = await instanceA.allocation.create({
      data: { prefixId: root.id, ipAddress: '192.0.2.1', status: 'Available' },
    });

    await expect(dashboardA.getStats()).resolves.toMatchObject({ usedCapacity: '0' });
    await expect(dashboardB.getStats()).resolves.toMatchObject({ usedCapacity: '0' });

    await prefixesA.updateAllocation(root.id, allocation.id, { status: 'Allocated' });

    await expect(dashboardA.getStats()).resolves.toMatchObject({ usedCapacity: '1' });
    await expect(dashboardB.getStats()).resolves.toMatchObject({ usedCapacity: '0' });

    now += 60_000;
    await expect(dashboardB.getStats()).resolves.toMatchObject({ usedCapacity: '1' });
  });

  it('serializes bulk and single updates so the last committed state wins without a torn dashboard read', async () => {
    const prefix = await instanceA.prefix.create({
      data: {
        cidr: '198.51.100.0/30',
        version: 4,
        totalIPs: 4,
        totalIPsExact: new Prisma.Decimal('4'),
      },
    });
    const allocations = await Promise.all([
      instanceA.allocation.create({
        data: { prefixId: prefix.id, ipAddress: '198.51.100.1', status: 'Available' },
      }),
      instanceA.allocation.create({
        data: { prefixId: prefix.id, ipAddress: '198.51.100.2', status: 'Available' },
      }),
    ]);
    const [target, other] = [...allocations].sort((left, right) => left.id.localeCompare(right.id));

    const bulkLocked = createDeferred<void>();
    const releaseBulk = createDeferred<void>();
    const singleConnection = createDeferred<bigint>();
    const singleLocked = createDeferred<void>();
    const releaseSingle = createDeferred<void>();
    const operations: Promise<unknown>[] = [];

    const bulkClient = withAllocationLockHooks(instanceA, {
      afterLock: async () => {
        bulkLocked.resolve();
        await releaseBulk.promise;
      },
    });
    const singleClient = withAllocationLockHooks(instanceB, {
      beforeLock: async (tx) => singleConnection.resolve(await connectionId(tx)),
      afterLock: async () => {
        singleLocked.resolve();
        await releaseSingle.promise;
      },
    });
    const bulkService = new PrefixesService(
      bulkClient,
      new AuditService(instanceA),
      new DashboardCache<DashboardStats>(),
    );
    const singleService = new PrefixesService(
      singleClient,
      new AuditService(instanceB),
      new DashboardCache<DashboardStats>(),
    );
    const observerDashboard = new DashboardService(prisma, new DashboardCache<DashboardStats>());

    try {
      const bulkOperation = bulkService.bulkUpdateAllocations(prefix.id, {
        allocationIds: [other.id, target.id],
        status: 'Allocated',
      });
      operations.push(bulkOperation);
      await waitWithHangGuard(bulkLocked.promise, 'bulk allocation lock acquisition');

      const singleOperation = singleService.updateAllocation(prefix.id, target.id, { status: 'Reserved' });
      operations.push(singleOperation);
      const waitingConnection = await waitWithHangGuard(singleConnection.promise, 'single update transaction start');
      await waitForDatabaseLockWait(prisma, lockWaitDialect, waitingConnection);

      releaseBulk.resolve();
      await waitWithHangGuard(bulkOperation, 'bulk allocation update commit');
      await waitWithHangGuard(singleLocked.promise, 'single allocation lock acquisition');

      observerDashboard.invalidate();
      await expect(observerDashboard.getStats()).resolves.toMatchObject({
        usedCapacity: '2',
        totalCapacity: '4',
        utilizationBasisPoints: 5000,
      });

      releaseSingle.resolve();
      await waitWithHangGuard(singleOperation, 'single allocation update commit');

      observerDashboard.invalidate();
      await expect(observerDashboard.getStats()).resolves.toMatchObject({
        usedCapacity: '1',
        totalCapacity: '4',
        utilizationBasisPoints: 2500,
      });
      await expect(prisma.allocation.findUniqueOrThrow({ where: { id: target.id } })).resolves.toMatchObject({
        status: 'Reserved',
      });
      await expect(prisma.allocation.findUniqueOrThrow({ where: { id: other.id } })).resolves.toMatchObject({
        status: 'Allocated',
      });
      await expect(prisma.auditLog.count({
        where: { resourceType: 'Allocation', action: 'Updated' },
      })).resolves.toBe(2);
    } finally {
      releaseBulk.resolve();
      releaseSingle.resolve();
      await Promise.allSettled(operations);
    }
  });
});
