import 'reflect-metadata';

import { ConflictException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SettingsService } from '../../src/settings/settings.service';

const AUDIT_FAILURE_TRIGGER = 'settings_audit_failure_test';

function versionOf(settings: object): string {
  if (!('version' in settings) || typeof settings.version !== 'string') {
    throw new Error('Settings response did not include a string version');
  }
  return settings.version;
}

describe('settings persistence and audit invariants', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: SettingsService;

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= 'integration-test-secret-012345678901234567890123';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(SettingsService);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${AUDIT_FAILURE_TRIGGER}`);
    await prisma.auditLog.deleteMany({ where: { resourceType: 'Settings' } });
    await prisma.appSettings.deleteMany();
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${AUDIT_FAILURE_TRIGGER}`);
    await app.close();
  });

  it('returns one shared row from concurrent first reads', async () => {
    const readers = 32;
    await Promise.all(Array.from({ length: readers }, () => prisma.$queryRaw`SELECT SLEEP(0.01)`));

    const settings = await Promise.all(Array.from({ length: readers }, () => service.get()));
    const [first] = settings;

    expect(first.id).toBe('default');
    expect(new Set(settings.map(({ id }) => id))).toEqual(new Set(['default']));
    expect(new Set(settings.map(versionOf))).toEqual(new Set([versionOf(first)]));
    await expect(prisma.appSettings.count()).resolves.toBe(1);
  });

  it('writes the settings diff and audit entry in one transaction', async () => {
    const initial = await service.get();
    const update = {
      expectedVersion: versionOf(initial),
      organizationName: 'Documented Networks',
      utilizationThreshold: 90,
    };

    const updated = await service.update(update);

    expect(updated.organizationName).toBe('Documented Networks');
    expect(versionOf(updated)).not.toBe(update.expectedVersion);
    await expect(prisma.auditLog.findMany({ where: { resourceType: 'Settings' } })).resolves.toMatchObject([
      {
        action: 'Updated',
        resourceId: 'default',
        resourceLabel: 'Application settings',
        changes: [
          { field: 'organizationName', before: 'NetOps Inc.', after: 'Documented Networks' },
          { field: 'utilizationThreshold', before: '85', after: '90' },
        ],
      },
    ]);
  });

  it('returns conflict when an update uses a stale version', async () => {
    const initial = await service.get();
    const staleVersion = versionOf(initial);
    const firstUpdate = { expectedVersion: staleVersion, organizationName: 'First writer' };
    await service.update(firstUpdate);

    const stalePayload = {
      expectedVersion: staleVersion,
      organizationName: 'Stale writer',
    };
    const staleUpdate = service.update(stalePayload);

    await expect(staleUpdate).rejects.toBeInstanceOf(ConflictException);
    await expect(prisma.appSettings.findUniqueOrThrow({ where: { id: 'default' } })).resolves.toMatchObject({
      organizationName: 'First writer',
    });
    await expect(prisma.auditLog.count({ where: { resourceType: 'Settings' } })).resolves.toBe(1);
  });

  it('rolls back the settings update when the audit insert fails', async () => {
    await service.get();
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER ${AUDIT_FAILURE_TRIGGER}
      BEFORE INSERT ON audit_logs
      FOR EACH ROW
      BEGIN
        IF NEW.resourceType = 'Settings' THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected settings audit failure';
        END IF;
      END
    `);

    try {
      await expect(service.update({ organizationName: 'Must roll back' })).rejects.toThrow();
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${AUDIT_FAILURE_TRIGGER}`);
    }

    await expect(prisma.appSettings.findUniqueOrThrow({ where: { id: 'default' } })).resolves.toMatchObject({
      organizationName: 'NetOps Inc.',
    });
    await expect(prisma.auditLog.count({ where: { resourceType: 'Settings' } })).resolves.toBe(0);
  });

  it('propagates a read failure without replacing stored settings', async () => {
    await prisma.appSettings.create({
      data: { id: 'default', organizationName: 'Persisted settings' },
    });
    const readFailure = new Error('injected settings read failure');
    const upsert = jest.spyOn(prisma.appSettings, 'upsert').mockRejectedValueOnce(readFailure);

    try {
      await expect(service.get()).rejects.toBe(readFailure);
    } finally {
      upsert.mockRestore();
    }

    await expect(prisma.appSettings.findUniqueOrThrow({ where: { id: 'default' } })).resolves.toMatchObject({
      organizationName: 'Persisted settings',
    });
  });
});
