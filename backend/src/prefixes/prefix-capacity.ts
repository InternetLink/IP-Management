import { Prisma } from '@prisma/client';

import { countIPsExact } from '../lib/cidr';

export type PrefixCapacityRecord = {
  readonly cidr: string;
  readonly totalIPs: number;
  readonly usedIPs: number;
  readonly totalIPsExact?: Prisma.Decimal | string | bigint | number | null;
  readonly usedIPsExact?: Prisma.Decimal | string | bigint | number | null;
};

export class PrefixCapacitySerializationError extends Error {
  readonly name = 'PrefixCapacitySerializationError';
}

export function exactDecimal(value: bigint): Prisma.Decimal {
  return new Prisma.Decimal(value.toString());
}

export function exactCapacityFields(cidr: string) {
  return {
    totalIPsExact: exactDecimal(countIPsExact(cidr)),
    usedIPsExact: exactDecimal(0n),
  };
}

export function exactUsedCapacity(value: number): Prisma.Decimal {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PrefixCapacitySerializationError('Legacy used IP capacity is not a non-negative integer');
  }
  return exactDecimal(BigInt(value));
}

function decimalString(value: PrefixCapacityRecord['totalIPsExact']): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new PrefixCapacitySerializationError('Exact capacity is outside the safe integer range');
    }
    return BigInt(value).toString();
  }

  if (value instanceof Prisma.Decimal) return value.toFixed(0);

  const text = value.toString();
  if (!/^\d+$/.test(text)) {
    throw new PrefixCapacitySerializationError('Exact capacity is not a non-negative decimal string');
  }
  return text;
}

function legacyUsedString(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PrefixCapacitySerializationError('Legacy used IP capacity is not a non-negative integer');
  }
  return BigInt(value).toString();
}

export function serializePrefixCapacity<T extends PrefixCapacityRecord>(
  prefix: T,
): Omit<T, 'totalIPsExact' | 'usedIPsExact'> & {
  readonly totalIPsExact: string;
  readonly usedIPsExact: string;
} {
  return {
    ...prefix,
    totalIPsExact: decimalString(prefix.totalIPsExact) ?? countIPsExact(prefix.cidr).toString(),
    usedIPsExact: decimalString(prefix.usedIPsExact) ?? legacyUsedString(prefix.usedIPs),
  };
}
