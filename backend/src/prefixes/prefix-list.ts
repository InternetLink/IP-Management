import { BadRequestException } from '@nestjs/common';
import type { Prisma, Prefix } from '@prisma/client';

import type { PrismaService } from '../prisma/prisma.service';

export const DEFAULT_PREFIX_LIST_LIMIT = 50;
export const MAX_PREFIX_LIST_LIMIT = 100;

export type PrefixListQuery = {
  readonly cursor?: string;
  readonly limit?: number;
  readonly search?: string;
  readonly status?: string;
  readonly version?: 4 | 6;
};

export type PrefixPage = {
  readonly items: Prefix[];
  readonly nextCursor: string | null;
};

function invalidCursor(): BadRequestException {
  return new BadRequestException({
    code: 'INVALID_PREFIX_CURSOR',
    message: 'Prefix cursor does not belong to the current query',
  });
}

function normalizeQuery(query: PrefixListQuery) {
  const limit = query.limit ?? DEFAULT_PREFIX_LIST_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PREFIX_LIST_LIMIT) {
    throw new BadRequestException(`Prefix list limit must be between 1 and ${MAX_PREFIX_LIST_LIMIT}`);
  }
  if (query.version !== undefined && query.version !== 4 && query.version !== 6) {
    throw new BadRequestException('Prefix version must be 4 or 6');
  }

  const search = query.search?.trim();
  return {
    cursor: query.cursor?.trim() || undefined,
    limit,
    search: search || undefined,
    status: query.status && query.status !== 'all' ? query.status : undefined,
    version: query.version,
  };
}

function cursorMatchesQuery(prefix: Prefix, query: ReturnType<typeof normalizeQuery>): boolean {
  if (prefix.parentId !== null) return false;
  if (query.status && prefix.status !== query.status) return false;
  if (query.version && prefix.version !== query.version) return false;
  if (!query.search) return true;
  const search = query.search.toLowerCase();
  return [prefix.cidr, prefix.rir, prefix.assignedTo, prefix.description]
    .some(value => value?.toLowerCase().includes(search));
}

export async function findRootPrefixPage(
  prisma: PrismaService,
  rawQuery: PrefixListQuery = {},
): Promise<PrefixPage> {
  const query = normalizeQuery(rawQuery);
  if (query.cursor) {
    const cursorPrefix = await prisma.prefix.findUnique({ where: { id: query.cursor } });
    if (!cursorPrefix || !cursorMatchesQuery(cursorPrefix, query)) throw invalidCursor();
  }

  const where: Prisma.PrefixWhereInput = { parentId: null };
  if (query.status) where.status = query.status;
  if (query.version) where.version = query.version;
  if (query.search) {
    where.OR = [
      { cidr: { contains: query.search } },
      { rir: { contains: query.search } },
      { assignedTo: { contains: query.search } },
      { description: { contains: query.search } },
    ];
  }

  const prefixes = await prisma.prefix.findMany({
    where,
    include: { children: { select: { id: true } }, _count: { select: { children: true, allocations: true } } },
    orderBy: [{ cidr: 'asc' }, { id: 'asc' }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const hasNextPage = prefixes.length > query.limit;
  const items = hasNextPage ? prefixes.slice(0, query.limit) : prefixes;
  return { items, nextCursor: hasNextPage ? items[items.length - 1]?.id ?? null : null };
}
