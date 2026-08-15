import 'reflect-metadata';

import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { CapacityBackfillWorker } from '../../src/prefixes/capacity-backfill';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('GET /api/health/ready', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= 'integration-test-secret-012345678901234567890123';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      whitelist: true,
    }));
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports ready after the migrated database answers SELECT 1', async () => {
    await request(app.getHttpServer())
      .get('/api/health/ready')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('blocks exact mode until the migration state is backfilled', async () => {
    const before = await prisma.migrationState.findUniqueOrThrow({ where: { id: 'capacity-v1' } });
    await prisma.migrationState.update({
      where: { id: 'capacity-v1' },
      data: { stage: 'EXPANDED', processedRowCount: 0n, expectedRowCount: 0n, batchCursor: null },
    });
    const previousMode = process.env.CAPACITY_READ_MODE;
    process.env.CAPACITY_READ_MODE = 'exact';
    try {
      await request(app.getHttpServer())
        .get('/api/health/ready')
        .expect(503);
      await expect(new CapacityBackfillWorker(prisma).assertExactCapacityReady()).rejects.toThrow();
    } finally {
      if (previousMode === undefined) delete process.env.CAPACITY_READ_MODE;
      else process.env.CAPACITY_READ_MODE = previousMode;
      await prisma.migrationState.update({
        where: { id: 'capacity-v1' },
        data: {
          stage: before.stage,
          processedRowCount: before.processedRowCount,
          expectedRowCount: before.expectedRowCount,
          batchCursor: before.batchCursor,
          checksum: before.checksum,
          completedAt: before.completedAt,
          startedAt: before.startedAt,
          failureCode: before.failureCode,
          leaseOwner: before.leaseOwner,
          leaseExpiresAt: before.leaseExpiresAt,
        },
      });
    }
  });
});
