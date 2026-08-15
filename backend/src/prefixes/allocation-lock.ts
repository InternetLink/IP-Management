import { Prisma } from '@prisma/client';

function compareAllocationIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function orderedAllocationIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort(compareAllocationIds);
}

export async function lockAllocations(
  tx: Prisma.TransactionClient,
  prefixId: string,
  allocationIds: readonly string[],
): Promise<void> {
  const orderedIds = orderedAllocationIds(allocationIds);
  if (orderedIds.length === 0) return;

  await tx.$queryRaw`
    SELECT \`id\`
    FROM \`allocations\`
    WHERE \`prefixId\` = ${prefixId}
      AND \`id\` IN (${Prisma.join(orderedIds)})
    ORDER BY \`id\` ASC
    FOR UPDATE
  `;
}
