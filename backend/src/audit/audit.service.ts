import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(action: string, resourceType: string, resourceId: string, resourceLabel: string, changes?: any[], user = 'admin') {
    return this.prisma.auditLog.create({
      data: { action, resourceType, resourceId, resourceLabel, changes: changes ?? undefined, user },
    });
  }

  async findAll(query?: { action?: string; resourceType?: string; search?: string; limit?: number }) {
    const where: any = {};
    if (query?.action) where.action = query.action;
    if (query?.resourceType) where.resourceType = query.resourceType;
    if (query?.search) {
      where.OR = [
        { resourceLabel: { contains: query.search, mode: 'insensitive' } },
        { resourceType: { contains: query.search, mode: 'insensitive' } },
        { user: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.auditLog.findMany({
      where, orderBy: { timestamp: 'desc' }, take: query?.limit ?? 100,
    });
  }
}
