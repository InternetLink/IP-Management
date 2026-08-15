import assert from 'node:assert/strict';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  GenerateGeofeedQueryDto,
  ListGeofeedQueryDto,
  UpdateGeofeedDto,
} from '../src/geofeed/geofeed.dto';
import { test, type TestCase } from './test-utils';

function propertyNames(errors: Awaited<ReturnType<typeof validate>>): string[] {
  return errors.map((error) => error.property).sort();
}

export const geofeedDtoTests: TestCase[] = [
  test('accepts explicit null as the clear value for nullable update fields', async () => {
    const dto = Object.assign(new UpdateGeofeedDto(), { region: null, city: null, postalCode: null });

    assert.deepEqual(propertyNames(await validate(dto)), []);
  }),

  test('rejects null for the required country code update', async () => {
    const dto = Object.assign(new UpdateGeofeedDto(), { countryCode: null });

    assert.deepEqual(propertyNames(await validate(dto)), ['countryCode']);
  }),

  test('transforms and bounds the list limit', async () => {
    const valid = plainToInstance(ListGeofeedQueryDto, { limit: '50' });
    const invalid = plainToInstance(ListGeofeedQueryDto, { limit: '101' });

    assert.equal(valid.limit, 50);
    assert.deepEqual(propertyNames(await validate(valid)), []);
    assert.deepEqual(propertyNames(await validate(invalid)), ['limit']);
  }),

  test('bounds export query metadata before streaming starts', async () => {
    const dto = plainToInstance(GenerateGeofeedQueryDto, { header: 'x'.repeat(1_001) });

    assert.deepEqual(propertyNames(await validate(dto)), ['header']);
  }),
];
