import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGeofeedDto, UpdateGeofeedDto } from './geofeed.dto';
import { AuditService } from '../audit/audit.service';
import { parseCIDR } from '../lib/cidr';

function normalizeCountryCode(countryCode: string): string {
  const normalized = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) throw new BadRequestException(`Invalid country code: ${countryCode}`);
  return normalized;
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === ',' && !quoted) {
      fields.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (quoted) throw new BadRequestException('Invalid CSV: unterminated quoted field');
  fields.push(current.trim());
  return fields;
}

function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

@Injectable()
export class GeofeedService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async findAll(query?: { search?: string; countryCode?: string }) {
    const where: any = {};
    if (query?.countryCode) where.countryCode = query.countryCode;
    if (query?.search) {
      where.OR = [
        { prefix: { contains: query.search } },
        { countryCode: { contains: query.search } },
        { city: { contains: query.search } },
        { region: { contains: query.search } },
      ];
    }
    return this.prisma.geofeedEntry.findMany({ where, orderBy: { prefix: 'asc' } });
  }

  async findOne(id: string) {
    const entry = await this.prisma.geofeedEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Geofeed entry not found');
    return entry;
  }

  async create(dto: CreateGeofeedDto) {
    const parsed = parseCIDR(dto.prefix);
    const existing = await this.prisma.geofeedEntry.findUnique({ where: { prefix: parsed.cidr } });
    if (existing) throw new ConflictException(`Prefix ${parsed.cidr} already exists`);
    const prefixRef = dto.prefixId
      ? await this.prisma.prefix.findUnique({ where: { id: dto.prefixId } })
      : await this.prisma.prefix.findUnique({ where: { cidr: parsed.cidr } });
    if (dto.prefixId && !prefixRef) throw new NotFoundException('Prefix not found');
    const entry = await this.prisma.geofeedEntry.create({
      data: {
        prefix: parsed.cidr,
        countryCode: normalizeCountryCode(dto.countryCode),
        region: dto.region?.trim() || null,
        city: dto.city?.trim() || null,
        postalCode: dto.postalCode?.trim() || null,
        prefixId: prefixRef?.id,
        validation: 'valid',
      },
    });
    await this.audit.log('Created', 'Geofeed', entry.id, entry.prefix);
    return entry;
  }

  async update(id: string, dto: UpdateGeofeedDto) {
    const existing = await this.prisma.geofeedEntry.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Geofeed entry not found');
    const changes = Object.entries(dto).filter(([k, v]) => v !== undefined && (existing as any)[k] !== v)
      .map(([field, after]) => ({ field, before: String((existing as any)[field] ?? ''), after: String(after) }));
    const prefixRef = dto.prefixId
      ? await this.prisma.prefix.findUnique({ where: { id: dto.prefixId } })
      : undefined;
    if (dto.prefixId && !prefixRef) throw new NotFoundException('Prefix not found');
    const data: any = {
      ...(dto.countryCode !== undefined && { countryCode: normalizeCountryCode(dto.countryCode) }),
      ...(dto.region !== undefined && { region: dto.region.trim() || null }),
      ...(dto.city !== undefined && { city: dto.city.trim() || null }),
      ...(dto.postalCode !== undefined && { postalCode: dto.postalCode.trim() || null }),
      ...(dto.prefixId !== undefined && { prefixId: dto.prefixId || null }),
      lastUpdated: new Date(),
    };
    const entry = await this.prisma.geofeedEntry.update({ where: { id }, data });
    if (changes.length > 0) await this.audit.log('Updated', 'Geofeed', entry.id, entry.prefix, changes);
    return entry;
  }

  async remove(id: string) {
    const existing = await this.prisma.geofeedEntry.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Geofeed entry not found');
    await this.prisma.geofeedEntry.delete({ where: { id } });
    await this.audit.log('Deleted', 'Geofeed', id, existing.prefix);
    return { deleted: true };
  }

  async importCSV(csv: string) {
    const lines = csv.split(/\r?\n/);
    let imported = 0;
    const errors: Array<{ line: number; input: string; message: string }> = [];

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const lineNumber = index + 1;
      if (!line.trim() || line.trim().startsWith('#')) continue;

      try {
        const parts = parseCSVLine(line);
        if (parts.length < 2 || parts.length > 5) {
          throw new BadRequestException('Expected 2 to 5 CSV fields');
        }
        const [prefix, countryCode, region, city, postalCode] = parts;
        const parsed = parseCIDR(prefix);
        const prefixRef = await this.prisma.prefix.findUnique({ where: { cidr: parsed.cidr } });
        await this.prisma.geofeedEntry.upsert({
          where: { prefix: parsed.cidr },
          create: {
            prefix: parsed.cidr,
            countryCode: normalizeCountryCode(countryCode),
            region: region || null,
            city: city || null,
            postalCode: postalCode || null,
            prefixId: prefixRef?.id,
            validation: 'valid',
          },
          update: {
            countryCode: normalizeCountryCode(countryCode),
            region: region || null,
            city: city || null,
            postalCode: postalCode || null,
            prefixId: prefixRef?.id ?? null,
            lastUpdated: new Date(),
          },
        });
        imported++;
      } catch (e) {
        errors.push({ line: lineNumber, input: line, message: errorMessage(e) });
      }
    }
    await this.audit.log('Imported', 'Geofeed', 'batch', `${imported} entries imported, ${errors.length} failed`);
    return { imported, failed: errors.length, errors };
  }

  async generateCSV(header?: string, asn?: string): Promise<string> {
    const entries = await this.prisma.geofeedEntry.findMany({ orderBy: { prefix: 'asc' } });
    const lines: string[] = [];
    if (header) header.split('\n').forEach(l => lines.push(`# ${l.trim()}`));
    if (asn) lines.push(`# Geofeed for ${asn}`);
    lines.push(`# Generated: ${new Date().toISOString()}`);
    lines.push('# Format: ip_prefix,country_code,region_code,city,postal_code');
    lines.push('');
    for (const e of entries) {
      const parts = [e.prefix, e.countryCode, e.region || '', e.city || '', e.postalCode || ''];
      while (parts.length > 2 && parts[parts.length - 1] === '') parts.pop();
      lines.push(parts.map(csvEscape).join(','));
    }
    return lines.join('\n') + '\n';
  }
}
