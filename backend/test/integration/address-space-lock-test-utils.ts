import type { PrismaClient } from '@prisma/client';

const HANG_GUARD_MS = 15_000;

export type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
};

export type LockWaitDialect = 'mariadb' | 'mysql';

type VersionRow = {
  readonly version: string;
};

type LockWaitCountRow = {
  readonly waitCount: bigint;
};

export class LockTestInvariantError extends Error {
  readonly name = 'LockTestInvariantError';
}

export class LockTestTimeoutError extends Error {
  readonly name = 'LockTestTimeoutError';
}

function assertNever(value: never): never {
  throw new LockTestInvariantError(`Unsupported lock-wait dialect: ${String(value)}`);
}

export function createDeferred<T>(): Deferred<T> {
  let resolveValue: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve;
  });

  return {
    promise,
    resolve: (value: T): void => {
      if (resolveValue === undefined) {
        throw new LockTestInvariantError('Deferred resolver was not initialized');
      }
      resolveValue(value);
    },
  };
}

export async function waitWithHangGuard<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new LockTestTimeoutError(`${label} exceeded ${HANG_GUARD_MS}ms hang guard`));
    }, HANG_GUARD_MS);
  });

  try {
    return await Promise.race([promise, guard]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function detectLockWaitDialect(prisma: PrismaClient): Promise<LockWaitDialect> {
  const rows = await prisma.$queryRaw<VersionRow[]>`SELECT VERSION() AS \`version\``;
  const version = rows[0]?.version;
  if (version === undefined) {
    throw new LockTestInvariantError('Database did not return a version');
  }
  return version.includes('MariaDB') ? 'mariadb' : 'mysql';
}

async function lockWaitCount(
  prisma: PrismaClient,
  dialect: LockWaitDialect,
  connectionId: bigint,
): Promise<bigint> {
  let rows: LockWaitCountRow[];
  switch (dialect) {
    case 'mariadb':
      rows = await prisma.$queryRaw<LockWaitCountRow[]>`
        SELECT COUNT(*) AS \`waitCount\`
        FROM information_schema.INNODB_LOCK_WAITS waits
        JOIN information_schema.INNODB_TRX transactions
          ON transactions.trx_id = waits.requesting_trx_id
        WHERE transactions.trx_mysql_thread_id = ${connectionId}
      `;
      break;
    case 'mysql':
      rows = await prisma.$queryRaw<LockWaitCountRow[]>`
        SELECT COUNT(*) AS \`waitCount\`
        FROM performance_schema.data_lock_waits waits
        JOIN performance_schema.threads threads
          ON threads.THREAD_ID = waits.REQUESTING_THREAD_ID
        WHERE threads.PROCESSLIST_ID = ${connectionId}
      `;
      break;
    default:
      return assertNever(dialect);
  }
  return rows[0]?.waitCount ?? 0n;
}

export async function waitForDatabaseLockWait(
  prisma: PrismaClient,
  dialect: LockWaitDialect,
  connectionId: bigint,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HANG_GUARD_MS);

  try {
    while (!controller.signal.aborted) {
      if (await lockWaitCount(prisma, dialect, connectionId) > 0n) return;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new LockTestTimeoutError('Database did not expose the expected row-lock wait');
  } finally {
    clearTimeout(timer);
  }
}
