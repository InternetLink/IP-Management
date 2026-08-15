import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import type { GeofeedEntry, Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { dashboardCache } from '../dashboard/dashboard-cache';
import { parseCIDR } from '../lib/cidr';
import { PrismaService } from '../prisma/prisma.service';
import { GEOFEED_EXPORT_BATCH_SIZE, GEOFEED_IMPORT_BATCH_SIZE, type GeofeedImportError, formatCsvEntry, formatCsvHeader, normalizeCountryCode, parseGeofeedImport } from './geofeed-csv';
import { CreateGeofeedDto, ListGeofeedQueryDto, UpdateGeofeedDto } from './geofeed.dto';

function normalizeOptionalText(value: string | null | undefined): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

function assertPrefixMatches(prefixRef: { cidr: string } | null, expectedCidr: string): void {
  if (prefixRef && prefixRef.cidr !== expectedCidr) {
    throw new BadRequestException({
      code: 'GEOFEED_PREFIX_CIDR_MISMATCH',
      message: 'prefixId must reference a Prefix with the same CIDR as prefix',
    });
  }
}

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;

function normalizeListQuery(query: ListGeofeedQueryDto): { limit: number; cursor?: string } {
  const limit = query.limit ?? DEFAULT_LIST_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    throw new BadRequestException({
      code: 'GEOFEED_INVALID_LIMIT',
      message: 'limit must be an integer between 1 and 100',
    });
  }
  if (query.cursor === undefined) return { limit };
  try {
    return { limit, cursor: parseCIDR(query.cursor).cidr };
  } catch {
    throw new BadRequestException({
      code: 'GEOFEED_INVALID_CURSOR',
      message: 'cursor must be a valid CIDR',
    });
  }
}

export interface GeofeedImportResult {
  readonly imported: number;
  readonly failed: number;
  readonly errors: GeofeedImportError[];
}

export interface GeofeedPage {
  readonly items: GeofeedEntry[];
  readonly nextCursor: string | null;
}

@Injectable()
export class GeofeedService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async findAll(query: ListGeofeedQueryDto = {}): Promise<GeofeedPage> {
    const { limit, cursor } = normalizeListQuery(query);
    const where: Prisma.GeofeedEntryWhereInput = {};
    if (query?.countryCode) where.countryCode = query.countryCode;
    if (query?.search) {
      where.OR = [
        { prefix: { contains: query.search } },
        { countryCode: { contains: query.search } },
        { city: { contains: query.search } },
        { region: { contains: query.search } },
      ];
    }
    if (cursor) {
      const cursorEntry = await this.prisma.geofeedEntry.findUnique({
        where: { prefix: cursor },
        select: { prefix: true },
      });
      if (!cursorEntry) {
        throw new BadRequestException({
          code: 'GEOFEED_INVALID_CURSOR',
          message: 'cursor does not reference an existing Geofeed entry',
        });
      }
    }
    const entries = await this.prisma.geofeedEntry.findMany({
      where,
      orderBy: { prefix: 'asc' },
      take: limit + 1,
      ...(cursor ? { cursor: { prefix: cursor }, skip: 1 } : {}),
    });
    const hasNextPage = entries.length > limit;
    return {
      items: hasNextPage ? entries.slice(0, limit) : entries,
      nextCursor: hasNextPage ? entries[limit - 1]?.prefix ?? null : null,
    };
  }

  async findOne(id: string) {
    const entry = await this.prisma.geofeedEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Geofeed entry not found');
    return entry;
  }

  async create(dto: CreateGeofeedDto) {
    const parsed = parseCIDR(dto.prefix);
    const entry = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.geofeedEntry.findUnique({ where: { prefix: parsed.cidr } });
      if (existing) throw new ConflictException(`Prefix ${parsed.cidr} already exists`);
      const prefixRef = dto.prefixId
        ? await tx.prefix.findUnique({ where: { id: dto.prefixId } })
        : await tx.prefix.findUnique({ where: { cidr: parsed.cidr } });
      if (dto.prefixId && !prefixRef) throw new NotFoundException('Prefix not found');
      assertPrefixMatches(prefixRef, parsed.cidr);
      const created = await tx.geofeedEntry.create({
        data: {
          prefix: parsed.cidr,
          countryCode: normalizeCountryCode(dto.countryCode),
          region: normalizeOptionalText(dto.region),
          city: normalizeOptionalText(dto.city),
          postalCode: normalizeOptionalText(dto.postalCode),
          prefixId: prefixRef?.id,
          validation: 'valid',
        },
      });
      await tx.auditLog.create({
        data: this.audit.buildEntry('Created', 'Geofeed', created.id, created.prefix),
      });
      return created;
    });
    dashboardCache.invalidate();
    return entry;
  }

  async update(id: string, dto: UpdateGeofeedDto) {
    const existing = await this.prisma.geofeedEntry.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Geofeed entry not found');
    const changeFields = ['countryCode', 'region', 'city', 'postalCode', 'prefixId'] as const;
    const changes = changeFields
      .filter((field) => dto[field] !== undefined && existing[field] !== dto[field])
      .map((field) => ({ field, before: String(existing[field] ?? ''), after: String(dto[field] ?? '') }));
    const entry = await this.prisma.$transaction(async (tx) => {
      const prefixRef = dto.prefixId
        ? await tx.prefix.findUnique({ where: { id: dto.prefixId } })
        : undefined;
      if (dto.prefixId && !prefixRef) throw new NotFoundException('Prefix not found');
      assertPrefixMatches(prefixRef ?? null, existing.prefix);
      const data: Prisma.GeofeedEntryUncheckedUpdateInput = { lastUpdated: new Date() };
      if (dto.countryCode !== undefined) data.countryCode = normalizeCountryCode(dto.countryCode);
      if (dto.region !== undefined) data.region = normalizeOptionalText(dto.region);
      if (dto.city !== undefined) data.city = normalizeOptionalText(dto.city);
      if (dto.postalCode !== undefined) data.postalCode = normalizeOptionalText(dto.postalCode);
      if (dto.prefixId !== undefined) data.prefixId = dto.prefixId || null;
      const updated = await tx.geofeedEntry.update({ where: { id }, data });
      await tx.auditLog.create({
        data: this.audit.buildEntry('Updated', 'Geofeed', updated.id, updated.prefix, changes),
      });
      return updated;
    });
    dashboardCache.invalidate();
    return entry;
  }

  async remove(id: string) {
    const existing = await this.prisma.geofeedEntry.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Geofeed entry not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.geofeedEntry.delete({ where: { id } });
      await tx.auditLog.create({
        data: this.audit.buildEntry('Deleted', 'Geofeed', id, existing.prefix),
      });
    });
    dashboardCache.invalidate();
    return { deleted: true };
  }

  async importCSV(csv: string): Promise<GeofeedImportResult> {
    const parsed = parseGeofeedImport(csv);
    const errors = parsed.errors;
    try {
      await this.prisma.$transaction(async (tx) => {
        if (parsed.rows.length > 0) {
          for (let offset = 0; offset < parsed.rows.length; offset += GEOFEED_IMPORT_BATCH_SIZE) {
            const batch = parsed.rows.slice(offset, offset + GEOFEED_IMPORT_BATCH_SIZE);
            const prefixes = await tx.prefix.findMany({
              where: { cidr: { in: batch.map((row) => row.prefix) } },
              select: { id: true, cidr: true },
            });
            const prefixIds = new Map(prefixes.map((prefix) => [prefix.cidr, prefix.id]));
            for (const row of batch) {
              await tx.geofeedEntry.upsert({
                where: { prefix: row.prefix },
                create: {
                  prefix: row.prefix,
                  countryCode: row.countryCode,
                  region: row.region,
                  city: row.city,
                  postalCode: row.postalCode,
                  prefixId: prefixIds.get(row.prefix) ?? null,
                  validation: 'valid',
                },
                update: {
                  countryCode: row.countryCode,
                  region: row.region,
                  city: row.city,
                  postalCode: row.postalCode,
                  prefixId: prefixIds.get(row.prefix) ?? null,
                  lastUpdated: new Date(),
                },
              });
            }
          }
        }
        await tx.auditLog.create({
          data: this.audit.buildEntry('Imported', 'Geofeed', 'batch', `${parsed.rows.length} entries imported, ${errors.length} failed`),
        });
      }, { maxWait: 10_000, timeout: 60_000 });
    } catch {
      throw new InternalServerErrorException({
        code: 'GEOFEED_IMPORT_WRITE_FAILED',
        message: 'Geofeed import could not be completed',
      });
    }
    const imported = parsed.rows.length;
    if (imported > 0) dashboardCache.invalidate();
    return { imported, failed: errors.length, errors };
  }

  async *generateCSV(header?: string, asn?: string): AsyncGenerator<string> {
    yield formatCsvHeader(header, asn);
    let cursor: string | undefined;
    while (true) {
      const entries = await this.prisma.geofeedEntry.findMany({
        orderBy: { prefix: 'asc' },
        take: GEOFEED_EXPORT_BATCH_SIZE,
        ...(cursor ? { cursor: { prefix: cursor }, skip: 1 } : {}),
      });
      if (entries.length === 0) return;
      for (const entry of entries) yield formatCsvEntry(entry);
      if (entries.length < GEOFEED_EXPORT_BATCH_SIZE) return;
      cursor = entries[entries.length - 1]?.prefix;
      if (!cursor) return;
    }
  }
}
