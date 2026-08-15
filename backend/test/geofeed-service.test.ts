import assert from 'node:assert/strict';
import { GeofeedService } from '../src/geofeed/geofeed.service';
import { UpdateGeofeedDto } from '../src/geofeed/geofeed.dto';
import { assertRejectsWith, test, type TestCase } from './test-utils';

function createHarness() {
  const prefixes = [
    { id: 'prefix-1', cidr: '10.0.0.0/24' },
    { id: 'prefix-2', cidr: '10.0.1.0/24' },
  ];
  const entries: any[] = [];
  const auditLogs: any[] = [];
  const exportQueries: any[] = [];
  let sequence = 0;
  let failOnPrefix: string | undefined;

  const prisma: any = {
    auditLog: {
      create: async ({ data }: any) => {
        auditLogs.push(data);
        return data;
      },
    },
    prefix: {
      findUnique: async ({ where }: any) =>
        prefixes.find(prefix => (where.id && prefix.id === where.id) || (where.cidr && prefix.cidr === where.cidr)) ?? null,
      findMany: async ({ where }: any = {}) => prefixes.filter(prefix => where?.cidr?.in?.includes(prefix.cidr)),
    },
    geofeedEntry: {
      findUnique: async ({ where }: any) =>
        entries.find(entry => (where.id && entry.id === where.id) || (where.prefix && entry.prefix === where.prefix)) ?? null,
      findMany: async ({ cursor, skip = 0, take, where }: any = {}) => {
        exportQueries.push({ cursor, skip, take });
        let result = [...entries].sort((a, b) => a.prefix.localeCompare(b.prefix));
        if (where?.countryCode) result = result.filter(entry => entry.countryCode === where.countryCode);
        if (where?.OR) {
          result = result.filter(entry => where.OR.some((condition: any) => {
            const [field, filter] = Object.entries(condition)[0] as [string, { contains: string }];
            return String(entry[field] ?? '').includes(filter.contains);
          }));
        }
        if (cursor?.prefix) {
          const cursorIndex = result.findIndex(entry => entry.prefix === cursor.prefix);
          result = cursorIndex < 0 ? [] : result.slice(cursorIndex + skip);
        }
        return take === undefined ? result : result.slice(0, take);
      },
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
        if (where.prefix === failOnPrefix) throw new Error('database failure details');
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
    $transaction: async (callback: any) => {
      const snapshot = entries.map(entry => ({ ...entry }));
      try {
        return await callback(prisma);
      } catch (error) {
        entries.splice(0, entries.length, ...snapshot);
        throw error;
      }
    },
  };

  const audit = {
    buildEntry: (action: string, resourceType: string, resourceId: string, resourceLabel: string, changes?: any) => ({
      action,
      resourceType,
      resourceId,
      resourceLabel,
      changes: changes ?? undefined,
      user: 'system',
      userId: null,
    }),
  };

  return {
    auditLogs,
    entries,
    exportQueries,
    setFailOnPrefix: (prefix: string | undefined) => { failOnPrefix = prefix; },
    service: new GeofeedService(prisma, audit as any),
  };
}

async function collectCSV(chunks: AsyncIterable<string>): Promise<string> {
  let csv = '';
  for await (const chunk of chunks) csv += chunk;
  return csv;
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

  test('rejects an import that exceeds the byte limit before writing', async () => {
    const { entries, service } = createHarness();
    const csv = Array.from({ length: 5_000 }, () => '10.0.0.0/24,TW').join('\n');

    await assertRejectsWith(async () => service.importCSV(csv), /maximum size/);

    assert.equal(entries.length, 0);
  }),

  test('rejects an import that exceeds the line limit before writing', async () => {
    const { entries, service } = createHarness();
    const csv = Array.from({ length: 2_001 }, () => '# comment').join('\n');

    await assertRejectsWith(async () => service.importCSV(csv), /maximum of 2,000 lines/);

    assert.equal(entries.length, 0);
  }),

  test('rejects an oversized field before writing', async () => {
    const { entries, service } = createHarness();
    const csv = `10.0.0.0/24,TW,${'x'.repeat(257)}`;

    await assertRejectsWith(async () => service.importCSV(csv), /exceeding its length limit/);

    assert.equal(entries.length, 0);
  }),

  test('rolls back all accepted rows when a transactional write fails', async () => {
    const { entries, service, setFailOnPrefix } = createHarness();
    setFailOnPrefix('10.0.1.0/24');

    await assertRejectsWith(
      async () => service.importCSV('10.0.0.0/24,TW\n10.0.1.0/24,TW'),
      /could not be completed/,
    );

    assert.equal(entries.length, 0);
  }),

  test('escapes geofeed CSV output fields', async () => {
    const { service } = createHarness();

    await service.importCSV('10.0.0.0/24,TW,TPE,"Taipei, City"');
    const csv = await collectCSV(service.generateCSV('Example geofeed', 'AS64500'));

    assert.match(csv, /# Example geofeed/);
    assert.match(csv, /# Geofeed for AS64500/);
    assert.match(csv, /10\.0\.0\.0\/24,TW,TPE,"Taipei, City"/);
  }),

  test('streams large CSV exports through bounded reads', async () => {
    const { exportQueries, service } = createHarness();
    for (let index = 0; index < 1_001; index++) {
      const thirdOctet = Math.floor(index / 256);
      const fourthOctet = index % 256;
      await service.create({ prefix: `10.20.${thirdOctet}.${fourthOctet}/32`, countryCode: 'TW' });
    }

    const chunks: string[] = [];
    for await (const chunk of service.generateCSV()) chunks.push(chunk);

    assert.equal(chunks.length, 1_002);
    assert.equal(exportQueries.length, 3);
    assert.ok(exportQueries.every(query => query.take === 500));
  }),

  test('rejects explicit prefixId that does not exist', async () => {
    const { service } = createHarness();

    await assertRejectsWith(
      async () => service.create({ prefix: '10.0.2.0/24', countryCode: 'TW', prefixId: 'missing-prefix' }),
      /Prefix not found/,
    );
  }),

  test('clears nullable fields when update receives explicit null', async () => {
    const { entries, service } = createHarness();
    const created = await service.create({ prefix: '10.0.0.0/24', countryCode: 'TW', region: 'TPE' });
    const dto = Object.assign(new UpdateGeofeedDto(), { region: null, city: null, postalCode: null });

    const updated = await service.update(created.id, dto);

    assert.equal(updated.region, null);
    assert.equal(updated.city, null);
    assert.equal(updated.postalCode, null);
    assert.equal(entries[0].region, null);
  }),

  test('rejects a prefixId whose CIDR differs from the geofeed prefix', async () => {
    const { service } = createHarness();

    await assertRejectsWith(
      async () => service.create({ prefix: '10.0.2.0/24', countryCode: 'TW', prefixId: 'prefix-1' }),
      /same CIDR/,
    );
  }),

  test('returns a bounded cursor page from findAll', async () => {
    const { service } = createHarness();
    await service.create({ prefix: '10.0.0.0/24', countryCode: 'TW' });
    await service.create({ prefix: '10.0.1.0/24', countryCode: 'TW' });

    const query = Object.assign({}, { limit: 1 });
    const page = await service.findAll(query);

    assert.equal(page.items.length, 1);
    assert.equal(typeof page.nextCursor, 'string');
    assert.ok(page.nextCursor);
    const nextPage = await service.findAll({ limit: 1, cursor: page.nextCursor });
    assert.equal(nextPage.items.length, 1);
    assert.notEqual(nextPage.items[0]?.prefix, page.items[0]?.prefix);
  }),

  test('rejects a list limit outside the service boundary', async () => {
    const { service } = createHarness();

    await assertRejectsWith(async () => service.findAll({ limit: 101 }), /between 1 and 100/);
  }),

  test('rejects a malformed list cursor before querying Prisma', async () => {
    const { service } = createHarness();

    await assertRejectsWith(async () => service.findAll({ cursor: 'not-a-cidr' }), /valid CIDR/);
  }),
];

