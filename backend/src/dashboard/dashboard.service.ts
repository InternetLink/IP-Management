import { Injectable, Optional } from '@nestjs/common';
import { Prisma, type AuditLog } from '@prisma/client';

import { parseCIDR } from '../lib/cidr';
import { serializePrefixCapacity } from '../prefixes/prefix-capacity';
import { PrismaService } from '../prisma/prisma.service';
import { DashboardCache, dashboardCache } from './dashboard-cache';

const ALLOCATION_COUNT_BATCH_SIZE = 1_000;

type TrendEntry = {
  month: string;
  ipv4: number;
  ipv6: number;
};

type RootCapacity = {
  readonly cidr: string;
  readonly rir: string | null;
  readonly totalIPs: number;
  readonly totalIPsExact: Prisma.Decimal | null;
};

export type DashboardStats = {
  readonly totalCapacity: string;
  readonly usedCapacity: string;
  readonly utilizationBasisPoints: number;
  readonly totalIPv4: number;
  readonly usedIPv4: number;
  readonly utilizationRate: number;
  readonly ipv6Prefixes: number;
  readonly totalPrefixes: number;
  readonly rootPrefixes: number;
  readonly totalAllocations: number;
  readonly totalGeofeed: number;
  readonly prefixStatusCounts: Record<string, number>;
  readonly rirDistribution: Array<{ readonly name: string; readonly value: number }>;
  readonly geofeedValid: number;
  readonly geofeedWarnings: number;
  readonly allocAvailable: number;
  readonly allocAllocated: number;
  readonly allocReserved: number;
  readonly recentAudit: AuditLog[];
  readonly allocationTrend: TrendEntry[];
};

export function calculateUtilizationBasisPoints(usedCapacity: bigint, totalCapacity: bigint): number {
  if (usedCapacity <= 0n || totalCapacity <= 0n) return 0;

  const rounded = (usedCapacity * 10_000n + totalCapacity / 2n) / totalCapacity;
  if (rounded >= 10_000n) return 10_000;
  return Number(rounded);
}

function exactRootCapacity(root: RootCapacity): bigint {
  const serialized = serializePrefixCapacity({
    ...root,
    usedIPs: 0,
    usedIPsExact: null,
  });
  return BigInt(serialized.totalIPsExact);
}

function countResult(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  throw new Error('Allocation count is not a non-negative exact integer');
}

@Injectable()
export class DashboardService {
  private readonly cache: DashboardCache<DashboardStats>;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() cache?: DashboardCache<DashboardStats>,
  ) {
    this.cache = cache ?? dashboardCache;
  }

  invalidate(): void {
    this.cache.invalidate();
  }

  async getStats(): Promise<DashboardStats> {
    const cached = this.cache.getFresh();
    if (cached) return cached.value;

    const cacheVersion = this.cache.version();
    const now = new Date();
    const result = await this.prisma.$transaction(
      (tx) => this.aggregateStats(tx, now),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 30_000,
      },
    );

    this.cache.setValue(result, cacheVersion);
    return result;
  }

  private async aggregateStats(tx: Prisma.TransactionClient, now: Date): Promise<DashboardStats> {
    const ipv4Roots = await tx.prefix.findMany({
      where: { parentId: null, version: 4 },
      select: { id: true, cidr: true, rir: true, totalIPs: true, totalIPsExact: true },
      orderBy: { id: 'asc' },
    });
    const subtreeIds = await this.collectSubtreeIds(tx, ipv4Roots.map((root) => root.id));
    const usedCapacity = await this.countAllocatedRows(tx, subtreeIds);
    const totalCapacity = ipv4Roots.reduce((sum, root) => sum + exactRootCapacity(root), 0n);

    const [
      prefixStatusGroups,
      allocStatusGroups,
      geofeedValidationGroups,
      ipv6RootCount,
      prefixTotal,
      rootTotal,
      allocTotal,
      geofeedTotal,
      recentAudit,
      allocationTrend,
    ] = await Promise.all([
      tx.prefix.groupBy({ by: ['status'], _count: { _all: true } }),
      tx.allocation.groupBy({ by: ['status'], _count: { _all: true } }),
      tx.geofeedEntry.groupBy({ by: ['validation'], _count: { _all: true } }),
      tx.prefix.count({ where: { parentId: null, version: 6 } }),
      tx.prefix.count(),
      tx.prefix.count({ where: { parentId: null } }),
      tx.allocation.count(),
      tx.geofeedEntry.count(),
      tx.auditLog.findMany({ orderBy: { timestamp: 'desc' }, take: 10 }),
      this.computeTrend(tx, now),
    ]);

    const utilizationBasisPoints = calculateUtilizationBasisPoints(usedCapacity, totalCapacity);
    return {
      totalCapacity: totalCapacity.toString(),
      usedCapacity: usedCapacity.toString(),
      utilizationBasisPoints,
      totalIPv4: Number(totalCapacity),
      usedIPv4: Number(usedCapacity),
      utilizationRate: utilizationBasisPoints / 10_000,
      ipv6Prefixes: ipv6RootCount,
      totalPrefixes: prefixTotal,
      rootPrefixes: rootTotal,
      totalAllocations: allocTotal,
      totalGeofeed: geofeedTotal,
      prefixStatusCounts: Object.fromEntries(prefixStatusGroups.map((group) => [group.status, group._count._all])),
      rirDistribution: this.rirDistribution(ipv4Roots),
      geofeedValid: geofeedValidationGroups.find((group) => group.validation === 'valid')?._count._all ?? 0,
      geofeedWarnings: geofeedValidationGroups.find((group) => group.validation === 'warning')?._count._all ?? 0,
      allocAvailable: allocStatusGroups.find((group) => group.status === 'Available')?._count._all ?? 0,
      allocAllocated: allocStatusGroups.find((group) => group.status === 'Allocated')?._count._all ?? 0,
      allocReserved: allocStatusGroups.find((group) => group.status === 'Reserved')?._count._all ?? 0,
      recentAudit,
      allocationTrend,
    };
  }

  private async collectSubtreeIds(tx: Prisma.TransactionClient, rootIds: string[]): Promise<string[]> {
    const collected = [...rootIds];
    let frontier = rootIds;

    while (frontier.length > 0) {
      const children = await tx.prefix.findMany({
        where: { parentId: { in: frontier } },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      frontier = children.map((child) => child.id);
      collected.push(...frontier);
    }

    return collected;
  }

  private async countAllocatedRows(tx: Prisma.TransactionClient, prefixIds: string[]): Promise<bigint> {
    let total = 0n;

    for (let offset = 0; offset < prefixIds.length; offset += ALLOCATION_COUNT_BATCH_SIZE) {
      const batch = prefixIds.slice(offset, offset + ALLOCATION_COUNT_BATCH_SIZE);
      const result = await tx.$queryRaw`
        SELECT CAST(COUNT(*) AS CHAR) AS usedCapacity
        FROM allocations
        WHERE status = ${'Allocated'}
          AND prefixId IN (${Prisma.join(batch)})
      `;
      const rows = result as Array<{ readonly usedCapacity: unknown }>;
      total += countResult(rows[0]?.usedCapacity);
    }

    return total;
  }

  private rirDistribution(roots: RootCapacity[]): Array<{ name: string; value: number }> {
    const capacityByRir = new Map<string, bigint>();
    for (const root of roots) {
      if (root.rir === null) continue;
      capacityByRir.set(root.rir, (capacityByRir.get(root.rir) ?? 0n) + exactRootCapacity(root));
    }

    return [...capacityByRir.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => ({ name, value: Number(value) }));
  }

  private async computeTrend(tx: Prisma.TransactionClient, now: Date): Promise<TrendEntry[]> {
    const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    type TrendBucket = TrendEntry & { readonly key: string };
    const buckets: TrendBucket[] = [];
    const startMonth = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      buckets.push({ key, month: monthLabels[d.getMonth()], ipv4: 0, ipv6: 0 });
    }
    const byKey = new Map(buckets.map((b) => [b.key, b]));

    const logs = await tx.auditLog.findMany({
      where: {
        action: 'Created',
        resourceType: 'Prefix',
        timestamp: { gte: startMonth },
      },
      orderBy: { timestamp: 'asc' },
      select: { timestamp: true, resourceLabel: true },
    });

    for (const log of logs) {
      const d = new Date(log.timestamp);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const entry = byKey.get(key);
      if (!entry) continue;
      if (log.resourceLabel === null) continue;

      try {
        const version = parseCIDR(log.resourceLabel).version;
        if (version === 6) entry.ipv6 += 1;
        else entry.ipv4 += 1;
      } catch {
        continue;
      }
    }

    return buckets.map(({ month, ipv4, ipv6 }) => ({ month, ipv4, ipv6 }));
  }
}
