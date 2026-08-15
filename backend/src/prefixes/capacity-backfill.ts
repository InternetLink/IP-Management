import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

import {
  advanceCapacityChecksum,
  capacityChecksum,
  CAPACITY_INITIAL_CHECKSUM,
  CAPACITY_MIGRATION_ID,
  CAPACITY_STAGES,
  CAPACITY_TARGET_VERSION,
  CapacityBackfillDataError,
  CapacityBackfillStateError,
  CapacityBackfillVerificationError,
  CapacityChecksumEntry,
  CapacityLeaseUnavailableError,
  CapacityMigrationStage,
  CapacityPrefixRow,
  CapacityReadinessError,
  exactCapacityEntry,
  parseCapacityStage,
} from './capacity-backfill-support';

export {
  advanceCapacityChecksum,
  CAPACITY_INITIAL_CHECKSUM,
  CAPACITY_MIGRATION_ID,
  CAPACITY_STAGES,
  CAPACITY_TARGET_VERSION,
  CapacityBackfillDataError,
  CapacityBackfillStateError,
  CapacityBackfillVerificationError,
  CapacityLeaseUnavailableError,
  CapacityReadinessError,
} from './capacity-backfill-support';

type WorkerOptions = {
  readonly leaseDurationMs?: number;
  readonly clock?: () => Date;
};

export type CapacityLeaseRequest = {
  readonly owner: string;
  readonly now?: Date;
};

export type CapacityBatchRequest = {
  readonly owner: string;
  readonly batchSize: number;
  readonly now?: Date;
};

export type CapacityRunRequest = {
  readonly owner: string;
  readonly batchSize?: number;
  readonly now?: Date;
};

export type CapacityChecksumVerification = {
  readonly expectedRowCount: bigint;
  readonly actualRowCount: bigint;
  readonly nullRowCount: bigint;
  readonly expectedChecksum: string;
  readonly actualChecksum: string;
  readonly matches: boolean;
};

type CompletionCandidate = {
  readonly expectedRowCount: bigint;
  readonly processedRowCount: bigint;
  readonly checksum: string;
};

type MigrationStateRecord = {
  readonly id: string;
  readonly stage: string;
  readonly targetVersion: string;
  readonly batchCursor: string | null;
  readonly expectedRowCount: bigint;
  readonly processedRowCount: bigint;
  readonly checksum: string;
  readonly startedAt: Date | null;
  readonly updatedAt: Date;
  readonly completedAt: Date | null;
  readonly failureCode: string | null;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: Date | null;
};

type TransactionClient = Prisma.TransactionClient;

const DEFAULT_LEASE_DURATION_MS = 30_000;
const DEFAULT_BATCH_SIZE = 100;

function validateOwner(owner: string): void {
  if (owner.trim().length === 0 || owner.length > 191) {
    throw new CapacityBackfillStateError('Backfill lease owner must be 1-191 characters');
  }
}

function validateBatchSize(batchSize: number): void {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
    throw new CapacityBackfillStateError('Backfill batch size must be an integer between 1 and 10000');
  }
}

async function lockMigrationState(tx: TransactionClient): Promise<MigrationStateRecord> {
  const locked = await tx.$queryRaw<Array<{ readonly id: string }>>`
    SELECT \`id\`
    FROM \`migration_states\`
    WHERE \`id\` = ${CAPACITY_MIGRATION_ID}
    FOR UPDATE
  `;
  if (locked.length !== 1 || locked[0]?.id !== CAPACITY_MIGRATION_ID) {
    throw new CapacityBackfillStateError(`Migration state ${CAPACITY_MIGRATION_ID} is missing`);
  }
  return tx.migrationState.findUniqueOrThrow({ where: { id: CAPACITY_MIGRATION_ID } });
}

async function readPrefixRows(
  tx: TransactionClient,
  cursor: string | null,
  batchSize: number | null,
): Promise<CapacityPrefixRow[]> {
  if (cursor === null && batchSize === null) {
    return tx.$queryRaw<CapacityPrefixRow[]>`
      SELECT
        \`id\`,
        \`cidr\`,
        CAST(\`usedIPs\` AS CHAR) AS \`usedLegacy\`,
        CAST(\`totalIPsExact\` AS CHAR) AS \`totalIPsExact\`,
        CAST(\`usedIPsExact\` AS CHAR) AS \`usedIPsExact\`
      FROM \`prefixes\`
      ORDER BY \`id\` ASC
    `;
  }

  if (cursor === null) {
    return tx.$queryRaw<CapacityPrefixRow[]>`
      SELECT
        \`id\`,
        \`cidr\`,
        CAST(\`usedIPs\` AS CHAR) AS \`usedLegacy\`,
        CAST(\`totalIPsExact\` AS CHAR) AS \`totalIPsExact\`,
        CAST(\`usedIPsExact\` AS CHAR) AS \`usedIPsExact\`
      FROM \`prefixes\`
      ORDER BY \`id\` ASC
      LIMIT ${batchSize}
    `;
  }

  return tx.$queryRaw<CapacityPrefixRow[]>`
    SELECT
      \`id\`,
      \`cidr\`,
      CAST(\`usedIPs\` AS CHAR) AS \`usedLegacy\`,
      CAST(\`totalIPsExact\` AS CHAR) AS \`totalIPsExact\`,
      CAST(\`usedIPsExact\` AS CHAR) AS \`usedIPsExact\`
    FROM \`prefixes\`
    WHERE \`id\` > ${cursor}
    ORDER BY \`id\` ASC
    LIMIT ${batchSize}
  `;
}

function nowFrom(explicit: Date | undefined, clock: () => Date): Date {
  const value = explicit ?? clock();
  if (Number.isNaN(value.getTime())) throw new CapacityBackfillStateError('Backfill clock returned an invalid date');
  return value;
}

function leaseExpiry(now: Date, durationMs: number): Date {
  return new Date(now.getTime() + durationMs);
}

function stageOf(state: MigrationStateRecord): CapacityMigrationStage {
  return parseCapacityStage(state.stage);
}

function assertTargetVersion(state: MigrationStateRecord): void {
  if (state.targetVersion !== CAPACITY_TARGET_VERSION) {
    throw new CapacityBackfillStateError(
      `Migration state target ${state.targetVersion} does not match ${CAPACITY_TARGET_VERSION}`,
    );
  }
}

function assertLeaseOrTakeover(
  state: MigrationStateRecord,
  owner: string,
  now: Date,
): void {
  const leaseIsLive = state.leaseExpiresAt !== null && state.leaseExpiresAt > now;
  if (leaseIsLive && state.leaseOwner !== null && state.leaseOwner !== owner) {
    throw new CapacityLeaseUnavailableError(state.leaseOwner, state.leaseExpiresAt);
  }
}

async function scanCompletion(
  tx: TransactionClient,
  candidate: CompletionCandidate,
): Promise<CapacityChecksumVerification> {
  const rows = await readPrefixRows(tx, null, null);
  const entries = rows.map(exactCapacityEntry);
  const nullRowCount = BigInt(rows.filter((row) => row.totalIPsExact === null || row.usedIPsExact === null).length);
  const actualChecksum = capacityChecksum(entries);
  const actualRowCount = BigInt(rows.length);
  const valuesMatch = rows.every((row, index) => {
    const entry = entries[index];
    return entry !== undefined && row.totalIPsExact === entry.total && row.usedIPsExact === entry.used;
  });

  const matches = candidate.expectedRowCount === actualRowCount
    && candidate.processedRowCount === actualRowCount
    && nullRowCount === 0n
    && valuesMatch
    && candidate.checksum === actualChecksum;

  return {
    expectedRowCount: candidate.expectedRowCount,
    actualRowCount,
    nullRowCount,
    expectedChecksum: candidate.checksum,
    actualChecksum,
    matches,
  };
}

export class CapacityBackfillWorker {
  private readonly leaseDurationMs: number;
  private readonly clock: () => Date;

  constructor(
    private readonly prisma: PrismaClient,
    options: WorkerOptions = {},
  ) {
    this.leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
    if (!Number.isSafeInteger(this.leaseDurationMs) || this.leaseDurationMs < 1) {
      throw new CapacityBackfillStateError('Backfill lease duration must be a positive integer');
    }
    this.clock = options.clock ?? (() => new Date());
  }

  async preflight(): Promise<{ readonly expectedRowCount: bigint; readonly checksum: string }> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await readPrefixRows(tx, null, null);
      const entries = rows.map(exactCapacityEntry);
      return { expectedRowCount: BigInt(rows.length), checksum: capacityChecksum(entries) };
    }, { timeout: 30_000, maxWait: 30_000 });
  }

  async claimLease(request: CapacityLeaseRequest): Promise<MigrationStateRecord> {
    validateOwner(request.owner);
    const now = nowFrom(request.now, this.clock);
    return this.prisma.$transaction(async (tx) => {
      const state = await lockMigrationState(tx);
      assertTargetVersion(state);
      const stage = stageOf(state);
      if (stage === CAPACITY_STAGES.FAILED) {
        throw new CapacityBackfillStateError(`Capacity backfill is FAILED: ${state.failureCode ?? 'unknown failure'}`);
      }
      if (stage === CAPACITY_STAGES.BACKFILLED || stage === CAPACITY_STAGES.CONTRACTED) return state;

      assertLeaseOrTakeover(state, request.owner, now);
      const expiresAt = leaseExpiry(now, this.leaseDurationMs);
      if (stage === CAPACITY_STAGES.EXPANDED) {
        const rows = await readPrefixRows(tx, null, null);
        rows.forEach(exactCapacityEntry);
        return tx.migrationState.update({
          where: { id: CAPACITY_MIGRATION_ID },
          data: {
            stage: CAPACITY_STAGES.BACKFILLING,
            expectedRowCount: BigInt(rows.length),
            processedRowCount: 0n,
            batchCursor: null,
            checksum: CAPACITY_INITIAL_CHECKSUM,
            startedAt: now,
            updatedAt: now,
            completedAt: null,
            failureCode: null,
            leaseOwner: request.owner,
            leaseExpiresAt: expiresAt,
          },
        });
      }

      return tx.migrationState.update({
        where: { id: CAPACITY_MIGRATION_ID },
        data: { leaseOwner: request.owner, leaseExpiresAt: expiresAt, updatedAt: now },
      });
    }, { timeout: 30_000, maxWait: 30_000 });
  }

  async processBatch(request: CapacityBatchRequest): Promise<MigrationStateRecord> {
    validateOwner(request.owner);
    validateBatchSize(request.batchSize);
    const now = nowFrom(request.now, this.clock);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const state = await lockMigrationState(tx);
        assertTargetVersion(state);
        const stage = stageOf(state);
        if (stage === CAPACITY_STAGES.FAILED) {
          throw new CapacityBackfillStateError(`Capacity backfill is FAILED: ${state.failureCode ?? 'unknown failure'}`);
        }
        if (stage === CAPACITY_STAGES.BACKFILLED || stage === CAPACITY_STAGES.CONTRACTED) return state;
        assertLeaseOrTakeover(state, request.owner, now);

        const expiresAt = leaseExpiry(now, this.leaseDurationMs);
        let activeState = state;
        if (stage === CAPACITY_STAGES.EXPANDED) {
          const allRows = await readPrefixRows(tx, null, null);
          allRows.forEach(exactCapacityEntry);
          activeState = await tx.migrationState.update({
            where: { id: CAPACITY_MIGRATION_ID },
            data: {
              stage: CAPACITY_STAGES.BACKFILLING,
              expectedRowCount: BigInt(allRows.length),
              processedRowCount: 0n,
              batchCursor: null,
              checksum: CAPACITY_INITIAL_CHECKSUM,
              startedAt: now,
              updatedAt: now,
              completedAt: null,
              failureCode: null,
              leaseOwner: request.owner,
              leaseExpiresAt: expiresAt,
            },
          });
        } else {
          activeState = await tx.migrationState.update({
            where: { id: CAPACITY_MIGRATION_ID },
            data: { leaseOwner: request.owner, leaseExpiresAt: expiresAt, updatedAt: now },
          });
        }

        const rows = await readPrefixRows(tx, activeState.batchCursor, request.batchSize);
        if (rows.length === 0) {
          return this.completeLocked(tx, activeState, now);
        }

        let checksum = activeState.checksum;
        const entries: CapacityChecksumEntry[] = [];
        for (const row of rows) {
          const entry = exactCapacityEntry(row);
          entries.push(entry);
          checksum = advanceCapacityChecksum(checksum, entry);
          if (row.totalIPsExact !== entry.total || row.usedIPsExact !== entry.used) {
            await tx.prefix.update({
              where: { id: row.id },
              data: {
                totalIPsExact: new Prisma.Decimal(entry.total),
                usedIPsExact: new Prisma.Decimal(entry.used),
              },
            });
          }
        }

        const processedRowCount = activeState.processedRowCount + BigInt(rows.length);
        const nextState = await tx.migrationState.update({
          where: { id: CAPACITY_MIGRATION_ID },
          data: {
            batchCursor: rows[rows.length - 1]?.id ?? activeState.batchCursor,
            processedRowCount,
            checksum,
            leaseOwner: request.owner,
            leaseExpiresAt: expiresAt,
            updatedAt: now,
          },
        });

        if (processedRowCount === nextState.expectedRowCount) {
          return this.completeLocked(tx, nextState, now);
        }
        return nextState;
      }, { timeout: 30_000, maxWait: 30_000 });
    } catch (error) {
      if (error instanceof CapacityBackfillDataError || error instanceof CapacityBackfillVerificationError) {
        await this.recordFailure(request.owner, error.failureCode, now);
      }
      throw error;
    }
  }

  async runToCompletion(request: CapacityRunRequest): Promise<MigrationStateRecord> {
    const batchSize = request.batchSize ?? DEFAULT_BATCH_SIZE;
    await this.preflight();
    let state = await this.claimLease({ owner: request.owner, now: request.now });
    for (;;) {
      const stage = stageOf(state);
      if (stage === CAPACITY_STAGES.BACKFILLED || stage === CAPACITY_STAGES.CONTRACTED) return state;
      state = await this.processBatch({ owner: request.owner, batchSize, now: request.now });
    }
  }

  async verifyChecksum(): Promise<CapacityChecksumVerification> {
    return this.prisma.$transaction(async (tx) => {
      const state = await lockMigrationState(tx);
      return scanCompletion(tx, {
        expectedRowCount: state.expectedRowCount,
        processedRowCount: state.processedRowCount,
        checksum: state.checksum,
      });
    }, { timeout: 30_000, maxWait: 30_000 });
  }

  async assertExactCapacityReady(): Promise<void> {
    const state = await this.prisma.migrationState.findUnique({ where: { id: CAPACITY_MIGRATION_ID } });
    if (!state) throw new CapacityReadinessError(`Migration state ${CAPACITY_MIGRATION_ID} is missing`);
    const stage = stageOf(state);
    if (stage !== CAPACITY_STAGES.BACKFILLED && stage !== CAPACITY_STAGES.CONTRACTED) {
      throw new CapacityReadinessError(`Exact capacity is not ready at stage ${stage}`);
    }
    const verification = await this.verifyChecksum();
    if (!verification.matches) {
      throw new CapacityReadinessError('Exact capacity checksum or row verification failed');
    }
  }

  async resetFailed(): Promise<MigrationStateRecord> {
    return this.prisma.$transaction(async (tx) => {
      const state = await lockMigrationState(tx);
      if (stageOf(state) !== CAPACITY_STAGES.FAILED) return state;
      return tx.migrationState.update({
        where: { id: CAPACITY_MIGRATION_ID },
        data: {
          stage: CAPACITY_STAGES.EXPANDED,
          batchCursor: null,
          expectedRowCount: 0n,
          processedRowCount: 0n,
          checksum: CAPACITY_INITIAL_CHECKSUM,
          startedAt: null,
          updatedAt: new Date(),
          completedAt: null,
          failureCode: null,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
    }, { timeout: 30_000, maxWait: 30_000 });
  }

  private async completeLocked(
    tx: TransactionClient,
    state: MigrationStateRecord,
    now: Date,
  ): Promise<MigrationStateRecord> {
    const verification = await scanCompletion(tx, {
      expectedRowCount: state.expectedRowCount,
      processedRowCount: state.processedRowCount,
      checksum: state.checksum,
    });
    if (!verification.matches) {
      throw new CapacityBackfillVerificationError(
        `Backfill verification failed: expected ${verification.expectedRowCount} rows, `
        + `found ${verification.actualRowCount}, null rows ${verification.nullRowCount}`,
      );
    }
    return tx.migrationState.update({
      where: { id: CAPACITY_MIGRATION_ID },
      data: {
        stage: CAPACITY_STAGES.BACKFILLED,
        completedAt: now,
        updatedAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
  }

  private async recordFailure(owner: string, failureCode: string, now: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const state = await lockMigrationState(tx);
      const leaseIsLive = state.leaseExpiresAt !== null && state.leaseExpiresAt > now;
      const ownsLease = state.leaseOwner === owner;
      if (stageOf(state) === CAPACITY_STAGES.BACKFILLING && (ownsLease || !leaseIsLive)) {
        await tx.migrationState.update({
          where: { id: CAPACITY_MIGRATION_ID },
          data: {
            stage: CAPACITY_STAGES.FAILED,
            failureCode,
            updatedAt: now,
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
      }
    }, { timeout: 30_000, maxWait: 30_000 });
  }
}
