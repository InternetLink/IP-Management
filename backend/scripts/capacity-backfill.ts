import { PrismaClient } from '@prisma/client';

import {
  CapacityBackfillStateError,
  CapacityBackfillWorker,
} from '../src/prefixes/capacity-backfill';

function ownerFromEnvironment(): string {
  return process.env.CAPACITY_BACKFILL_OWNER ?? `capacity-backfill-${process.pid}`;
}

function batchSizeFromEnvironment(): number | undefined {
  const raw = process.env.CAPACITY_BACKFILL_BATCH_SIZE;
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new CapacityBackfillStateError('CAPACITY_BACKFILL_BATCH_SIZE must be a positive integer');
  }
  return value;
}

function printableState(state: { readonly stage: string; readonly expectedRowCount: bigint; readonly processedRowCount: bigint; readonly checksum: string }) {
  return JSON.stringify({
    stage: state.stage,
    expectedRowCount: state.expectedRowCount.toString(),
    processedRowCount: state.processedRowCount.toString(),
    checksum: state.checksum,
  });
}

async function main(): Promise<void> { // no-excuse-ok: catch
  const command = process.argv[2] ?? 'run';
  const prisma = new PrismaClient();
  try {
    const worker = new CapacityBackfillWorker(prisma);
    if (command === 'preflight') {
      console.log(JSON.stringify(await worker.preflight(), (_key, value: unknown) => (
        typeof value === 'bigint' ? value.toString() : value
      )));
      return;
    }
    if (command === 'run') {
      const state = await worker.runToCompletion({
        owner: ownerFromEnvironment(),
        batchSize: batchSizeFromEnvironment(),
      });
      console.log(printableState(state));
      return;
    }
    if (command === 'verify') {
      console.log(JSON.stringify(await worker.verifyChecksum(), (_key, value: unknown) => (
        typeof value === 'bigint' ? value.toString() : value
      )));
      return;
    }
    if (command === 'reset-failed') {
      console.log(printableState(await worker.resetFailed()));
      return;
    }
    throw new CapacityBackfillStateError(`Unknown capacity backfill command: ${command}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (error instanceof Error) console.error(error.message);
  else console.error('Capacity backfill failed with an unknown error');
  process.exitCode = 1;
});
