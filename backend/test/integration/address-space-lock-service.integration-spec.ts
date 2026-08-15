import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module';
import {
  AddressSpaceLockMissingError,
} from '../../src/prefixes/address-space-lock';
import { PrefixesService } from '../../src/prefixes/prefixes.service';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('address-space-lock Prefix topology wiring', () => {
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

  async function createFixturePrefix(cidr: string) {
    return prisma.prefix.create({
      data: {
        cidr,
        version: 4,
        totalIPs: 4,
      },
    });
  }

  async function expectIpv4RootLock(operation: () => Promise<unknown>): Promise<void> {
    await prisma.addressSpaceLock.delete({ where: { key: 'root:v4' } });
    try {
      await expect(operation()).rejects.toBeInstanceOf(AddressSpaceLockMissingError);
    } finally {
      await prisma.addressSpaceLock.create({ data: { key: 'root:v4' } });
    }
  }

  it('address-space-lock guards root create before its write', async () => {
    await expectIpv4RootLock(() => service.create({ cidr: '10.0.0.0/24', rir: 'APNIC' }));

    await expect(prisma.prefix.count()).resolves.toBe(0);
  });

  it('address-space-lock guards child create before parent lock and write', async () => {
    const parent = await createFixturePrefix('10.0.0.0/24');

    await expectIpv4RootLock(() => service.create({
      cidr: '10.0.0.0/25',
      parentId: parent.id,
      status: 'Available',
    }));

    await expect(prisma.prefix.count({ where: { parentId: parent.id } })).resolves.toBe(0);
    await expect(prisma.addressSpaceLock.findUnique({
      where: { key: `parent:${parent.id}` },
    })).resolves.toBeNull();
  });

  it('address-space-lock guards split before parent lock and child writes', async () => {
    const prefix = await createFixturePrefix('192.0.2.0/30');

    await expectIpv4RootLock(() => service.split(prefix.id, { newPrefixLength: 31 }));

    await expect(prisma.prefix.count({ where: { parentId: prefix.id } })).resolves.toBe(0);
    await expect(prisma.addressSpaceLock.findUnique({
      where: { key: `parent:${prefix.id}` },
    })).resolves.toBeNull();
  });

  it('address-space-lock guards delete before parent lock and removal', async () => {
    const prefix = await createFixturePrefix('198.51.100.0/30');

    await expectIpv4RootLock(() => service.remove(prefix.id));

    await expect(prisma.prefix.findUnique({ where: { id: prefix.id } })).resolves.toMatchObject({ id: prefix.id });
    await expect(prisma.addressSpaceLock.findUnique({
      where: { key: `parent:${prefix.id}` },
    })).resolves.toBeNull();
  });

  it('address-space-lock guards pool generation before parent lock and allocation writes', async () => {
    const prefix = await createFixturePrefix('203.0.113.0/31');

    await expectIpv4RootLock(() => service.generateIPs(prefix.id));

    await expect(prisma.allocation.count({ where: { prefixId: prefix.id } })).resolves.toBe(0);
    await expect(prisma.prefix.findUnique({ where: { id: prefix.id } })).resolves.toMatchObject({ isPool: false });
    await expect(prisma.addressSpaceLock.findUnique({
      where: { key: `parent:${prefix.id}` },
    })).resolves.toBeNull();
  });
});
