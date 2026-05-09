import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getStats() {
    const [prefixes, allocations, geofeed, recentAudit] = await Promise.all([
      this.prisma.prefix.findMany(),
      this.prisma.allocation.findMany(),
      this.prisma.geofeedEntry.findMany(),
      this.prisma.auditLog.findMany({ orderBy: { timestamp: 'desc' }, take: 10 }),
    ]);

    const rootPrefixes = prefixes.filter(p => !p.parentId);
    const ipv4Roots = rootPrefixes.filter(p => p.version === 4);
    const ipv6Roots = rootPrefixes.filter(p => p.version === 6);
    const totalIPv4 = ipv4Roots.reduce((sum, p) => sum + (p.totalIPs > 0 ? p.totalIPs : 0), 0);
    const usedIPv4 = ipv4Roots.reduce((sum, p) => sum + (p.usedIPs > 0 ? p.usedIPs : 0), 0);

    // RIR distribution from root prefixes
    const rirMap = new Map<string, number>();
    for (const p of ipv4Roots) {
      if (p.rir) rirMap.set(p.rir, (rirMap.get(p.rir) ?? 0) + (p.totalIPs > 0 ? p.totalIPs : 0));
    }
    const rirDistribution = Array.from(rirMap.entries()).map(([name, value]) => ({ name, value }));

    // Status counts
    const prefixStatusCounts: Record<string, number> = {};
    for (const p of prefixes) prefixStatusCounts[p.status] = (prefixStatusCounts[p.status] ?? 0) + 1;

    // Geofeed stats
    const geofeedValid = geofeed.filter(g => g.validation === 'valid').length;
    const geofeedWarnings = geofeed.filter(g => g.validation === 'warning').length;

    // Allocation stats
    const allocAvailable = allocations.filter(a => a.status === 'Available').length;
    const allocAllocated = allocations.filter(a => a.status === 'Allocated').length;
    const allocReserved = allocations.filter(a => a.status === 'Reserved').length;

    // Trend from audit log (last 12 months)
    const now = new Date();
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const trendMap = new Map<string, {ipv4: number; ipv6: number}>();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      trendMap.set(monthNames[d.getMonth()], { ipv4: 0, ipv6: 0 });
    }
    const allAudit = await this.prisma.auditLog.findMany({
      where: { timestamp: { gte: new Date(now.getFullYear(), now.getMonth() - 11, 1) } },
      orderBy: { timestamp: 'asc' },
    });
    for (const log of allAudit) {
      const month = monthNames[new Date(log.timestamp).getMonth()];
      const entry = trendMap.get(month);
      if (!entry) continue;
      const isV6 = log.resourceLabel?.includes(':') ?? false;
      if (isV6) entry.ipv6++;
      else entry.ipv4++;
    }
    const allocationTrend = Array.from(trendMap.entries()).map(([month, counts]) => ({ month, ...counts }));

    return {
      totalIPv4,
      usedIPv4,
      utilizationRate: totalIPv4 > 0 ? usedIPv4 / totalIPv4 : 0,
      ipv6Prefixes: ipv6Roots.length,
      totalPrefixes: prefixes.length,
      rootPrefixes: rootPrefixes.length,
      totalAllocations: allocations.length,
      totalGeofeed: geofeed.length,
      prefixStatusCounts,
      rirDistribution,
      geofeedValid,
      geofeedWarnings,
      allocAvailable,
      allocAllocated,
      allocReserved,
      recentAudit,
      allocationTrend,
    };
  }
}
