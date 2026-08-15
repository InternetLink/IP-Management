import { HttpStatus } from '@nestjs/common';
import { PrismaClient, type Prisma } from '@prisma/client';

import {
  ADDRESS_SPACE_BUSY_CODE,
  ADDRESS_SPACE_LOCK_MAX_ATTEMPTS,
  AddressSpaceBusyException,
  acquireAddressSpaceRootLock,
  withAddressSpaceLock,
} from '../../src/prefixes/address-space-lock';
import {
  createDeferred,
  detectLockWaitDialect,
  LockTestInvariantError,
  type LockWaitDialect,
  waitForDatabaseLockWait,
  waitWithHangGuard,
} from './address-space-lock-test-utils';

const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 20_000 } as const;

type ConnectionIdRow = {
  readonly connectionId: bigint;
};

class InjectedDeadlockError extends Error {
  readonly name = 'InjectedDeadlockError';
  readonly code = 'P2034';
}

async function getConnectionId(tx: Prisma.TransactionClient): Promise<bigint> {
  const rows = await tx.$queryRaw<ConnectionIdRow[]>`SELECT CONNECTION_ID() AS \`connectionId\``;
  const connectionId = rows[0]?.connectionId;
  if (connectionId === undefined) {
    throw new LockTestInvariantError('Database did not return a connection ID');
  }
  return connectionId;
}

describe('address-space-lock transaction helper', () => {
  const clientA = new PrismaClient();
  const clientB = new PrismaClient();
  const observer = new PrismaClient();
  let dialect: LockWaitDialect;

  beforeAll(async () => {
    await Promise.all([clientA.$connect(), clientB.$connect(), observer.$connect()]);
    dialect = await detectLockWaitDialect(observer);
  });

  beforeEach(async () => {
    await observer.addressSpaceLock.deleteMany({ where: { key: { startsWith: 'parent:' } } });
    await Promise.all([
      observer.addressSpaceLock.upsert({ where: { key: 'root:v4' }, create: { key: 'root:v4' }, update: {} }),
      observer.addressSpaceLock.upsert({ where: { key: 'root:v6' }, create: { key: 'root:v6' }, update: {} }),
    ]);
  });

  afterAll(async () => {
    await Promise.all([clientA.$disconnect(), clientB.$disconnect(), observer.$disconnect()]);
  });

  it('address-space-lock migration seeds both root lock rows', async () => {
    const rows = await observer.addressSpaceLock.findMany({
      where: { key: { startsWith: 'root:' } },
      orderBy: { key: 'asc' },
    });

    expect(rows.map((row) => row.key)).toEqual(['root:v4', 'root:v6']);
  });

  it('address-space-lock serializes one family and enforces root-before-parent order', async () => {
    const events: string[] = [];
    const aAcquired = createDeferred<void>();
    const aCommitted = createDeferred<void>();
    const releaseA = createDeferred<void>();
    const bConnection = createDeferred<bigint>();
    const bAcquired = createDeferred<void>();
    const releaseB = createDeferred<void>();
    const transactions: Promise<unknown>[] = [];

    try {
      const transactionA = clientA.$transaction(async (tx) => {
        events.push('A:waiting');
        const rootLock = await acquireAddressSpaceRootLock(tx, 4);
        events.push('A:root-acquired');
        await rootLock.acquireParent('barrier-parent');
        events.push('A:parent-acquired');
        aAcquired.resolve();
        await releaseA.promise;
      }, TRANSACTION_OPTIONS);
      transactions.push(transactionA);
      await waitWithHangGuard(aAcquired.promise, 'transaction A acquisition');

      const transactionB = clientB.$transaction(async (tx) => {
        const connectionId = await getConnectionId(tx);
        events.push('B:waiting');
        bConnection.resolve(connectionId);
        await acquireAddressSpaceRootLock(tx, 4);
        await aCommitted.promise;
        events.push('B:acquired');
        bAcquired.resolve();
        await releaseB.promise;
      }, TRANSACTION_OPTIONS);
      transactions.push(transactionB);

      const connectionId = await waitWithHangGuard(bConnection.promise, 'transaction B start');
      await waitForDatabaseLockWait(observer, dialect, connectionId);
      expect(events).toEqual([
        'A:waiting',
        'A:root-acquired',
        'A:parent-acquired',
        'B:waiting',
      ]);

      releaseA.resolve();
      await waitWithHangGuard(transactionA, 'transaction A commit');
      events.push('A:committed');
      aCommitted.resolve();
      await waitWithHangGuard(bAcquired.promise, 'transaction B acquisition');
      releaseB.resolve();
      await waitWithHangGuard(transactionB, 'transaction B commit');
      events.push('B:committed');

      expect(events).toEqual([
        'A:waiting',
        'A:root-acquired',
        'A:parent-acquired',
        'B:waiting',
        'A:committed',
        'B:acquired',
        'B:committed',
      ]);
      await expect(observer.addressSpaceLock.findUnique({
        where: { key: 'parent:barrier-parent' },
      })).resolves.toEqual({ key: 'parent:barrier-parent' });
    } finally {
      releaseA.resolve();
      aCommitted.resolve();
      releaseB.resolve();
      await Promise.allSettled(transactions);
    }
  });

  it('address-space-lock allows IPv4 and IPv6 roots to overlap before release', async () => {
    const events: string[] = [];
    const v4Acquired = createDeferred<void>();
    const v6Acquired = createDeferred<void>();
    const releaseV4 = createDeferred<void>();
    const releaseV6 = createDeferred<void>();

    const transactionV4 = clientA.$transaction(async (tx) => {
      events.push('v4:waiting');
      await acquireAddressSpaceRootLock(tx, 4);
      events.push('v4:acquired');
      v4Acquired.resolve();
      await releaseV4.promise;
    }, TRANSACTION_OPTIONS);
    const transactionV6 = clientB.$transaction(async (tx) => {
      events.push('v6:waiting');
      await acquireAddressSpaceRootLock(tx, 6);
      events.push('v6:acquired');
      v6Acquired.resolve();
      await releaseV6.promise;
    }, TRANSACTION_OPTIONS);

    try {
      await waitWithHangGuard(
        Promise.all([v4Acquired.promise, v6Acquired.promise]),
        'distinct-family acquisitions',
      );
      expect(events).toHaveLength(4);
      expect(events).toEqual(expect.arrayContaining([
        'v4:waiting',
        'v4:acquired',
        'v6:waiting',
        'v6:acquired',
      ]));
    } finally {
      releaseV4.resolve();
      releaseV6.resolve();
      await Promise.allSettled([transactionV4, transactionV6]);
    }
  });

  it('address-space-lock maps retry exhaustion to stable HTTP 409 without partial rows', async () => {
    let attempts = 0;
    const result = await withAddressSpaceLock(
      clientA,
      { family: 4 },
      async (tx) => {
        attempts += 1;
        await tx.addressSpaceLock.create({ data: { key: `parent:retry-${attempts}` } });
        throw new InjectedDeadlockError('Injected transaction deadlock');
      },
    ).then(
      () => new LockTestInvariantError('Retry exhaustion unexpectedly succeeded'),
      (error: unknown) => error,
    );

    expect(result).toBeInstanceOf(AddressSpaceBusyException);
    if (!(result instanceof AddressSpaceBusyException)) {
      throw new LockTestInvariantError('Retry exhaustion returned the wrong error type');
    }
    expect(attempts).toBe(ADDRESS_SPACE_LOCK_MAX_ATTEMPTS);
    expect(result.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(result.getResponse()).toEqual({
      statusCode: HttpStatus.CONFLICT,
      error: 'Conflict',
      message: 'Address space is busy; retry the request',
      code: ADDRESS_SPACE_BUSY_CODE,
    });
    await expect(observer.addressSpaceLock.count({
      where: { key: { startsWith: 'parent:retry-' } },
    })).resolves.toBe(0);
  });
});
