import 'reflect-metadata';

import {
  BadRequestException,
  InternalServerErrorException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { UpdateGeofeedDto } from '../../src/geofeed/geofeed.dto';
import { GeofeedService } from '../../src/geofeed/geofeed.service';
import { countIPs, parseCIDR } from '../../src/lib/cidr';
import { PrismaService } from '../../src/prisma/prisma.service';
import { executeMysqlTextProtocol } from './mysql-test-utils';

describe('Geofeed bounded and atomic behavior', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: GeofeedService;

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= 'integration-test-secret-012345678901234567890123';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
    service = app.get(GeofeedService);
  });

  beforeEach(async () => {
    await prisma.geofeedEntry.deleteMany();
    await prisma.auditLog.deleteMany({ where: { resourceType: 'Geofeed' } });
    await prisma.prefix.deleteMany();
  });

  afterEach(async () => {
    await executeMysqlTextProtocol('DROP TRIGGER IF EXISTS geofeed_import_failure_test');
  });

  afterAll(async () => {
    await app.close();
  });

  async function createFixturePrefix(cidr: string) {
    const parsed = parseCIDR(cidr);
    return prisma.prefix.create({
      data: {
        cidr: parsed.cidr,
        version: parsed.version,
        totalIPs: countIPs(parsed.cidr),
      },
    });
  }

  async function captureError(run: () => Promise<unknown>): Promise<unknown> {
    try {
      await run();
    } catch (error) {
      return error;
    }
    throw new Error('Expected operation to reject');
  }

  it('writes valid rows and reports invalid rows with a typed result', async () => {
    const prefix = await createFixturePrefix('10.40.0.0/24');

    const result = await service.importCSV('10.40.0.1/24,TW\nnot-a-cidr,TW');

    expect(result).toMatchObject({ imported: 1, failed: 1 });
    expect(result.errors[0]?.line).toBe(2);
    await expect(prisma.geofeedEntry.findUnique({ where: { prefix: '10.40.0.0/24' } })).resolves.toMatchObject({
      prefixId: prefix.id,
      countryCode: 'TW',
    });
  });

  it('clears nullable update fields without returning a server error', async () => {
    const entry = await service.create({ prefix: '10.41.0.0/24', countryCode: 'TW', region: 'TPE', city: 'Taipei' });
    const dto = Object.assign(new UpdateGeofeedDto(), { region: null, city: null, postalCode: null });

    const updated = await service.update(entry.id, dto);

    expect(updated).toMatchObject({ region: null, city: null, postalCode: null });
  });

  it('rejects mismatched Prefix IDs with a typed 400', async () => {
    const wrongPrefix = await createFixturePrefix('10.42.1.0/24');
    const error = await captureError(() => service.create({
      prefix: '10.42.0.0/24',
      countryCode: 'TW',
      prefixId: wrongPrefix.id,
    }));

    expect(error).toBeInstanceOf(BadRequestException);
    if (!(error instanceof BadRequestException)) throw new Error('Expected BadRequestException');
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toMatchObject({ code: 'GEOFEED_PREFIX_CIDR_MISMATCH' });
    await expect(prisma.geofeedEntry.count()).resolves.toBe(0);
  });

  it('rejects oversized input before any database write', async () => {
    const csv = Array.from({ length: 5_000 }, () => '10.43.0.0/24,TW').join('\n');
    const error = await captureError(() => service.importCSV(csv));

    expect(error).toBeInstanceOf(BadRequestException);
    if (!(error instanceof BadRequestException)) throw new Error('Expected BadRequestException');
    expect(error.getResponse()).toMatchObject({ code: 'GEOFEED_IMPORT_TOO_LARGE' });
    await expect(prisma.geofeedEntry.count()).resolves.toBe(0);
  });

  it('rolls back accepted rows and hides unexpected write details', async () => {
    await executeMysqlTextProtocol(`
      CREATE TRIGGER geofeed_import_failure_test
      BEFORE INSERT ON geofeed_entries
      FOR EACH ROW
      BEGIN
        IF NEW.prefix = '10.44.1.0/24' THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test-only database detail';
        END IF;
      END
    `);

    const error = await captureError(() => service.importCSV('10.44.0.0/24,TW\n10.44.1.0/24,TW'));

    expect(error).toBeInstanceOf(InternalServerErrorException);
    if (!(error instanceof InternalServerErrorException)) throw new Error('Expected InternalServerErrorException');
    expect(error.getResponse()).toEqual({
      code: 'GEOFEED_IMPORT_WRITE_FAILED',
      message: 'Geofeed import could not be completed',
    });
    expect(JSON.stringify(error.getResponse())).not.toContain('test-only database detail');
    await expect(prisma.geofeedEntry.count()).resolves.toBe(0);
  });

  it('allows anonymous RFC 8805 export with escaped fields', async () => {
    await service.create({ prefix: '10.45.0.0/24', countryCode: 'TW', region: 'TPE', city: 'Taipei, City' });

    const response = await request(app.getHttpServer())
      .get('/api/geofeed/generate')
      .query({ header: 'Example geofeed', asn: 'AS64500' })
      .expect(200);

    expect(response.headers['content-type']).toMatch(/^text\/csv/);
    expect(response.headers['content-disposition']).toBe('attachment; filename="geofeed.csv"');
    expect(response.text).toContain('# Example geofeed');
    expect(response.text).toContain('# Geofeed for AS64500');
    expect(response.text).toContain('10.45.0.0/24,TW,TPE,"Taipei, City"');
  });
});
