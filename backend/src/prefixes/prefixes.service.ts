import { Injectable, ConflictException, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BulkUpdateAllocationsDto, CreatePrefixDto, UpdatePrefixDto, SplitPrefixDto, UpdateAllocationDto } from './prefixes.dto';
import { cidrContains, cidrOverlaps, countIPs, formatIP, parseCIDR } from '../lib/cidr';
import { dashboardCache } from '../dashboard/dashboard-cache';
import { withAddressSpaceLock } from './address-space-lock';
import { lockAllocations, orderedAllocationIds } from './allocation-lock';
import { exactCapacityFields, exactUsedCapacity, serializePrefixCapacity } from './prefix-capacity';
import { buildAllocationHeatmap, countAllocationStatuses, findAllocationPage, type AllocationListQuery } from './allocation-read';
import { findRootPrefixPage, type PrefixListQuery } from './prefix-list';

const MAX_SPLIT_CHILDREN = 1024;
const MAX_GENERATED_IPS = 1024;

type DashboardInvalidator = {
  invalidate(): void;
};

const PREFIX_TREE_INCLUDE = {
  _count: { select: { children: true, allocations: true } },
} as const satisfies Prisma.PrefixInclude;

type PrefixTreeRecord = Prisma.PrefixGetPayload<{ include: typeof PREFIX_TREE_INCLUDE }>;
type SerializedPrefixTreeRecord = ReturnType<typeof serializePrefixCapacity<PrefixTreeRecord>>;
type PrefixTreeNode = Omit<SerializedPrefixTreeRecord, 'children'> & {
  readonly children: PrefixTreeNode[];
};

const PREFIX_UPDATE_FIELDS = [
  'status',
  'rir',
  'vlan',
  'gateway',
  'assignedTo',
  'isPool',
  'description',
] as const satisfies readonly (keyof UpdatePrefixDto)[];

function isPrefixCidrUniqueError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }

  const target = error.meta?.target;
  if (Array.isArray(target)) return target.some((value) => value === 'cidr');
  if (typeof target === 'string') return target.includes('cidr');
  return error.message.toLowerCase().includes('cidr');
}

function allocationUpdateData(data: UpdateAllocationDto) {
  let expiryDate: Date | null | undefined;
  if (data.expiryDate !== undefined) {
    expiryDate = data.expiryDate ? new Date(data.expiryDate) : null;
    if (expiryDate && Number.isNaN(expiryDate.getTime())) {
      throw new BadRequestException('Invalid expiryDate');
    }
  }

  const updateData = {
    ...(data.status !== undefined && { status: data.status }),
    ...(data.assignee !== undefined && { assignee: data.assignee }),
    ...(data.purpose !== undefined && { purpose: data.purpose }),
    ...(data.notes !== undefined && { notes: data.notes }),
    ...(data.expiryDate !== undefined && { expiryDate }),
  };

  if (Object.keys(updateData).length === 0) {
    throw new BadRequestException('No allocation fields provided');
  }

  return updateData;
}

@Injectable()
export class PrefixesService {
  private readonly allocationDashboardCache: DashboardInvalidator;

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    @Optional() allocationDashboardCache?: DashboardInvalidator,
  ) {
    this.allocationDashboardCache = allocationDashboardCache ?? dashboardCache;
  }

  // List root prefixes (parentId == null) with optional children count
  async findRoots(query: PrefixListQuery = {}) {
    const page = await findRootPrefixPage(this.prisma, query);
    return { ...page, items: page.items.map(serializePrefixCapacity) };
  }

  // Get single prefix with direct children
  async findOne(id: string) {
    const prefix = await this.prisma.prefix.findUnique({
      where: { id },
      include: {
        children: {
          include: { _count: { select: { children: true, allocations: true } } },
          orderBy: { cidr: 'asc' },
        },
        parent: { select: { id: true, cidr: true } },
        _count: { select: { children: true, allocations: true } },
      },
    });
    if (!prefix) throw new NotFoundException('Prefix not found');
    return {
      ...serializePrefixCapacity(prefix),
      children: prefix.children.map(serializePrefixCapacity),
    };
  }

  // Get full tree for a prefix (BFS-batched by parentId; bounded by subtree size)
  async getTree(id: string) {
    const root = await this.prisma.prefix.findUnique({
      where: { id },
      include: PREFIX_TREE_INCLUDE,
    });
    if (!root) throw new NotFoundException('Prefix not found');

    const collected: PrefixTreeRecord[] = [];
    let frontier: string[] = [id];
    while (frontier.length) {
      const layer = await this.prisma.prefix.findMany({
        where: { parentId: { in: frontier } },
        include: PREFIX_TREE_INCLUDE,
        orderBy: { cidr: 'asc' },
      });
      collected.push(...layer);
      frontier = layer.map((p) => p.id);
    }

    const childrenByParent = new Map<string, PrefixTreeRecord[]>();
    for (const p of collected) {
      if (!p.parentId) continue;
      const arr = childrenByParent.get(p.parentId) ?? [];
      arr.push(p);
      childrenByParent.set(p.parentId, arr);
    }

    const build = (node: PrefixTreeRecord): PrefixTreeNode => ({
      ...serializePrefixCapacity(node),
      children: (childrenByParent.get(node.id) ?? []).map(build),
    });
    return build(root);
  }

  // Create a new prefix
  async create(dto: CreatePrefixDto) {
    const parsed = parseCIDR(dto.cidr);
    const cidr = parsed.cidr;
    if (dto.version && dto.version !== parsed.version) {
      throw new BadRequestException(`CIDR is IPv${parsed.version}, but version was IPv${dto.version}`);
    }

    const totalIPs = countIPs(cidr);
    const exactFields = exactCapacityFields(cidr);

    const prefix = await withAddressSpaceLock(
      this.prisma,
      {
        family: parsed.version,
        ...(dto.parentId ? { parentId: dto.parentId } : {}),
      },
      async (tx) => {
        const existing = await tx.prefix.findUnique({ where: { cidr } });
        if (existing) throw new ConflictException(`Prefix ${cidr} already exists`);

        let depth = 0;
        if (dto.parentId) {
          const parent = await tx.prefix.findUnique({ where: { id: dto.parentId } });
          if (!parent) throw new NotFoundException('Parent prefix not found');
          if (parent.isPool) {
            throw new BadRequestException(`Cannot create a child beneath pool prefix ${parent.cidr}`);
          }
          if (!cidrContains(parent.cidr, cidr)) {
            throw new BadRequestException(`${cidr} is not within parent ${parent.cidr}`);
          }
          depth = parent.depth + 1;

          const siblings = await tx.prefix.findMany({ where: { parentId: dto.parentId } });
          for (const sibling of siblings) {
            if (cidrOverlaps(sibling.cidr, cidr)) {
              throw new ConflictException(`${cidr} overlaps with sibling ${sibling.cidr}`);
            }
          }
        } else {
          const roots = await tx.prefix.findMany({ where: { parentId: null, version: parsed.version } });
          for (const root of roots) {
            if (cidrOverlaps(root.cidr, cidr)) {
              throw new ConflictException(`${cidr} overlaps with root prefix ${root.cidr}`);
            }
          }
        }

        const created = await tx.prefix.create({
          data: {
            cidr,
            version: parsed.version,
            parentId: dto.parentId || null,
            status: dto.status || 'Active',
            rir: dto.rir || null,
            vlan: dto.vlan ?? null,
            gateway: dto.gateway || null,
            assignedTo: dto.assignedTo || null,
            isPool: dto.isPool ?? false,
            depth,
            totalIPs,
            ...exactFields,
            description: dto.description || '',
          },
        }).catch((error: unknown) => {
          if (isPrefixCidrUniqueError(error)) {
            throw new ConflictException(`Prefix ${cidr} already exists`);
          }
          throw error;
        });
        await tx.auditLog.create({
          data: this.audit.buildEntry('Created', 'Prefix', created.id, created.cidr),
        });
        return serializePrefixCapacity(created);
      },
    );

    dashboardCache.invalidate();
    return serializePrefixCapacity(prefix);
  }

  // Update prefix metadata
  async update(id: string, dto: UpdatePrefixDto) {
    const existing = await this.prisma.prefix.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Prefix not found');

    const changes = PREFIX_UPDATE_FIELDS.flatMap((field) => {
      const after = dto[field];
      if (after === undefined || existing[field] === after) return [];
      return [{ field, before: String(existing[field] ?? ''), after: String(after) }];
    });

    const prefix = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.prefix.update({
        where: { id },
        data: {
          ...(dto.status !== undefined && { status: dto.status }),
          ...(dto.rir !== undefined && { rir: dto.rir }),
          ...(dto.vlan !== undefined && { vlan: dto.vlan }),
          ...(dto.gateway !== undefined && { gateway: dto.gateway }),
          ...(dto.assignedTo !== undefined && { assignedTo: dto.assignedTo }),
          ...(dto.isPool !== undefined && { isPool: dto.isPool }),
          ...(dto.description !== undefined && { description: dto.description }),
        },
      });

      if (changes.length > 0) {
        await tx.auditLog.create({
          data: this.audit.buildEntry('Updated', 'Prefix', updated.id, updated.cidr, changes),
        });
      }
      return updated;
    });

    dashboardCache.invalidate();
    return prefix;
  }

  // Delete a prefix (cascade deletes children)
  async remove(id: string) {
    const existing = await this.prisma.prefix.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Prefix not found');
    const family = parseCIDR(existing.cidr).version;

    await withAddressSpaceLock(
      this.prisma,
      { family, parentId: existing.parentId ?? id },
      async (tx) => {
        const maxCascadeSummaryCount = 1000;
        let frontier = [id];
        const descendantIds = [id];
        let descendantCount = 0;
        let capped = false;

        while (frontier.length > 0 && !capped) {
          const remaining = maxCascadeSummaryCount - descendantCount;
          const children = await tx.prefix.findMany({
            where: { parentId: { in: frontier } },
            select: { id: true },
            take: remaining + 1,
          });
          if (children.length > remaining) {
            descendantCount = maxCascadeSummaryCount;
            capped = true;
            break;
          }
          descendantCount += children.length;
          frontier = children.map((child) => child.id);
          descendantIds.push(...frontier);
        }

        const allocationCount = capped
          ? maxCascadeSummaryCount
          : Math.min(
            await tx.allocation.count({ where: { prefixId: { in: descendantIds } } }),
            maxCascadeSummaryCount,
          );
        const cascadeSummary = JSON.stringify({ descendantCount, allocationCount, capped });

        await tx.prefix.delete({ where: { id } });
        await tx.auditLog.create({
          data: this.audit.buildEntry('Deleted', 'Prefix', id, existing.cidr, [
            { field: 'cascadeSummary', before: '', after: cascadeSummary },
          ]),
        });
      },
    );

    dashboardCache.invalidate();
    return { deleted: true };
  }

  // Split a prefix into sub-prefixes of a given length
  async split(id: string, dto: SplitPrefixDto) {
    // The routing read selects the family-specific lock; the target is re-read inside that lock.
    const prefixHint = await this.prisma.prefix.findUnique({ where: { id }, select: { version: true } });
    const family = prefixHint?.version === 6 ? 6 : 4;

    const result = await withAddressSpaceLock(
      this.prisma,
      { family, parentId: id },
      async (tx) => {
        const prefix = await tx.prefix.findUnique({ where: { id } });
        if (!prefix) throw new NotFoundException('Prefix not found');

        const parsed = parseCIDR(prefix.cidr);
        if (prefix.isPool) {
          throw new BadRequestException(`Cannot split a pool prefix ${prefix.cidr}`);
        }
        if (dto.newPrefixLength <= parsed.prefixLen) {
          throw new BadRequestException(`New prefix length must be greater than ${parsed.prefixLen}`);
        }
        if (dto.newPrefixLength > parsed.bits) {
          throw new BadRequestException(`New prefix length must be between ${parsed.prefixLen + 1} and ${parsed.bits}`);
        }

        const subnetCountBig = 1n << BigInt(dto.newPrefixLength - parsed.prefixLen);
        if (subnetCountBig > BigInt(MAX_SPLIT_CHILDREN)) {
          throw new BadRequestException(`Split would create ${subnetCountBig.toString()} children; maximum is ${MAX_SPLIT_CHILDREN}`);
        }
        const subnetCount = Number(subnetCountBig);
        const subnetSize = 1n << BigInt(parsed.bits - dto.newPrefixLength);

        const existingChildren = await tx.prefix.findMany({ where: { parentId: id } });
        const existingByCidr = new Map(existingChildren.map((child) => [child.cidr, child]));

        const rows: Prisma.PrefixCreateManyInput[] = [];
        for (let i = 0; i < subnetCount; i++) {
          const subnetIP = parsed.ip + BigInt(i) * subnetSize;
          const cidr = `${formatIP(subnetIP, parsed.version)}/${dto.newPrefixLength}`;

          if (existingByCidr.has(cidr)) continue;
          for (const child of existingChildren) {
            if (child.cidr !== cidr && cidrOverlaps(child.cidr, cidr)) {
              throw new ConflictException(`${cidr} overlaps with existing child ${child.cidr}`);
            }
          }

          rows.push({
            cidr,
            version: parsed.version,
            parentId: id,
            status: 'Available',
            totalIPs: countIPs(cidr),
            ...exactCapacityFields(cidr),
            depth: prefix.depth + 1,
          });
        }

        const res = await tx.prefix.createMany({ data: rows, skipDuplicates: true });
        await tx.auditLog.create({
          data: this.audit.buildEntry(
            'Split',
            'Prefix',
            prefix.id,
            `${prefix.cidr} → /${dto.newPrefixLength} (${res.count} children)`,
          ),
        });
        return { parent: serializePrefixCapacity(prefix), created: res.count };
      },
    );

    dashboardCache.invalidate();
    return result;
  }

  // Generate individual IP allocations for a pool prefix (IPv4 only for now)
  async generateIPs(id: string) {
    // The routing read selects the family-specific lock; the target is re-read inside that lock.
    const prefixHint = await this.prisma.prefix.findUnique({ where: { id }, select: { version: true } });
    const family = prefixHint?.version === 6 ? 6 : 4;

    const result = await withAddressSpaceLock(
      this.prisma,
      { family, parentId: id },
      async (tx) => {
        const prefix = await tx.prefix.findUnique({ where: { id } });
        if (!prefix) throw new NotFoundException('Prefix not found');
        if (prefix.version !== 4) throw new BadRequestException('IP generation only supported for IPv4 prefixes');

        const childCount = await tx.prefix.count({ where: { parentId: id } });
        if (childCount > 0) {
          throw new BadRequestException('Cannot generate IP allocations for a prefix with children');
        }

        const parsed = parseCIDR(prefix.cidr);
        const count = Number(1n << (32n - BigInt(parsed.prefixLen)));
        if (count > MAX_GENERATED_IPS) {
          throw new BadRequestException('Prefix too large to generate individual IPs (max /22)');
        }

        const existing = await tx.allocation.findMany({ where: { prefixId: id } });
        const existingIPs = new Set(existing.map((allocation) => allocation.ipAddress));

        let generated = 0;
        const rows: Prisma.AllocationCreateManyInput[] = [];
        for (let i = 0; i < count; i++) {
          const ip = formatIP(parsed.ip + BigInt(i), 4);
          if (existingIPs.has(ip)) continue;

          const reserveNetworkEndpoints = parsed.prefixLen < 31;
          const isNetwork = reserveNetworkEndpoints && i === 0;
          const isBroadcast = reserveNetworkEndpoints && i === count - 1;

          rows.push({
            prefixId: id,
            ipAddress: ip,
            status: isNetwork || isBroadcast ? 'Reserved' : 'Available',
            assignee: isNetwork ? 'Network' : isBroadcast ? 'Broadcast' : '',
            purpose: isNetwork || isBroadcast ? 'Infrastructure' : 'Server',
            notes: isNetwork ? 'Network address' : isBroadcast ? 'Broadcast address' : null,
          });
          generated++;
        }

        if (rows.length > 0) {
          await tx.allocation.createMany({ data: rows, skipDuplicates: true });
        }
        await tx.prefix.update({ where: { id }, data: { isPool: true } });
        await tx.auditLog.create({
          data: this.audit.buildEntry('Generated', 'Prefix', id, `${prefix.cidr}: ${generated} IPs`),
        });
        return { generated, total: count };
      },
    );

    dashboardCache.invalidate();
    return result;
  }

  // Get allocations for a prefix (IP pool view)
  getAllocations(id: string, query: AllocationListQuery = {}) {
    return findAllocationPage(this.prisma, id, query);
  }

  getAllocationStatusCounts(id: string) {
    return countAllocationStatuses(this.prisma, id);
  }

  getAllocationHeatmap(id: string) {
    return buildAllocationHeatmap(this.prisma, id);
  }

  // Update a single IP allocation
  async updateAllocation(prefixId: string, allocationId: string, data: UpdateAllocationDto) {
    const updated = await this.prisma.$transaction(async (tx) => {
      await lockAllocations(tx, prefixId, [allocationId]);

      const alloc = await tx.allocation.findUnique({ where: { id: allocationId } });
      if (!alloc || alloc.prefixId !== prefixId) throw new NotFoundException('Allocation not found');

      const result = await tx.allocation.update({
        where: { id: allocationId },
        data: allocationUpdateData(data),
      });

      const allocCount = await tx.allocation.count({
        where: { prefixId, status: 'Allocated' },
      });
      await tx.prefix.update({
        where: { id: prefixId },
        data: { usedIPs: allocCount, usedIPsExact: exactUsedCapacity(allocCount) },
      });

      await tx.auditLog.create({
        data: this.audit.buildEntry('Updated', 'Allocation', allocationId, alloc.ipAddress),
      });
      return result;
    });

    this.allocationDashboardCache.invalidate();
    return updated;
  }

  async bulkUpdateAllocations(prefixId: string, data: BulkUpdateAllocationsDto) {
    const prefix = await this.prisma.prefix.findUnique({ where: { id: prefixId } });
    if (!prefix) throw new NotFoundException('Prefix not found');

    const allocationIds = orderedAllocationIds(data.allocationIds);

    const { allocationIds: _allocationIds, ...updatePayload } = data;
    const updateData = allocationUpdateData(updatePayload);

    const result = await this.prisma.$transaction(async (tx) => {
      await lockAllocations(tx, prefixId, allocationIds);

      const allocations = await tx.allocation.findMany({
        where: { prefixId, id: { in: allocationIds } },
      });
      if (allocations.length !== allocationIds.length) {
        throw new NotFoundException('Some allocations were not found in this prefix');
      }

      const res = await tx.allocation.updateMany({
        where: { prefixId, id: { in: allocationIds } },
        data: updateData,
      });

      const allocCount = await tx.allocation.count({
        where: { prefixId, status: 'Allocated' },
      });
      await tx.prefix.update({
        where: { id: prefixId },
        data: { usedIPs: allocCount, usedIPsExact: exactUsedCapacity(allocCount) },
      });

      await tx.auditLog.create({
        data: this.audit.buildEntry(
          'Updated',
          'Allocation',
          prefixId,
          `${prefix.cidr}: ${res.count} allocations bulk updated`,
        ),
      });
      return res;
    });

    this.allocationDashboardCache.invalidate();
    return { updated: result.count };
  }
}
