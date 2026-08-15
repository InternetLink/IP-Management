import { BadRequestException } from '@nestjs/common';
import type { GeofeedEntry } from '@prisma/client';

import { parseCIDR } from '../lib/cidr';

export const GEOFEED_IMPORT_MAX_BYTES = 64 * 1024;
export const GEOFEED_IMPORT_MAX_LINES = 2_000;
export const GEOFEED_IMPORT_MAX_FIELDS = 5;
export const GEOFEED_IMPORT_MAX_FIELD_BYTES = 256;
export const GEOFEED_IMPORT_BATCH_SIZE = 500;
export const GEOFEED_EXPORT_BATCH_SIZE = 500;

const DOMAIN_FIELD_BYTE_LIMITS = [50, 2, 20, 100, 50] as const;

export interface GeofeedImportError {
  readonly line: number;
  readonly input: string;
  readonly message: string;
}

export interface ParsedGeofeedRow {
  readonly line: number;
  readonly input: string;
  readonly prefix: string;
  readonly countryCode: string;
  readonly region: string | null;
  readonly city: string | null;
  readonly postalCode: string | null;
}

export interface ParsedGeofeedImport {
  readonly rows: ParsedGeofeedRow[];
  readonly errors: GeofeedImportError[];
}

function rejectLimit(code: string, message: string): never {
  throw new BadRequestException({ code, message });
}

function validationMessage(error: BadRequestException): string {
  const response = error.getResponse();
  if (typeof response === 'string') return response;
  if (typeof response !== 'object' || response === null) return 'Invalid geofeed row';
  if (!('message' in response)) return 'Invalid geofeed row';
  const message = response.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message) && message.every((item): item is string => typeof item === 'string')) {
    return message.join('; ');
  }
  return 'Invalid geofeed row';
}

export function normalizeCountryCode(countryCode: unknown): string {
  if (typeof countryCode !== 'string') {
    throw new BadRequestException({ code: 'GEOFEED_INVALID_COUNTRY_CODE', message: 'countryCode must be a two-letter code' });
  }
  const normalized = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) {
    throw new BadRequestException({ code: 'GEOFEED_INVALID_COUNTRY_CODE', message: 'countryCode must be a two-letter code' });
  }
  return normalized;
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index++;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === ',' && !quoted) {
      fields.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  if (quoted) throw new BadRequestException('Invalid CSV: unterminated quoted field');
  fields.push(current.trim());
  return fields;
}

export function parseGeofeedImport(csv: string): ParsedGeofeedImport {
  if (Buffer.byteLength(csv, 'utf8') > GEOFEED_IMPORT_MAX_BYTES) {
    rejectLimit('GEOFEED_IMPORT_TOO_LARGE', 'Geofeed CSV exceeds the maximum size of 64 KiB');
  }

  const lines = csv.split(/\r?\n/);
  if (lines.length > GEOFEED_IMPORT_MAX_LINES) {
    rejectLimit('GEOFEED_IMPORT_TOO_MANY_LINES', 'Geofeed CSV exceeds the maximum of 2,000 lines');
  }

  const rows: ParsedGeofeedRow[] = [];
  const errors: GeofeedImportError[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineNumber = index + 1;
    if (!line.trim() || line.trim().startsWith('#')) continue;

    let parts: string[];
    try {
      parts = parseCSVLine(line);
    } catch (error) {
      if (!(error instanceof BadRequestException)) throw error;
      errors.push({ line: lineNumber, input: line, message: validationMessage(error) });
      continue;
    }
    if (parts.length < 2 || parts.length > GEOFEED_IMPORT_MAX_FIELDS) {
      rejectLimit('GEOFEED_IMPORT_INVALID_FIELD_COUNT', `CSV line ${lineNumber} must contain 2 to 5 fields`);
    }
    for (let fieldIndex = 0; fieldIndex < parts.length; fieldIndex++) {
      if (Buffer.byteLength(parts[fieldIndex], 'utf8') > GEOFEED_IMPORT_MAX_FIELD_BYTES) {
        rejectLimit('GEOFEED_IMPORT_FIELD_TOO_LONG', `CSV line ${lineNumber} contains a field exceeding its length limit`);
      }
    }

    try {
      for (let fieldIndex = 0; fieldIndex < parts.length; fieldIndex++) {
        if (fieldIndex === 1) continue;
        const domainLimit = DOMAIN_FIELD_BYTE_LIMITS[fieldIndex] ?? GEOFEED_IMPORT_MAX_FIELD_BYTES;
        if (Buffer.byteLength(parts[fieldIndex], 'utf8') > domainLimit) {
          throw new BadRequestException({ code: 'GEOFEED_FIELD_TOO_LONG', message: `CSV field ${fieldIndex + 1} exceeds its allowed length` });
        }
      }
      const parsed = parseCIDR(parts[0]);
      rows.push({
        line: lineNumber,
        input: line,
        prefix: parsed.cidr,
        countryCode: normalizeCountryCode(parts[1]),
        region: parts[2] || null,
        city: parts[3] || null,
        postalCode: parts[4] || null,
      });
    } catch (error) {
      if (!(error instanceof BadRequestException)) throw error;
      errors.push({ line: lineNumber, input: line, message: validationMessage(error) });
    }
  }
  return { rows, errors };
}

export function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function formatCsvHeader(header?: string, asn?: string): string {
  const lines: string[] = [];
  if (header) header.split('\n').forEach((line) => lines.push(`# ${line.trim()}`));
  if (asn) lines.push(`# Geofeed for ${asn}`);
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push('# Format: ip_prefix,country_code,region_code,city,postal_code');
  return `${lines.join('\n')}\n\n`;
}

export function formatCsvEntry(entry: Pick<GeofeedEntry, 'prefix' | 'countryCode' | 'region' | 'city' | 'postalCode'>): string {
  const parts = [entry.prefix, entry.countryCode, entry.region || '', entry.city || '', entry.postalCode || ''];
  while (parts.length > 2 && parts[parts.length - 1] === '') parts.pop();
  return `${parts.map(csvEscape).join(',')}\n`;
}
