import { createHash } from 'node:crypto';

import { countIPsExact } from '../lib/cidr';

export const CAPACITY_MIGRATION_ID = 'capacity-v1' as const;
export const CAPACITY_TARGET_VERSION = 'decimal-65-0' as const;
export const CAPACITY_INITIAL_CHECKSUM = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' as const;

export const CAPACITY_STAGES = {
  EXPANDED: 'EXPANDED',
  BACKFILLING: 'BACKFILLING',
  BACKFILLED: 'BACKFILLED',
  CONTRACTED: 'CONTRACTED',
  FAILED: 'FAILED',
} as const;

export type CapacityMigrationStage = (typeof CAPACITY_STAGES)[keyof typeof CAPACITY_STAGES];

const STAGE_VALUES = new Set<string>(Object.values(CAPACITY_STAGES));

export class CapacityLeaseUnavailableError extends Error {
  readonly name = 'CapacityLeaseUnavailableError';

  constructor(readonly leaseOwner: string, readonly leaseExpiresAt: Date) {
    super(`Capacity backfill lease is held by ${leaseOwner} until ${leaseExpiresAt.toISOString()}`);
  }
}

export class CapacityBackfillDataError extends Error {
  readonly name = 'CapacityBackfillDataError';
  readonly failureCode = 'INVALID_PREFIX_CAPACITY_DATA';

  constructor(readonly prefixId: string, readonly cidr: string, message: string) {
    super(`Prefix ${prefixId} (${cidr}) cannot be backfilled: ${message}`);
  }
}

export class CapacityBackfillVerificationError extends Error {
  readonly name = 'CapacityBackfillVerificationError';
  readonly failureCode = 'BACKFILL_VERIFICATION_FAILED';

  constructor(message: string) {
    super(message);
  }
}

export class CapacityBackfillStateError extends Error {
  readonly name = 'CapacityBackfillStateError';

  constructor(message: string) {
    super(message);
  }
}

export class CapacityReadinessError extends Error {
  readonly name = 'CapacityReadinessError';

  constructor(message: string) {
    super(message);
  }
}

export type CapacityPrefixRow = {
  readonly id: string;
  readonly cidr: string;
  readonly usedLegacy: string;
  readonly totalIPsExact: string | null;
  readonly usedIPsExact: string | null;
};

export type CapacityChecksumEntry = {
  readonly id: string;
  readonly total: string;
  readonly used: string;
};

export function isCapacityStage(value: string): value is CapacityMigrationStage {
  return STAGE_VALUES.has(value);
}

export function parseCapacityStage(value: string): CapacityMigrationStage {
  if (!isCapacityStage(value)) {
    throw new CapacityBackfillStateError(`Unknown capacity migration stage: ${value}`);
  }
  return value;
}

export function exactCapacityEntry(row: CapacityPrefixRow): CapacityChecksumEntry {
  let total: string;
  try {
    total = countIPsExact(row.cidr).toString();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CIDR parser returned an unknown error';
    throw new CapacityBackfillDataError(row.id, row.cidr, message);
  }

  const usedMatch = /^(\d+)(?:\.0+)?$/.exec(row.usedLegacy.trim());
  const used = usedMatch?.[1];
  if (used === undefined) {
    throw new CapacityBackfillDataError(row.id, row.cidr, 'legacy usedIPs is not a non-negative integer');
  }

  return { id: row.id, total, used };
}

export function advanceCapacityChecksum(
  previous: string,
  entry: CapacityChecksumEntry,
): string {
  return createHash('sha256')
    .update(previous)
    .update('\0')
    .update(entry.id)
    .update('\0')
    .update(entry.total)
    .update('\0')
    .update(entry.used)
    .digest('hex');
}

export function capacityChecksum(
  entries: readonly CapacityChecksumEntry[],
): string {
  return entries.reduce(advanceCapacityChecksum, CAPACITY_INITIAL_CHECKSUM);
}
