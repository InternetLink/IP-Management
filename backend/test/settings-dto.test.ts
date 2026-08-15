import assert from 'node:assert/strict';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateSettingsDto } from '../src/settings/settings.dto';
import { test, type TestCase } from './test-utils';

type ValidationResult = {
  readonly dto: UpdateSettingsDto;
  readonly invalidFields: readonly string[];
};

async function validateSettings(payload: Record<string, unknown>): Promise<ValidationResult> {
  const dto = plainToInstance(UpdateSettingsDto, payload);
  const errors = await validate(dto, {
    forbidNonWhitelisted: true,
    whitelist: true,
  });
  return {
    dto,
    invalidFields: errors.map((error) => error.property),
  };
}

const numericCases = [
  { name: 'accepts expiry warning lower bound', payload: { expiryWarningDays: 0 }, field: 'expiryWarningDays', valid: true },
  { name: 'accepts expiry warning upper bound', payload: { expiryWarningDays: 365 }, field: 'expiryWarningDays', valid: true },
  { name: 'rejects expiry warning below lower bound', payload: { expiryWarningDays: -1 }, field: 'expiryWarningDays', valid: false },
  { name: 'rejects expiry warning above upper bound', payload: { expiryWarningDays: 366 }, field: 'expiryWarningDays', valid: false },
  { name: 'rejects fractional expiry warning', payload: { expiryWarningDays: 1.5 }, field: 'expiryWarningDays', valid: false },
  { name: 'accepts utilization lower bound', payload: { utilizationThreshold: 0 }, field: 'utilizationThreshold', valid: true },
  { name: 'accepts utilization upper bound', payload: { utilizationThreshold: 100 }, field: 'utilizationThreshold', valid: true },
  { name: 'rejects utilization below lower bound', payload: { utilizationThreshold: -1 }, field: 'utilizationThreshold', valid: false },
  { name: 'rejects utilization above upper bound', payload: { utilizationThreshold: 101 }, field: 'utilizationThreshold', valid: false },
  { name: 'rejects fractional utilization', payload: { utilizationThreshold: 1.5 }, field: 'utilizationThreshold', valid: false },
] as const;

const nonNullableCases = [
  { name: 'rejects null organization name', payload: { organizationName: null }, field: 'organizationName' },
  { name: 'rejects null ASN', payload: { asn: null }, field: 'asn' },
  { name: 'rejects null contact email', payload: { contactEmail: null }, field: 'contactEmail' },
  { name: 'rejects null default RIR', payload: { defaultRIR: null }, field: 'defaultRIR' },
  { name: 'rejects null geofeed header', payload: { geofeedHeader: null }, field: 'geofeedHeader' },
  { name: 'rejects null geofeed auto-ASN flag', payload: { geofeedAutoASN: null }, field: 'geofeedAutoASN' },
  { name: 'rejects null default country code', payload: { defaultCountryCode: null }, field: 'defaultCountryCode' },
  { name: 'rejects null expiry warning', payload: { expiryWarningDays: null }, field: 'expiryWarningDays' },
  { name: 'rejects null utilization threshold', payload: { utilizationThreshold: null }, field: 'utilizationThreshold' },
] as const;

export const settingsDtoTests: TestCase[] = [
  test('accepts empty email and URL as explicit clear values', async () => {
    const result = await validateSettings({ contactEmail: '', geofeedPublicUrl: '' });

    assert.deepEqual(result.invalidFields, []);
    assert.equal(result.dto.contactEmail, '');
    assert.equal(result.dto.geofeedPublicUrl, null);
  }),

  test('accepts null for the nullable public URL', async () => {
    const result = await validateSettings({ geofeedPublicUrl: null });

    assert.deepEqual(result.invalidFields, []);
    assert.equal(result.dto.geofeedPublicUrl, null);
  }),

  test('accepts a well-formed optimistic concurrency version', async () => {
    const result = await validateSettings({ expectedVersion: 'a'.repeat(64) });

    assert.deepEqual(result.invalidFields, []);
  }),

  test('rejects malformed email and URL values', async () => {
    const result = await validateSettings({
      contactEmail: 'invalid-email',
      geofeedPublicUrl: 'not a url',
    });

    assert.deepEqual([...result.invalidFields].sort(), ['contactEmail', 'geofeedPublicUrl']);
  }),

  ...numericCases.map(({ name, payload, field, valid }) => test(name, async () => {
    const result = await validateSettings(payload);

    assert.equal(result.invalidFields.includes(field), !valid);
  })),

  ...nonNullableCases.map(({ name, payload, field }) => test(name, async () => {
    const result = await validateSettings(payload);

    assert.equal(result.invalidFields.includes(field), true);
  })),
];
