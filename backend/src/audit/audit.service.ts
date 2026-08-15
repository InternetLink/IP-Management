import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, type AuditLog } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getRequestCtx } from '../lib/request-context';
import { formatLogEvent } from '../lib/structured-log';
import type { AuditQueryDto } from './audit.dto';

type AuditChange = { field: string; before: string; after: string };
export const DEFAULT_AUDIT_LIST_LIMIT = 100;
export const MAX_AUDIT_LIST_LIMIT = 500;

type NormalizedAuditQuery = {
  readonly action?: string;
  readonly cursor?: string;
  readonly limit: number;
  readonly resourceType?: string;
  readonly search?: string;
};

function normalizeListQuery(query?: AuditQueryDto): NormalizedAuditQuery {
  const limit = query?.limit ?? DEFAULT_AUDIT_LIST_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_AUDIT_LIST_LIMIT) {
    throw new BadRequestException(`Audit list limit must be between 1 and ${MAX_AUDIT_LIST_LIMIT}`);
  }
  const search = query?.search?.trim();
  return {
    action: query?.action,
    cursor: query?.cursor?.trim() || undefined,
    limit,
    resourceType: query?.resourceType,
    search: search || undefined,
  };
}

function cursorMatchesQuery(entry: AuditLog, query: NormalizedAuditQuery): boolean {
  if (query.action && entry.action !== query.action) return false;
  if (query.resourceType && entry.resourceType !== query.resourceType) return false;
  if (!query.search) return true;
  const search = query.search.toLowerCase();
  return [entry.resourceLabel, entry.resourceType, entry.user]
    .some(value => value.toLowerCase().includes(search));
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Pure data builder for an audit row. Use inside a $transaction:
   *   await tx.auditLog.create({ data: audit.buildEntry(...) });
   */
  buildEntry(
    action: string,
    resourceType: string,
    resourceId: string,
    resourceLabel: string,
    changes?: AuditChange[],
  ): Prisma.AuditLogUncheckedCreateInput {
    const ctx = getRequestCtx();
    return {
      action,
      resourceType,
      resourceId,
      resourceLabel,
      changes: changes ?? undefined,
      user: ctx.username ?? 'system',
      userId: ctx.userId ?? null,
    };
  }

  /**
   * Fire-and-forget audit log writer. Errors are logged but do not propagate
   * so a slow/failed audit insert cannot poison the originating request.
   * For mutations that need atomicity with the audit row, use buildEntry inside
   * a Prisma.$transaction instead.
   */
  log(
    action: string,
    resourceType: string,
    resourceId: string,
    resourceLabel: string,
    changes?: AuditChange[],
  ): void {
    const data = this.buildEntry(action, resourceType, resourceId, resourceLabel, changes);
    this.prisma.auditLog
      .create({ data })
      .catch((error: unknown) => {
        this.logger.error(formatLogEvent('audit.write.failed', {
          action,
          errorName: error instanceof Error ? error.name : 'UnknownError',
          resourceId,
          resourceType,
        }));
      });
  }

  async findAll(query?: AuditQueryDto) {
    const normalized = normalizeListQuery(query);
    const where: Prisma.AuditLogWhereInput = {};
    if (normalized.action) where.action = normalized.action;
    if (normalized.resourceType) where.resourceType = normalized.resourceType;
    if (normalized.search) {
      // audit_logs uses utf8mb4_unicode_ci, so MySQL collation supplies case-insensitive matching.
      where.OR = [
        { resourceLabel: { contains: normalized.search } },
        { resourceType: { contains: normalized.search } },
        { user: { contains: normalized.search } },
      ];
    }

    if (normalized.cursor) {
      const cursorEntry = await this.prisma.auditLog.findUnique({ where: { id: normalized.cursor } });
      if (!cursorEntry || !cursorMatchesQuery(cursorEntry, normalized)) {
        throw new BadRequestException({
          code: 'INVALID_AUDIT_CURSOR',
          message: 'Audit cursor does not belong to the current query',
        });
      }
    }

    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      take: normalized.limit + 1,
      ...(normalized.cursor ? { cursor: { id: normalized.cursor }, skip: 1 } : {}),
    });
    const hasNextPage = rows.length > normalized.limit;
    const items = hasNextPage ? rows.slice(0, normalized.limit) : rows;
    return { items, nextCursor: hasNextPage ? items[items.length - 1]?.id ?? null : null };
  }
}
