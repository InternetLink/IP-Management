import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { AuditService } from '../../src/audit/audit.service';
import { AuthService } from '../../src/auth/auth.service';
import { GeofeedService } from '../../src/geofeed/geofeed.service';
import { countIPs } from '../../src/lib/cidr';
import { PrefixesService } from '../../src/prefixes/prefixes.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SettingsService } from '../../src/settings/settings.service';

const AUTH_SECRET = 'audit-remediation-integration-secret-0123456789';
const BOOTSTRAP_TOKEN = 'audit-remediation-bootstrap-token';

async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    whitelist: true,
  }));
  await app.init();
  return app;
}

describe('audit query and atomicity remediation', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;

  beforeAll(async () => {
    process.env.AUTH_SECRET = AUTH_SECRET;
    process.env.BOOTSTRAP_TOKEN = BOOTSTRAP_TOKEN;
    app = await createApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.geofeedEntry.deleteMany();
    await prisma.allocation.deleteMany();
    await prisma.prefix.deleteMany();
    await prisma.appSettings.deleteMany();
    await prisma.user.deleteMany();
    await prisma.bootstrapState.update({
      where: { id: 'bootstrap' },
      data: { completedAt: null, completedByUserId: null },
    });
    const auth = app.get(AuthService);
    const result = await auth.bootstrapAdmin({ username: 'AuditAdmin', password: 'strong-password' }, BOOTSTRAP_TOKEN);
    token = result.token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('searches audit labels through the MySQL collation', async () => {
    await prisma.auditLog.createMany({
      data: [
        {
          action: 'Updated',
          resourceType: 'Geofeed',
          resourceId: 'geofeed-search',
          resourceLabel: '10.0.0.0/24',
          user: 'AuditAdmin',
        },
        {
          action: 'Updated',
          resourceType: 'Settings',
          resourceId: 'settings-search',
          resourceLabel: 'Taipei Settings',
          user: 'AuditAdmin',
        },
      ],
    });

    const addressResponse = await request(app.getHttpServer())
      .get('/api/audit')
      .set('Authorization', `Bearer ${token}`)
      .query({ search: '10.0.0' })
      .expect(200);
    expect(addressResponse.body.items).toHaveLength(1);
    expect(addressResponse.body.items[0].resourceLabel).toBe('10.0.0.0/24');

    const caseResponse = await request(app.getHttpServer())
      .get('/api/audit')
      .set('Authorization', `Bearer ${token}`)
      .query({ search: 'taipei' })
      .expect(200);
    expect(caseResponse.body.items[0].resourceLabel).toBe('Taipei Settings');
  });

  it.each(['abc', '-1', '501'])('rejects invalid limit %s', async (limit) => {
    await request(app.getHttpServer())
      .get('/api/audit')
      .set('Authorization', `Bearer ${token}`)
      .query({ limit })
      .expect(400);
  });

  it('rolls back Geofeed and Settings writes when audit insertion fails', async () => {
    const failingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuditService)
      .useValue({
        buildEntry: () => ({
          action: 'x'.repeat(21),
          resourceType: 'Geofeed',
          resourceId: 'injected-failure',
          resourceLabel: 'injected-failure',
          user: 'system',
          userId: null,
        }),
      })
      .compile();
    const failingApp = failingModule.createNestApplication();
    await failingApp.init();

    try {
      const geofeed = failingApp.get(GeofeedService);
      const beforeGeofeed = await prisma.geofeedEntry.count();
      await expect(geofeed.create({ prefix: '10.10.0.0/24', countryCode: 'TW' })).rejects.toThrow();
      expect(await prisma.geofeedEntry.count()).toBe(beforeGeofeed);

      await prisma.appSettings.create({ data: { id: 'default', organizationName: 'Before' } });
      const settings = failingApp.get(SettingsService);
      await expect(settings.update({ organizationName: 'After' })).rejects.toThrow();
      await expect(prisma.appSettings.findUniqueOrThrow({ where: { id: 'default' } }))
        .resolves.toMatchObject({ organizationName: 'Before' });
    } finally {
      await failingApp.close();
    }
  });

  it('audits password changes and preserves cascade impact counts', async () => {
    const auth = app.get(AuthService);
    const user = await prisma.user.findUniqueOrThrow({ where: { username: 'auditadmin' } });
    await auth.changePassword(user.id, { currentPassword: 'strong-password', newPassword: 'new-password' });
    await expect(prisma.auditLog.findFirstOrThrow({
      where: { action: 'Updated', resourceType: 'User', resourceId: user.id },
    }))
      .resolves.toMatchObject({ action: 'Updated', resourceLabel: 'auditadmin' });

    const root = await prisma.prefix.create({
      data: {
        cidr: '10.20.0.0/16',
        version: 4,
        totalIPs: countIPs('10.20.0.0/16'),
        usedIPs: 0,
      },
    });
    const child = await prisma.prefix.create({
      data: {
        cidr: '10.20.0.0/24',
        version: 4,
        parentId: root.id,
        depth: 1,
        totalIPs: countIPs('10.20.0.0/24'),
        usedIPs: 0,
      },
    });
    const grandchild = await prisma.prefix.create({
      data: {
        cidr: '10.20.0.0/25',
        version: 4,
        parentId: child.id,
        depth: 2,
        totalIPs: countIPs('10.20.0.0/25'),
        usedIPs: 0,
      },
    });
    await prisma.allocation.createMany({
      data: [
        { prefixId: root.id, ipAddress: '10.20.0.1' },
        { prefixId: grandchild.id, ipAddress: '10.20.0.2' },
      ],
    });
    const retained = await prisma.auditLog.create({
      data: {
        action: 'Updated',
        resourceType: 'Prefix',
        resourceId: 'retained',
        resourceLabel: root.cidr,
        prefixId: root.id,
        user: 'AuditAdmin',
      },
    });

    await app.get(PrefixesService).remove(root.id);

    await expect(prisma.auditLog.findUniqueOrThrow({ where: { id: retained.id } }))
      .resolves.toMatchObject({ prefixId: null });
    const deletion = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'Deleted', resourceType: 'Prefix', resourceId: root.id },
    });
    expect(deletion.changes).toEqual([
      {
        field: 'cascadeSummary',
        before: '',
        after: '{"descendantCount":2,"allocationCount":2,"capped":false}',
      },
    ]);
    expect(await prisma.prefix.count()).toBe(0);
    expect(await prisma.allocation.count()).toBe(0);
  });
});
