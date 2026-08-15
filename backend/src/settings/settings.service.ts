import { createHash } from 'node:crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import type { AppSettings } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './settings.dto';

const SETTINGS_ID = 'default';
const SETTINGS_INITIALIZATION_MAX_ATTEMPTS = 3;
const SETTINGS_INITIALIZATION_RETRY_CODES = new Set(['P2002', 'P2034']);
const SETTINGS_FIELDS = [
  'organizationName',
  'asn',
  'contactEmail',
  'defaultRIR',
  'geofeedHeader',
  'geofeedAutoASN',
  'defaultCountryCode',
  'geofeedPublicUrl',
  'expiryWarningDays',
  'utilizationThreshold',
] as const;

function isRetryableInitializationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = 'code' in error ? error.code : undefined;
  if (typeof code === 'string' && SETTINGS_INITIALIZATION_RETRY_CODES.has(code)) return true;
  return error.message.includes('Record has changed since last read');
}

function versionFor(settings: AppSettings): string {
  const values = SETTINGS_FIELDS.map((field) => settings[field]);
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

function withVersion(settings: AppSettings) {
  return { ...settings, version: versionFor(settings) };
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get() {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const settings = await this.prisma.appSettings.upsert({
          where: { id: SETTINGS_ID },
          create: { id: SETTINGS_ID },
          update: {},
        });
        return withVersion(settings);
      } catch (error) {
        if (
          !isRetryableInitializationError(error)
          || attempt >= SETTINGS_INITIALIZATION_MAX_ATTEMPTS
        ) {
          throw error;
        }
      }
    }
  }

  async update(dto: UpdateSettingsDto) {
    const { expectedVersion, ...settingsUpdate } = dto;

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM app_settings WHERE id = ${SETTINGS_ID} FOR UPDATE
      `;
      const existing = await tx.appSettings.findUnique({ where: { id: SETTINGS_ID } });

      if (expectedVersion !== undefined) {
        const currentVersion = existing ? versionFor(existing) : undefined;
        if (currentVersion !== expectedVersion) {
          throw new ConflictException('Settings changed since they were loaded');
        }
      }

      const changes = SETTINGS_FIELDS.flatMap((field) => {
        const after = settingsUpdate[field];
        if (after === undefined || existing?.[field] === after) return [];
        return [{
          field,
          before: String(existing?.[field] ?? ''),
          after: String(after ?? ''),
        }];
      });

      const saved = await tx.appSettings.upsert({
        where: { id: SETTINGS_ID },
        create: { id: SETTINGS_ID, ...settingsUpdate },
        update: settingsUpdate,
      });
      await tx.auditLog.create({
        data: this.audit.buildEntry(
          'Updated',
          'Settings',
          saved.id,
          'Application settings',
          changes,
        ),
      });
      return saved;
    });

    return withVersion(updated);
  }
}
