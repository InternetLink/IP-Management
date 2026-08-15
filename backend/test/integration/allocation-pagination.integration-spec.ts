import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { AuthService } from '../../src/auth/auth.service';
import { PrismaService } from '../../src/prisma/prisma.service';

const AUTH_SECRET = 'allocation-pagination-integration-secret-012345';
const BOOTSTRAP_TOKEN = 'allocation-pagination-bootstrap-token';
const ALLOCATION_TOTAL = 10_001;

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

describe('allocation pagination and aggregates', () => {
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
    await prisma.allocation.deleteMany();
    await prisma.prefix.deleteMany();
    await prisma.user.deleteMany();
    await prisma.bootstrapState.update({
      where: { id: 'bootstrap' },
      data: { completedAt: null, completedByUserId: null },
    });
    const auth = app.get(AuthService);
    const result = await auth.bootstrapAdmin(
      { username: 'PaginationAdmin', password: 'strong-password' },
      BOOTSTRAP_TOKEN,
    );
    token = result.token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps allocation pages and heatmap output bounded for 10,001 rows', async () => {
    const prefix = await prisma.prefix.create({
      data: {
        cidr: '10.64.0.0/18',
        depth: 0,
        isPool: true,
        status: 'Active',
        totalIPs: 16_384,
        totalIPsExact: new Prisma.Decimal('16384'),
        version: 4,
      },
    });
    const expectedCounts = { Available: 0, Allocated: 0, Reserved: 0 };

    for (let start = 0; start < ALLOCATION_TOTAL; start += 1_000) {
      const size = Math.min(1_000, ALLOCATION_TOTAL - start);
      const data = Array.from({ length: size }, (_, batchOffset) => {
        const offset = start + batchOffset;
        const status = offset % 3 === 0 ? 'Available' : offset % 3 === 1 ? 'Allocated' : 'Reserved';
        expectedCounts[status] += 1;
        return {
          ipAddress: `10.64.${Math.floor(offset / 256)}.${offset % 256}`,
          prefixId: prefix.id,
          status,
        };
      });
      await prisma.allocation.createMany({ data });
    }

    const firstPage = await request(app.getHttpServer())
      .get(`/api/prefixes/${prefix.id}/allocations`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(firstPage.body.items).toHaveLength(50);
    expect(firstPage.body.nextCursor).toEqual(expect.any(String));

    const secondPage = await request(app.getHttpServer())
      .get(`/api/prefixes/${prefix.id}/allocations`)
      .set('Authorization', `Bearer ${token}`)
      .query({ cursor: firstPage.body.nextCursor, limit: 37 })
      .expect(200);
    expect(secondPage.body.items).toHaveLength(37);
    expect(secondPage.body.items[0].id).not.toBe(firstPage.body.items[0].id);

    await request(app.getHttpServer())
      .get(`/api/prefixes/${prefix.id}/allocations`)
      .set('Authorization', `Bearer ${token}`)
      .query({ limit: 101 })
      .expect(400);

    const statusCounts = await request(app.getHttpServer())
      .get(`/api/prefixes/${prefix.id}/allocations/status-counts`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(statusCounts.body).toEqual(expectedCounts);

    const heatmap = await request(app.getHttpServer())
      .get(`/api/prefixes/${prefix.id}/allocations/heatmap`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(heatmap.body.bucketCount).toBe(256);
    expect(heatmap.body.buckets).toHaveLength(256);
    expect(heatmap.body.totalCapacity).toBe('16384');

    const heatmapCounts = heatmap.body.buckets.reduce(
      (totals: typeof expectedCounts, bucket: { counts: typeof expectedCounts }) => ({
        Available: totals.Available + bucket.counts.Available,
        Allocated: totals.Allocated + bucket.counts.Allocated,
        Reserved: totals.Reserved + bucket.counts.Reserved,
      }),
      { Available: 0, Allocated: 0, Reserved: 0 },
    );
    const bucketCapacity = heatmap.body.buckets.reduce(
      (total: bigint, bucket: { capacity: string }) => total + BigInt(bucket.capacity),
      0n,
    );
    expect(heatmapCounts).toEqual(expectedCounts);
    expect(bucketCapacity).toBe(16_384n);
  });
});
