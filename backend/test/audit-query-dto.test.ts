import assert from 'node:assert/strict';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AuditQueryDto } from '../src/audit/audit.dto';
import { test, type TestCase } from './test-utils';

function errors(input: Record<string, string>) {
  const dto = plainToInstance(AuditQueryDto, input);
  return validateSync(dto).flatMap(error => Object.values(error.constraints ?? {}));
}

export const auditQueryDtoTests: TestCase[] = [
  test('defaults an omitted limit and transforms a valid query value', () => {
    const dto = plainToInstance(AuditQueryDto, { limit: '25' });

    assert.equal(dto.limit, 25);
    assert.deepEqual(errors({ action: 'Invalid', limit: '25' }), [
      'action must be one of the following values: Created, Updated, Deleted, Imported, Exported, Generated, Split',
    ]);
  }),

  test('rejects malformed and out-of-range limits', () => {
    for (const limit of ['abc', '-1', '501']) {
      assert.ok(errors({ limit }).some(message => message.includes('limit')));
    }
  }),

  test('bounds the search field and filter values', () => {
    assert.ok(errors({ search: 'x'.repeat(256) }).some(message => message.includes('search')));
    assert.ok(errors({ resourceType: 'Unknown' }).some(message => message.includes('resourceType')));
    assert.ok(errors({ cursor: 'x'.repeat(51) }).some(message => message.includes('cursor')));
  }),
];
