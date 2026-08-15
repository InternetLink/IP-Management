import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Allocation } from '@prisma/client';

import { countIPsExact, formatIP, ipSortValue, parseCIDR } from '../lib/cidr';
import type { PrismaService } from '../prisma/prisma.service';

export const DEFAULT_ALLOCATION_LIST_LIMIT = 50;
export const MAX_ALLOCATION_LIST_LIMIT = 100;
export const ALLOCATION_HEATMAP_BUCKET_COUNT = 256;
const HEATMAP_SCAN_BATCH_SIZE = 500;
const ALLOCATION_STATUSES = ['Available', 'Allocated', 'Reserved'] as const;

export type AllocationStatus = (typeof ALLOCATION_STATUSES)[number];
export type AllocationListQuery = {
  readonly cursor?: string;
  readonly limit?: number;
  readonly status?: string;
};
export type AllocationPage = {
  readonly items: Allocation[];
  readonly nextCursor: string | null;
};
export type AllocationStatusCounts = Record<AllocationStatus, number>;
export type AllocationHeatmapBucket = {
  readonly capacity: string;
  readonly counts: AllocationStatusCounts;
  readonly endAddress: string | null;
  readonly index: number;
  readonly startAddress: string | null;
};
export type AllocationHeatmap = {
  readonly bucketCount: typeof ALLOCATION_HEATMAP_BUCKET_COUNT;
  readonly buckets: AllocationHeatmapBucket[];
  readonly totalCapacity: string;
};

function emptyCounts(): AllocationStatusCounts {
  return { Available: 0, Allocated: 0, Reserved: 0 };
}

function isAllocationStatus(value: string): value is AllocationStatus {
  return ALLOCATION_STATUSES.some(status => status === value);
}

function normalizeListQuery(query: AllocationListQuery) {
  const limit = query.limit ?? DEFAULT_ALLOCATION_LIST_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ALLOCATION_LIST_LIMIT) {
    throw new BadRequestException(`Allocation list limit must be between 1 and ${MAX_ALLOCATION_LIST_LIMIT}`);
  }
  const status = query.status === 'all' ? undefined : query.status;
  if (status && !isAllocationStatus(status)) {
    throw new BadRequestException('Allocation status is invalid');
  }
  return { cursor: query.cursor?.trim() || undefined, limit, status };
}

async function findPrefix(prisma: PrismaService, id: string) {
  const prefix = await prisma.prefix.findUnique({ where: { id } });
  if (!prefix) throw new NotFoundException('Prefix not found');
  return prefix;
}

export async function findAllocationPage(
  prisma: PrismaService,
  prefixId: string,
  rawQuery: AllocationListQuery = {},
): Promise<AllocationPage> {
  await findPrefix(prisma, prefixId);
  const query = normalizeListQuery(rawQuery);
  if (query.cursor) {
    const cursorAllocation = await prisma.allocation.findUnique({ where: { id: query.cursor } });
    if (
      !cursorAllocation ||
      cursorAllocation.prefixId !== prefixId ||
      (query.status !== undefined && cursorAllocation.status !== query.status)
    ) {
      throw new BadRequestException({
        code: 'INVALID_ALLOCATION_CURSOR',
        message: 'Allocation cursor does not belong to the current query',
      });
    }
  }

  const allocations = await prisma.allocation.findMany({
    where: { prefixId, ...(query.status ? { status: query.status } : {}) },
    orderBy: [{ ipAddress: 'asc' }, { id: 'asc' }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const hasNextPage = allocations.length > query.limit;
  const items = hasNextPage ? allocations.slice(0, query.limit) : allocations;
  return { items, nextCursor: hasNextPage ? items[items.length - 1]?.id ?? null : null };
}

export async function countAllocationStatuses(
  prisma: PrismaService,
  prefixId: string,
): Promise<AllocationStatusCounts> {
  await findPrefix(prisma, prefixId);
  const groups = await prisma.allocation.groupBy({
    by: ['status'],
    where: { prefixId },
    _count: { _all: true },
  });
  const counts = emptyCounts();
  for (const group of groups) {
    if (isAllocationStatus(group.status)) counts[group.status] = group._count._all;
  }
  return counts;
}

function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function createHeatmapBuckets(cidr: string): AllocationHeatmapBucket[] {
  const parsed = parseCIDR(cidr);
  const totalCapacity = countIPsExact(cidr);
  const bucketCount = BigInt(ALLOCATION_HEATMAP_BUCKET_COUNT);
  return Array.from({ length: ALLOCATION_HEATMAP_BUCKET_COUNT }, (_, index) => {
    const startOffset = ceilDivide(BigInt(index) * totalCapacity, bucketCount);
    const endOffset = ceilDivide(BigInt(index + 1) * totalCapacity, bucketCount);
    const capacity = endOffset - startOffset;
    return {
      capacity: capacity.toString(),
      counts: emptyCounts(),
      endAddress: capacity === 0n ? null : formatIP(parsed.ip + endOffset - 1n, parsed.version),
      index,
      startAddress: capacity === 0n ? null : formatIP(parsed.ip + startOffset, parsed.version),
    };
  });
}

export async function buildAllocationHeatmap(
  prisma: PrismaService,
  prefixId: string,
): Promise<AllocationHeatmap> {
  const prefix = await findPrefix(prisma, prefixId);
  const parsed = parseCIDR(prefix.cidr);
  const totalCapacity = countIPsExact(prefix.cidr);
  const buckets = createHeatmapBuckets(prefix.cidr);
  let cursor: string | undefined;

  while (true) {
    const allocations = await prisma.allocation.findMany({
      where: { prefixId },
      select: { id: true, ipAddress: true, status: true },
      orderBy: [{ ipAddress: 'asc' }, { id: 'asc' }],
      take: HEATMAP_SCAN_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const allocation of allocations) {
      if (!isAllocationStatus(allocation.status)) continue;
      const offset = ipSortValue(allocation.ipAddress) - parsed.ip;
      if (offset < 0n || offset >= totalCapacity) continue;
      const bucketIndex = Number(
        (offset * BigInt(ALLOCATION_HEATMAP_BUCKET_COUNT)) / totalCapacity,
      );
      buckets[bucketIndex].counts[allocation.status] += 1;
    }
    if (allocations.length < HEATMAP_SCAN_BATCH_SIZE) break;
    cursor = allocations[allocations.length - 1]?.id;
    if (!cursor) break;
  }

  return {
    bucketCount: ALLOCATION_HEATMAP_BUCKET_COUNT,
    buckets,
    totalCapacity: totalCapacity.toString(),
  };
}
