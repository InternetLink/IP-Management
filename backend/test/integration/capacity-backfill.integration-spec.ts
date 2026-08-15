import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module';
import {
  CAPACITY_INITIAL_CHECKSUM,
  CapacityBackfillDataError,
  CapacityBackfillWorker,
  CapacityLeaseUnavailableError,
  CapacityReadinessError,
} from '../../src/prefixes/capacity-backfill';
import { countIPs, countIPsExact, parseCIDR } from '../../src/lib/cidr';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PrefixesService } from '../../src/prefixes/prefixes.service';

describe('capacity exact backfill', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let prefixes: PrefixesService;

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= 'integration-test-secret-012345678901234567890123';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    prefixes = app.get(PrefixesService);
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.allocation.deleteMany();
    await prisma.prefix.deleteMany();
    await prisma.migrationState.update({
      where: { id: 'capacity-v1' },
      data: {
        stage: 'EXPANDED',
        targetVersion: 'decimal-65-0',
        batchCursor: null,
        expectedRowCount: 0n,
        processedRowCount: 0n,
        checksum: CAPACITY_INITIAL_CHECKSUM,
        startedAt: null,
        completedAt: null,
        failureCode: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  async function createLegacyPrefix(id: string, cidr: string) {
    const parsed = parseCIDR(cidr);
    return prisma.prefix.create({
      data: {
        id,
        cidr: parsed.cidr,
        version: parsed.version,
        totalIPs: countIPs(parsed.cidr),
        usedIPs: 0,
      },
    });
  }

  function at(offsetMs: number): Date {
    return new Date(Date.UTC(2026, 7, 14, 20, 0, 0) + offsetMs);
  }

  it('backfills all fixture families with exact decimal strings and proves readiness', async () => {
    await createLegacyPrefix('00000000-0000-4000-8000-000000000001', '192.0.2.0/24');
    await createLegacyPrefix('00000000-0000-4000-8000-000000000002', '2001:db8::/64');
    await createLegacyPrefix('00000000-0000-4000-8000-000000000003', '2001:db8:1::/48');
    await createLegacyPrefix('00000000-0000-4000-8000-000000000004', '::/0');

    const worker = new CapacityBackfillWorker(prisma, { leaseDurationMs: 1_000 });
    await worker.runToCompletion({ owner: 'worker-fixture', batchSize: 2, now: at(0) });

    const capacities = (await prefixes.findRoots({ limit: 100 })).items
      .map((row) => [row.cidr, row.totalIPsExact, row.usedIPsExact])
      .sort(([left], [right]) => left.localeCompare(right));
    expect(capacities).toEqual([
      ['::/0', countIPsExact('::/0').toString(), '0'],
      ['192.0.2.0/24', '256', '0'],
      ['2001:db8::/64', '18446744073709551616', '0'],
      ['2001:db8:1::/48', countIPsExact('2001:db8:1::/48').toString(), '0'],
    ]);

    const state = await prisma.migrationState.findUniqueOrThrow({ where: { id: 'capacity-v1' } });
    expect(state.stage).toBe('BACKFILLED');
    expect(state.expectedRowCount).toBe(4n);
    expect(state.processedRowCount).toBe(4n);
    await expect(worker.assertExactCapacityReady()).resolves.toBeUndefined();
  });

  it('resumes a crashed owner after lease expiry without changing the checksum twice', async () => {
    await createLegacyPrefix('00000000-0000-4000-8000-000000000001', '192.0.2.0/24');
    await createLegacyPrefix('00000000-0000-4000-8000-000000000002', '2001:db8::/64');
    await createLegacyPrefix('00000000-0000-4000-8000-000000000003', '2001:db8:1::/48');

    const crashedWorker = new CapacityBackfillWorker(prisma, { leaseDurationMs: 100 });
    await crashedWorker.claimLease({ owner: 'crashed-owner', now: at(0) });
    await crashedWorker.processBatch({ owner: 'crashed-owner', batchSize: 1, now: at(10) });
    const afterCrash = await prisma.migrationState.findUniqueOrThrow({ where: { id: 'capacity-v1' } });
    expect(afterCrash.processedRowCount).toBe(1n);

    const resumingWorker = new CapacityBackfillWorker(prisma, { leaseDurationMs: 100 });
    await expect(
      resumingWorker.processBatch({ owner: 'blocked-owner', batchSize: 1, now: at(50) }),
    ).rejects.toBeInstanceOf(CapacityLeaseUnavailableError);

    await resumingWorker.runToCompletion({ owner: 'resuming-owner', batchSize: 1, now: at(250) });
    const completed = await prisma.migrationState.findUniqueOrThrow({ where: { id: 'capacity-v1' } });
    expect(completed.stage).toBe('BACKFILLED');
    expect(completed.processedRowCount).toBe(3n);
    const checksum = completed.checksum;

    await resumingWorker.runToCompletion({ owner: 'resuming-owner', batchSize: 1, now: at(250) });
    const repeated = await prisma.migrationState.findUniqueOrThrow({ where: { id: 'capacity-v1' } });
    expect(repeated.processedRowCount).toBe(3n);
    expect(repeated.checksum).toBe(checksum);
  });

  it('preflights invalid CIDR data without mutating migration state', async () => {
    await createLegacyPrefix('00000000-0000-4000-8000-000000000001', '192.0.2.0/24');
    await prisma.prefix.create({
      data: {
        id: '00000000-0000-4000-8000-000000000099',
        cidr: 'invalid/99',
        version: 4,
        totalIPs: 1,
        usedIPs: 0,
      },
    });
    const before = await prisma.migrationState.findUniqueOrThrow({ where: { id: 'capacity-v1' } });
    const worker = new CapacityBackfillWorker(prisma);

    await expect(worker.preflight()).rejects.toBeInstanceOf(CapacityBackfillDataError);

    const after = await prisma.migrationState.findUniqueOrThrow({ where: { id: 'capacity-v1' } });
    expect(after.stage).toBe(before.stage);
    expect(after.processedRowCount).toBe(before.processedRowCount);
    expect(after.checksum).toBe(before.checksum);
  });

  it('requires BACKFILLED state before exact-only readiness', async () => {
    const worker = new CapacityBackfillWorker(prisma);
    await expect(worker.assertExactCapacityReady()).rejects.toBeInstanceOf(CapacityReadinessError);
  });
});
