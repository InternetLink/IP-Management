import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BulkUpdateAllocationsDto, CreatePrefixDto, UpdatePrefixDto, SplitPrefixDto, UpdateAllocationDto } from './prefixes.dto';
import { cidrContains, cidrOverlaps, countIPv4, formatIP, ipSortValue, parseCIDR } from '../lib/cidr';

const MAX_SPLIT_CHILDREN = 1024;
const MAX_GENERATED_IPS = 1024;

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
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  // List root prefixes (parentId == null) with optional children count
  async findRoots() {
    return this.prisma.prefix.findMany({
      where: { parentId: null },
      include: { children: { select: { id: true } }, _count: { select: { children: true, allocations: true } } },
      orderBy: { cidr: 'asc' },
    });
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
    return prefix;
  }

  // Get full tree for a prefix (recursive)
  async getTree(id: string) {
    const root = await this.prisma.prefix.findUnique({ where: { id } });
    if (!root) throw new NotFoundException('Prefix not found');

    const allPrefixes = await this.prisma.prefix.findMany({
      orderBy: { cidr: 'asc' },
      include: { _count: { select: { children: true, allocations: true } } },
    });

    // Build tree from root
    const buildTree = (parentId: string | null): any[] => {
      return allPrefixes
        .filter(p => p.parentId === parentId)
        .map(p => ({ ...p, children: buildTree(p.id) }));
    };

    const rootNode = allPrefixes.find(p => p.id === id);
    return { ...rootNode, children: buildTree(id) };
  }

  // Create a new prefix
  async create(dto: CreatePrefixDto) {
    const parsed = parseCIDR(dto.cidr);
    const cidr = parsed.cidr;
    if (dto.version && dto.version !== parsed.version) {
      throw new BadRequestException(`CIDR is IPv${parsed.version}, but version was IPv${dto.version}`);
    }

    // Check uniqueness
    const existing = await this.prisma.prefix.findUnique({ where: { cidr } });
    if (existing) throw new ConflictException(`Prefix ${cidr} already exists`);

    // If has parent, validate containment
    let depth = 0;
    if (dto.parentId) {
      const parent = await this.prisma.prefix.findUnique({ where: { id: dto.parentId } });
      if (!parent) throw new NotFoundException('Parent prefix not found');
      if (!cidrContains(parent.cidr, cidr)) {
        throw new BadRequestException(`${cidr} is not within parent ${parent.cidr}`);
      }
      depth = parent.depth + 1;

      // Check overlap with siblings
      const siblings = await this.prisma.prefix.findMany({ where: { parentId: dto.parentId } });
      for (const sib of siblings) {
        if (cidrOverlaps(sib.cidr, cidr)) {
          throw new ConflictException(`${cidr} overlaps with sibling ${sib.cidr}`);
        }
      }
    } else {
      const roots = await this.prisma.prefix.findMany({ where: { parentId: null, version: parsed.version } });
      for (const root of roots) {
        if (cidrOverlaps(root.cidr, cidr)) {
          throw new ConflictException(`${cidr} overlaps with root prefix ${root.cidr}`);
        }
      }
    }

    const totalIPs = countIPv4(cidr);

    const prefix = await this.prisma.prefix.create({
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
        totalIPs: totalIPs,
        description: dto.description || '',
      },
    });

    await this.audit.log('Created', 'Prefix', prefix.id, prefix.cidr);
    return prefix;
  }

  // Update prefix metadata
  async update(id: string, dto: UpdatePrefixDto) {
    const existing = await this.prisma.prefix.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Prefix not found');

    const changes = Object.entries(dto)
      .filter(([k, v]) => v !== undefined && (existing as any)[k] !== v)
      .map(([field, after]) => ({ field, before: String((existing as any)[field] ?? ''), after: String(after) }));

    const prefix = await this.prisma.prefix.update({
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

    if (changes.length > 0) await this.audit.log('Updated', 'Prefix', prefix.id, prefix.cidr, changes);
    return prefix;
  }

  // Delete a prefix (cascade deletes children)
  async remove(id: string) {
    const existing = await this.prisma.prefix.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Prefix not found');
    await this.prisma.prefix.delete({ where: { id } });
    await this.audit.log('Deleted', 'Prefix', id, existing.cidr);
    return { deleted: true };
  }

  // Split a prefix into sub-prefixes of a given length
  async split(id: string, dto: SplitPrefixDto) {
    const prefix = await this.prisma.prefix.findUnique({ where: { id } });
    if (!prefix) throw new NotFoundException('Prefix not found');

    const parsed = parseCIDR(prefix.cidr);
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

    // Check for existing children that might conflict
    const existingChildren = await this.prisma.prefix.findMany({ where: { parentId: id } });

    const created: any[] = [];
    for (let i = 0; i < subnetCount; i++) {
      const subnetIP = parsed.ip + BigInt(i) * subnetSize;
      const cidr = `${formatIP(subnetIP, parsed.version)}/${dto.newPrefixLength}`;

      const overlappingChild = existingChildren.find(c => cidrOverlaps(c.cidr, cidr));
      if (overlappingChild) {
        if (overlappingChild.cidr === cidr) continue;
        throw new ConflictException(`${cidr} overlaps with existing child ${overlappingChild.cidr}`);
      }
      const exists = await this.prisma.prefix.findUnique({ where: { cidr } });
      if (exists) continue;

      const totalIPs = parsed.version === 4 ? Math.pow(2, 32 - dto.newPrefixLength) : -1;

      const child = await this.prisma.prefix.create({
        data: {
          cidr,
          version: parsed.version,
          parentId: id,
          status: 'Available',
          totalIPs,
          depth: prefix.depth + 1,
        },
      });
      created.push(child);
    }

    await this.audit.log('Split', 'Prefix', prefix.id, `${prefix.cidr} → /${dto.newPrefixLength} (${created.length} children)`);
    return { parent: prefix, created };
  }

  // Generate individual IP allocations for a pool prefix (IPv4 only for now)
  async generateIPs(id: string) {
    const prefix = await this.prisma.prefix.findUnique({ where: { id } });
    if (!prefix) throw new NotFoundException('Prefix not found');
    if (prefix.version !== 4) throw new BadRequestException('IP generation only supported for IPv4 prefixes');

    const parsed = parseCIDR(prefix.cidr);
    const count = Number(1n << (32n - BigInt(parsed.prefixLen)));
    if (count > MAX_GENERATED_IPS) throw new BadRequestException('Prefix too large to generate individual IPs (max /22)');

    // Generate all IPs in the range
    const existing = await this.prisma.allocation.findMany({ where: { prefixId: id } });
    const existingIPs = new Set(existing.map(a => a.ipAddress));

    let generated = 0;
    const rows: any[] = [];
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
    if (rows.length > 0) await this.prisma.allocation.createMany({ data: rows, skipDuplicates: true });

    // Mark prefix as pool and update counts
    await this.prisma.prefix.update({
      where: { id },
      data: { isPool: true },
    });

    await this.audit.log('Generated', 'Prefix', id, `${prefix.cidr}: ${generated} IPs`);
    return { generated, total: count };
  }

  // Get allocations for a prefix (IP pool view)
  async getAllocations(id: string, status?: string) {
    const prefix = await this.prisma.prefix.findUnique({ where: { id } });
    if (!prefix) throw new NotFoundException('Prefix not found');

    const where: any = { prefixId: id };
    if (status && status !== 'all') where.status = status;

    const allocations = await this.prisma.allocation.findMany({
      where,
    });
    return allocations.sort((a, b) => {
      const av = ipSortValue(a.ipAddress);
      const bv = ipSortValue(b.ipAddress);
      return av < bv ? -1 : av > bv ? 1 : 0;
    });
  }

  // Update a single IP allocation
  async updateAllocation(prefixId: string, allocationId: string, data: UpdateAllocationDto) {
    const alloc = await this.prisma.allocation.findUnique({ where: { id: allocationId } });
    if (!alloc || alloc.prefixId !== prefixId) throw new NotFoundException('Allocation not found');

    const updated = await this.prisma.allocation.update({
      where: { id: allocationId },
      data: allocationUpdateData(data),
    });

    // Recalculate parent usedIPs
    const allocCount = await this.prisma.allocation.count({
      where: { prefixId, status: 'Allocated' },
    });
    await this.prisma.prefix.update({
      where: { id: prefixId },
      data: { usedIPs: allocCount },
    });

    await this.audit.log('Updated', 'Allocation', allocationId, alloc.ipAddress);
    return updated;
  }

  async bulkUpdateAllocations(prefixId: string, data: BulkUpdateAllocationsDto) {
    const prefix = await this.prisma.prefix.findUnique({ where: { id: prefixId } });
    if (!prefix) throw new NotFoundException('Prefix not found');

    const allocationIds = Array.from(new Set(data.allocationIds));
    const allocations = await this.prisma.allocation.findMany({
      where: { prefixId, id: { in: allocationIds } },
    });
    if (allocations.length !== allocationIds.length) {
      throw new NotFoundException('Some allocations were not found in this prefix');
    }

    const { allocationIds: _allocationIds, ...updatePayload } = data;
    const updateData = allocationUpdateData(updatePayload);
    const result = await this.prisma.allocation.updateMany({
      where: { prefixId, id: { in: allocationIds } },
      data: updateData,
    });

    const allocCount = await this.prisma.allocation.count({
      where: { prefixId, status: 'Allocated' },
    });
    await this.prisma.prefix.update({
      where: { id: prefixId },
      data: { usedIPs: allocCount },
    });

    await this.audit.log('Updated', 'Allocation', prefixId, `${prefix.cidr}: ${result.count} allocations bulk updated`);
    return { updated: result.count };
  }
}
