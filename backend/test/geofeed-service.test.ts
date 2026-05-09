import assert from 'node:assert/strict';
import { GeofeedService } from '../src/geofeed/geofeed.service';
import { assertRejectsWith, test, type TestCase } from './test-utils';

function createHarness() {
  const prefixes = [{ id: 'prefix-1', cidr: '10.0.0.0/24' }];
  const entries: any[] = [];
  const auditLogs: any[] = [];
  let sequence = 0;

  const prisma = {
    prefix: {
      findUnique: async ({ where }: any) =>
        prefixes.find(prefix => (where.id && prefix.id === where.id) || (where.cidr && prefix.cidr === where.cidr)) ?? null,
    },
    geofeedEntry: {
      findUnique: async ({ where }: any) =>
        entries.find(entry => (where.id && entry.id === where.id) || (where.prefix && entry.prefix === where.prefix)) ?? null,
      findMany: async () => [...entries].sort((a, b) => a.prefix.localeCompare(b.prefix)),
      create: async ({ data }: any) => {
        const entry = { id: `geofeed-${++sequence}`, lastUpdated: new Date(), ...data };
        entries.push(entry);
        return entry;
      },
      update: async ({ where, data }: any) => {
        const entry = entries.find(item => item.id === where.id);
        if (!entry) throw new Error('Geofeed entry not found');
        Object.assign(entry, data);
        return entry;
      },
      delete: async ({ where }: any) => {
        const index = entries.findIndex(item => item.id === where.id);
        if (index < 0) throw new Error('Geofeed entry not found');
        const [deleted] = entries.splice(index, 1);
        return deleted;
      },
      upsert: async ({ where, create, update }: any) => {
        const existing = entries.find(entry => entry.prefix === where.prefix);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const entry = { id: `geofeed-${++sequence}`, lastUpdated: new Date(), ...create };
        entries.push(entry);
        return entry;
      },
    },
  };

  const audit = {
    log: async (...args: any[]) => {
      auditLogs.push(args);
    },
  };

  return {
    auditLogs,
    entries,
    service: new GeofeedService(prisma as any, audit as any),
  };
}

export const geofeedServiceTests: TestCase[] = [
  test('imports quoted CSV fields and reports invalid rows', async () => {
    const { entries, service } = createHarness();

    const result = await service.importCSV([
      '# ip_prefix,country_code,region_code,city,postal_code',
      '10.0.0.42/24,tw,TPE,"Taipei, City",100',
      'not-a-cidr,TW',
      '10.0.1.0/24,USA',
    ].join('\n'));

    assert.equal(result.imported, 1);
    assert.equal(result.failed, 2);
    assert.equal(entries[0].prefix, '10.0.0.0/24');
    assert.equal(entries[0].countryCode, 'TW');
    assert.equal(entries[0].city, 'Taipei, City');
    assert.equal(entries[0].prefixId, 'prefix-1');
    assert.equal(result.errors[0].line, 3);
  }),

  test('escapes geofeed CSV output fields', async () => {
    const { service } = createHarness();

    await service.importCSV('10.0.0.0/24,TW,TPE,"Taipei, City"');
    const csv = await service.generateCSV('Example geofeed', 'AS64500');

    assert.match(csv, /# Example geofeed/);
    assert.match(csv, /# Geofeed for AS64500/);
    assert.match(csv, /10\.0\.0\.0\/24,TW,TPE,"Taipei, City"/);
  }),

  test('rejects explicit prefixId that does not exist', async () => {
    const { service } = createHarness();

    await assertRejectsWith(
      async () => service.create({ prefix: '10.0.2.0/24', countryCode: 'TW', prefixId: 'missing-prefix' }),
      /Prefix not found/,
    );
  }),
];

