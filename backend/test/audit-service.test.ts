import assert from 'node:assert/strict';

import { AuditService } from '../src/audit/audit.service';
import { assertRejectsWith, test, type TestCase } from './test-utils';

function matchesWhere(record: Record<string, unknown>, where?: Record<string, any>): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR' && Array.isArray(value)) {
      return value.some(condition => matchesWhere(record, condition));
    }
    if (value && typeof value === 'object' && 'contains' in value) {
      return String(record[key] ?? '').toLowerCase().includes(String(value.contains).toLowerCase());
    }
    return record[key] === value;
  });
}

function createHarness() {
  const entries = [
    { id: 'audit-4', timestamp: new Date('2026-08-15T04:00:00Z'), action: 'Updated', resourceType: 'Prefix', resourceLabel: '10.0.3.0/24' },
    { id: 'audit-3', timestamp: new Date('2026-08-15T03:00:00Z'), action: 'Created', resourceType: 'Prefix', resourceLabel: '10.0.2.0/24' },
    { id: 'audit-2', timestamp: new Date('2026-08-15T02:00:00Z'), action: 'Updated', resourceType: 'Prefix', resourceLabel: '10.0.1.0/24' },
    { id: 'audit-1', timestamp: new Date('2026-08-15T01:00:00Z'), action: 'Updated', resourceType: 'Geofeed', resourceLabel: '10.0.0.0/24' },
  ].map(entry => ({ changes: null, resourceId: entry.id, user: 'admin', userId: null, ...entry }));

  const prisma: any = {
    auditLog: {
      findUnique: async ({ where }: any) => entries.find(entry => entry.id === where.id) ?? null,
      findMany: async ({ cursor, skip = 0, take, where }: any = {}) => {
        let result = entries
          .filter(entry => matchesWhere(entry, where))
          .sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime() || right.id.localeCompare(left.id));
        if (cursor?.id) {
          const cursorIndex = result.findIndex(entry => entry.id === cursor.id);
          result = cursorIndex < 0 ? [] : result.slice(cursorIndex + skip);
        }
        return take === undefined ? result : result.slice(0, take);
      },
      create: async ({ data }: any) => data,
    },
  };

  return new AuditService(prisma);
}

export const auditServiceTests: TestCase[] = [
  test('returns bounded cursor pages while preserving audit filters', async () => {
    const service = createHarness();

    const firstPage = await service.findAll({ action: 'Updated', resourceType: 'Prefix', limit: 1 });
    assert.equal(firstPage.items.length, 1);
    assert.ok(firstPage.nextCursor);
    assert.equal(firstPage.items[0]?.id, 'audit-4');

    const secondPage = await service.findAll({
      action: 'Updated',
      resourceType: 'Prefix',
      limit: 1,
      cursor: firstPage.nextCursor!,
    });
    assert.equal(secondPage.items.length, 1);
    assert.equal(secondPage.items[0]?.id, 'audit-2');
    assert.equal(secondPage.nextCursor, null);
  }),

  test('rejects audit cursors outside the current filtered query', async () => {
    const service = createHarness();

    await assertRejectsWith(
      async () => service.findAll({ action: 'Created', cursor: 'audit-4' }),
      /cursor/i,
    );
    await assertRejectsWith(
      async () => service.findAll({ limit: 501 }),
      /between 1 and 500/,
    );
  }),
];
