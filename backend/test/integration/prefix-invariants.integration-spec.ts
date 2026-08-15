import 'reflect-metadata';

import { BadRequestException, ConflictException } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module';
import {
  acquireAddressSpaceRootLock,
} from '../../src/prefixes/address-space-lock';
import { PrefixesService } from '../../src/prefixes/prefixes.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { countIPs, parseCIDR } from '../../src/lib/cidr';
import {
  findOwnershipViolations,
  formatOwnershipReport,
} from '../../scripts/preflight-ownership-report';
import { createDeferred, waitWithHangGuard } from './address-space-lock-test-utils';

describe('prefix ownership and overlap invariants', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: PrefixesService;

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= 'integration-test-secret-012345678901234567890123';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(PrefixesService);
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.allocation.deleteMany();
    await prisma.prefix.deleteMany();
    await prisma.addressSpaceLock.deleteMany({ where: { key: { startsWith: 'parent:' } } });
    await Promise.all([
      prisma.addressSpaceLock.upsert({ where: { key: 'root:v4' }, create: { key: 'root:v4' }, update: {} }),
      prisma.addressSpaceLock.upsert({ where: { key: 'root:v6' }, create: { key: 'root:v6' }, update: {} }),
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createFixturePrefix(
    cidr: string,
    options: { readonly isPool?: boolean; readonly parentId?: string } = {},
  ) {
    const parsed = parseCIDR(cidr);
    return prisma.prefix.create({
      data: {
        cidr: parsed.cidr,
        version: parsed.version,
        totalIPs: countIPs(parsed.cidr),
        parentId: options.parentId ?? null,
        isPool: options.isPool ?? false,
        depth: options.parentId === undefined ? 0 : 1,
      },
    });
  }

  async function captureRejection(operation: () => Promise<unknown>): Promise<unknown> {
    try {
      await operation();
    } catch (error) {
      return error;
    }
    throw new Error('Expected operation to reject');
  }

  it('serializes concurrent exact-CIDR child creates to one success and one typed conflict', async () => {
    const parent = await createFixturePrefix('10.10.0.0/24');
    const lockAcquired = createDeferred<void>();
    const releaseLock = createDeferred<void>();
    const lockHolder = prisma.$transaction(async (tx) => {
      await acquireAddressSpaceRootLock(tx, 4);
      lockAcquired.resolve();
      await releaseLock.promise;
    });

    try {
      await waitWithHangGuard(lockAcquired.promise, 'root lock holder acquisition');

      const attempts = [
        service.create({ cidr: '10.10.0.0/25', parentId: parent.id, status: 'Available' }),
        service.create({ cidr: '10.10.0.0/25', parentId: parent.id, status: 'Available' }),
      ];
      await waitWithHangGuard(
        new Promise<void>((resolve) => setImmediate(resolve)),
        'concurrent create requests start',
      );
      releaseLock.resolve();

      const outcomes = await waitWithHangGuard(Promise.allSettled(attempts), 'concurrent exact-CIDR creates');
      await waitWithHangGuard(lockHolder, 'root lock holder commit');

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
      expect(rejected?.status).toBe('rejected');
      if (rejected?.status !== 'rejected') throw new Error('Concurrent create did not produce a rejection');
      expect(rejected.reason).toBeInstanceOf(ConflictException);
      if (!(rejected.reason instanceof ConflictException)) {
        throw new Error('Concurrent create returned a non-conflict rejection');
      }
      expect(rejected.reason.getStatus()).toBe(409);
      expect(rejected.reason.message).toMatch(/Prefix 10\.10\.0\.0\/25 already exists/);
      await expect(prisma.prefix.count({ where: { cidr: '10.10.0.0/25' } })).resolves.toBe(1);
    } finally {
      releaseLock.resolve();
      await Promise.allSettled([lockHolder]);
    }
  });

  it('rejects creating a child beneath a pool prefix with a typed bad request', async () => {
    const pool = await createFixturePrefix('10.20.0.0/24', { isPool: true });

    const rejection = await captureRejection(
      () => service.create({ cidr: '10.20.0.0/25', parentId: pool.id, status: 'Available' }),
    );

    expect(rejection).toBeInstanceOf(BadRequestException);
    expect(rejection).toMatchObject({
      message: expect.stringMatching(/Cannot create a child beneath pool prefix/),
    });
    await expect(prisma.prefix.count({ where: { parentId: pool.id } })).resolves.toBe(0);
  });

  it('rejects generating a pool for a prefix with existing children', async () => {
    const prefix = await createFixturePrefix('192.0.2.0/30');
    await createFixturePrefix('192.0.2.0/31', { parentId: prefix.id });

    const rejection = await captureRejection(() => service.generateIPs(prefix.id));

    expect(rejection).toBeInstanceOf(BadRequestException);
    expect(rejection).toMatchObject({
      message: expect.stringMatching(/Cannot generate IP allocations for a prefix with children/),
    });
    await expect(prisma.allocation.count({ where: { prefixId: prefix.id } })).resolves.toBe(0);
    await expect(prisma.prefix.findUnique({ where: { id: prefix.id } })).resolves.toMatchObject({ isPool: false });
  });

  it('rejects splitting a prefix that is already flagged as a pool', async () => {
    const pool = await createFixturePrefix('198.51.100.0/30', { isPool: true });

    const rejection = await captureRejection(() => service.split(pool.id, { newPrefixLength: 31 }));

    expect(rejection).toBeInstanceOf(BadRequestException);
    expect(rejection).toMatchObject({
      message: expect.stringMatching(/Cannot split a pool prefix/),
    });
    await expect(prisma.prefix.count({ where: { parentId: pool.id } })).resolves.toBe(0);
  });

  it('reports existing pool and allocation-child ownership violations without mutation', async () => {
    const pool = await createFixturePrefix('203.0.113.0/30', { isPool: true });
    await createFixturePrefix('203.0.113.0/31', { parentId: pool.id });

    const mixed = await createFixturePrefix('203.0.113.4/30');
    await createFixturePrefix('203.0.113.4/31', { parentId: mixed.id });
    await prisma.allocation.create({
      data: { prefixId: mixed.id, ipAddress: '203.0.113.5' },
    });

    const before = await Promise.all([
      prisma.prefix.count(),
      prisma.allocation.count(),
      prisma.auditLog.count(),
    ]);
    const violations = await findOwnershipViolations(prisma);
    const report = formatOwnershipReport(violations);
    const after = await Promise.all([
      prisma.prefix.count(),
      prisma.allocation.count(),
      prisma.auditLog.count(),
    ]);

    expect(violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'pool-with-children',
        prefixId: pool.id,
        cidr: '203.0.113.0/30',
      }),
      expect.objectContaining({
        kind: 'allocations-with-children',
        prefixId: mixed.id,
        cidr: '203.0.113.4/30',
      }),
    ]));
    expect(report).toContain(`Prefix ID ${pool.id}`);
    expect(report).toContain('CIDR 203.0.113.0/30');
    expect(report).toContain(`Prefix ID ${mixed.id}`);
    expect(report).toContain('CIDR 203.0.113.4/30');
    expect(after).toEqual(before);
  });
});
