import { PrismaClient } from '@prisma/client';

export type OwnershipViolationKind = 'pool-with-children' | 'allocations-with-children';

export type OwnershipViolation = {
  readonly kind: OwnershipViolationKind;
  readonly prefixId: string;
  readonly cidr: string;
  readonly childCount: number;
  readonly allocationCount: number;
};

export async function findOwnershipViolations(
  prisma: PrismaClient,
): Promise<readonly OwnershipViolation[]> {
  const prefixes = await prisma.prefix.findMany({
    select: {
      id: true,
      cidr: true,
      isPool: true,
      _count: { select: { children: true, allocations: true } },
    },
    orderBy: [{ cidr: 'asc' }, { id: 'asc' }],
  });

  return prefixes.flatMap((prefix) => {
    const { children: childCount, allocations: allocationCount } = prefix._count;
    const violations: OwnershipViolation[] = [];

    if (prefix.isPool && childCount > 0) {
      violations.push({
        kind: 'pool-with-children',
        prefixId: prefix.id,
        cidr: prefix.cidr,
        childCount,
        allocationCount,
      });
    }

    if (childCount > 0 && allocationCount > 0) {
      violations.push({
        kind: 'allocations-with-children',
        prefixId: prefix.id,
        cidr: prefix.cidr,
        childCount,
        allocationCount,
      });
    }

    return violations;
  });
}

export function formatOwnershipReport(violations: readonly OwnershipViolation[]): string {
  if (violations.length === 0) return 'No prefix ownership violations found.\n';

  const lines = [
    'Prefix ownership preflight found violations. Migration/deploy must stop until each row is reviewed:',
    ...violations.map((violation) => (
      `${violation.kind}: Prefix ID ${violation.prefixId}, CIDR ${violation.cidr}, `
      + `children=${violation.childCount}, allocations=${violation.allocationCount}`
    )),
  ];
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const violations = await findOwnershipViolations(prisma);
    process.stdout.write(formatOwnershipReport(violations));
    if (violations.length > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
