import { ConflictException, HttpStatus } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';

export const ADDRESS_SPACE_BUSY_CODE = 'ADDRESS_SPACE_BUSY' as const;
export const ADDRESS_SPACE_LOCK_MAX_ATTEMPTS = 3;

const ROOT_LOCK_KEYS = {
  4: 'root:v4',
  6: 'root:v6',
} as const;

const RETRYABLE_TRANSACTION_CODES = new Set([
  'P2034',
  '1205',
  '1213',
  '40001',
]);

export type AddressFamily = keyof typeof ROOT_LOCK_KEYS;

export type AddressSpaceLockScope = {
  readonly family: AddressFamily;
  readonly parentId?: string;
};

type AddressSpaceLockRow = {
  readonly key: string;
};

type AddressSpaceOperation<T> = (tx: Prisma.TransactionClient) => Promise<T>;

export type HeldAddressSpaceRootLock = {
  readonly key: (typeof ROOT_LOCK_KEYS)[AddressFamily];
  readonly acquireParent: (parentId: string) => Promise<void>;
};

export class AddressSpaceBusyException extends ConflictException {
  readonly name = 'AddressSpaceBusyException';

  constructor() {
    super({
      statusCode: HttpStatus.CONFLICT,
      error: 'Conflict',
      message: 'Address space is busy; retry the request',
      code: ADDRESS_SPACE_BUSY_CODE,
    });
  }
}

export class AddressSpaceLockMissingError extends Error {
  readonly name = 'AddressSpaceLockMissingError';

  constructor(readonly key: string) {
    super(`Address-space lock row ${key} is missing`);
  }
}

function property(value: unknown, name: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  return Reflect.get(value, name);
}

function code(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).toUpperCase();
  }
  return undefined;
}

function hasRetryableCode(value: unknown): boolean {
  return ['code', 'errno', 'sqlState', 'sqlstate']
    .map((name) => code(property(value, name)))
    .some((candidate) => candidate !== undefined && RETRYABLE_TRANSACTION_CODES.has(candidate));
}

function isRetryableTransactionError(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  if (hasRetryableCode(error)) return true;

  const meta = property(error, 'meta');
  if (hasRetryableCode(meta)) return true;

  const cause = property(error, 'cause');
  if (hasRetryableCode(cause) || hasRetryableCode(property(cause, 'cause'))) return true;

  return error.message.includes('Transaction failed due to a write conflict or a deadlock');
}

async function lockRow(tx: Prisma.TransactionClient, key: string): Promise<void> {
  const rows = await tx.$queryRaw<AddressSpaceLockRow[]>`
    SELECT \`key\`
    FROM \`address_space_locks\`
    WHERE \`key\` = ${key}
    FOR UPDATE
  `;

  if (rows.length !== 1 || rows[0]?.key !== key) {
    throw new AddressSpaceLockMissingError(key);
  }
}

export async function acquireAddressSpaceRootLock(
  tx: Prisma.TransactionClient,
  family: AddressFamily,
): Promise<HeldAddressSpaceRootLock> {
  const key = ROOT_LOCK_KEYS[family];
  await lockRow(tx, key);

  return Object.freeze({
    key,
    acquireParent: async (parentId: string): Promise<void> => {
      const parentKey = `parent:${parentId}`;
      await tx.addressSpaceLock.upsert({
        where: { key: parentKey },
        create: { key: parentKey },
        update: {},
      });
      await lockRow(tx, parentKey);
    },
  });
}

export async function retryAddressSpaceTransaction<T>(
  operation: () => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryableTransactionError(error)) throw error;
      if (attempt >= ADDRESS_SPACE_LOCK_MAX_ATTEMPTS) {
        throw new AddressSpaceBusyException();
      }
    }
  }
}

export async function withAddressSpaceLock<T>(
  prisma: PrismaClient,
  scope: AddressSpaceLockScope,
  operation: AddressSpaceOperation<T>,
): Promise<T> {
  return retryAddressSpaceTransaction(() => prisma.$transaction(async (tx) => {
    const rootLock = await acquireAddressSpaceRootLock(tx, scope.family);
    if (scope.parentId !== undefined) {
      await rootLock.acquireParent(scope.parentId);
    }
    return operation(tx);
  }));
}
